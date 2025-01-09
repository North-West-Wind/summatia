import { Snowflake } from "discord.js";
import { mkdirSync } from "fs";
import { Database, verbose } from "sqlite3";
import { ChannelBridgeStatus } from "./matrix/types/bridge";

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
		this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='listen'", (err, row) => {
			if (err) console.error(err);
			if (!row) this.db.run("CREATE TABLE listen (channel varchar(32) NOT NULL PRIMARY KEY, chance INTEGER NOT NULL)", (err) => {
				if (err) console.error(err);
				else this.ready = true;
			});
			else this.ready = true;
		});

		if (process.env.MAUTRIX_DATABASE) {
			this.mautrixDb = new sqlite3.Database(`file:${process.env.MAUTRIX_DATABASE}?mode=readonly`);
		}
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

	isChannelBridged(dcid: Snowflake) {
		if (!this.mautrixDb) return ChannelBridgeStatus.UNKNOWN;
		return new Promise<ChannelBridgeStatus>((res, rej) => {
			this.mautrixDb?.get("SELECT mxid FROM portal WHERE dcid = ?", [dcid], (err, row?: { mxid?: string }) => {
				if (err) return rej(err);
				if (!row?.mxid) res(ChannelBridgeStatus.BRIDGED);
				else res(ChannelBridgeStatus.UNBRIDGED);
			});
		});
	}
}