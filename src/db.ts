import { Snowflake } from "discord.js";
import { mkdirSync } from "fs";
import { Database, verbose } from "sqlite3";

export class SummatiaDatabase {
	private db: Database;
	private mautrixDb?: Database;
	private ready: boolean;

	constructor() {
		mkdirSync("runtime", { recursive: true });
		const sqlite3 = verbose();
		this.db = new sqlite3.Database("runtime/discord.db");
		this.ready = false;

		// create table if not exist
		(async () => {
			try {
				await this.createIfNotExist("listen", "CREATE TABLE listen (channel varchar(32) NOT NULL PRIMARY KEY, chance INTEGER NOT NULL)");
				await this.createIfNotExist("linkSpam", "CREATE TABLE linkSpam (user varchar(32) NOT NULL, guild varchar(32) NOT NULL, threat INTEGER NOT NULL, PRIMARY KEY(user, guild))")
				this.ready = true;
			} catch (err) {
				console.log("Failed to initialize database");
				console.error(err);
			}
		})();

		if (process.env.MAUTRIX_DATABASE) {
			this.mautrixDb = new sqlite3.Database(`file:${process.env.MAUTRIX_DATABASE}?mode=readonly`);
		}
	}

	private createIfNotExist(name: string, creationQuery: string) {
		return new Promise<void>((res, rej) => {
			this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [name], (err, row) => {
				if (err) rej(err);
				else if (!row) this.db.run(creationQuery, (err) => {
					if (err) rej(err);
					else res();
				});
				else res();
			});
		});
	}

	isReady() {
		return this.ready;
	}

	addListen(channel: Snowflake, chance: number) {
		return new Promise<void>((res, rej) => {
			this.db.get("SELECT channel FROM listen WHERE channel = ?", [channel], (err, row?: { channel: string }) => {
				if (err) return rej(err);
				if (!row)	this.db.run("INSERT INTO listen VALUES (?, ?)", [channel, chance], err => {
					if (err) rej(err);
					else res();
				});
				else this.db.run("UPDATE listen SET chance = ? WHERE channel = ?", [chance, channel], err => {
					if (err) rej(err);
					else res();
				});
			});
		});
	}

	removeListen(channel: Snowflake) {
		return new Promise<void>((res, rej) => {
			this.db.run("DELETE FROM listen WHERE channel = ?", [channel], err => {
				if (err) rej(err);
				else res();
			});
		});
	}

	shouldListen(channel: Snowflake) {
		return new Promise<number>((res, rej) => {
			this.db.get("SELECT chance FROM listen WHERE channel = ?", [channel], (err, row?: { chance: number }) => {
				if (err) return rej(err);
				if (!row)	res(-1);
				else res(row.chance);
			});
		});
	}

	getChannelRoom(channelId: Snowflake) {
		if (!this.mautrixDb) return undefined;
		return new Promise<string>((res, rej) => {
			this.mautrixDb?.get("SELECT mxid FROM portal WHERE dcid = ?", [channelId], (err, row?: { mxid?: string }) => {
				if (err) return rej(err);
				if (!row?.mxid) res("");
				else res(row.mxid);
			});
		});
	}

	getRoomChannel(roomId: string) {
		if (!this.mautrixDb) return undefined;
		return new Promise<string>((res, rej) => {
			this.mautrixDb?.get("SELECT dcid FROM portal WHERE mxid = ?", [roomId], (err, row?: { dcid?: string }) => {
				if (err) return rej(err);
				if (!row?.dcid) res("");
				else res(row.dcid);
			});
		});
	}

	getLinkSpamUsers() {
		return new Promise<{ user: Snowflake, guild: Snowflake, threat: number }[]>((res, rej) => {
			this.db.all("SELECT * FROM linkSpam", (err, rows?: { user: string, guild: string, threat: number }[]) => {
				if (err) rej(err);
				else res(rows || []);
			});
		});
	}

	setLinkSpamUser(userId: string, guildId: string, threat: number) {
		return new Promise<void>((res, rej) => {
			this.db.get("SELECT user FROM linkSpam WHERE user = ? AND guild = ?", [userId, guildId], (err, row?) => {
				if (err) rej(err);
				else if (row) this.db.run("UPDATE linkSpam SET COLUMN threat = ? WHERE user = ? AND guild = ?", [threat, userId, guildId], (err) => {
					if (err) rej(err);
					else res();
				});
				else this.db.run("INSERT INTO linkSpam VALUES(?, ?, ?)", [userId, guildId, threat], (err) => {
					if (err) rej(err);
					else res();
				});
			});
		});
	}
}