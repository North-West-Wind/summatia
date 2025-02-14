import { Snowflake } from "discord.js";
import { SummatiaDatabaseProvider } from "./provider";
import { Database } from "sqlite3";

export class RssDatabaseProvider extends SummatiaDatabaseProvider {
	constructor(db: Database) {
		super("rss", db);
	}

	tables() {
		return ["rss", "rssDiscord", "rssMatrix"];
	}

	protected migrations() {
		return [
			async () => {
				await this.createIfNotExist("rss", "id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, url VARCHAR(2083) NOT NULL, timestamp INTEGER");
				await this.createIfNotExist("rssDiscord", "channel VARCHAR(32) NOT NULL, rss INTEGER NOT NULL, template TEXT, PRIMARY KEY(channel, rss)");
				await this.createIfNotExist("rssMatrix", "room TEXT NOT NULL, rss INTEGER NOT NULL, template TEXT, PRIMARY KEY(room, rss)");
			}
		];
	}

	getRssFeedId(url: string) {
		return new Promise<number | undefined>((res, rej) => {
			this.db.get("SELECT id FROM rss WHERE url = ?", [url], (err, row?: { id: number }) => {
				if (err) rej(err);
				else res(row?.id);
			});
		});
	}

	getRssFeed(id: number) {
		return new Promise<{ id: number, url: string, timestamp: number } | undefined>((res, rej) => {
			this.db.get("SELECT * FROM rss WHERE id = ?", [id], (err, row?: { id: number, url: string, timestamp: number }) => {
				if (err) rej(err);
				else res(row);
			});
		});
	}

	getRssFeeds() {
		return new Promise<{ id: number, url: string, timestamp: number }[]>((res, rej) => {
			this.db.all("SELECT * FROM rss", (err, rows?: { id: number, url: string, timestamp: number }[]) => {
				if (err) rej(err);
				else res(rows || []);
			});
		});
	}

	getRssDiscordFeeds() {
		return new Promise<{ channel: Snowflake, rss: number, template?: string }[]>((res, rej) => {
			this.db.all("SELECT * FROM rssDiscord", (err, rows?: { channel: Snowflake, rss: number, template?: string }[]) => {
				if (err) rej(err);
				else res(rows || []);
			});
		});
	}

	getRssMatrixFeeds() {
		return new Promise<{ room: string, rss: number, template?: string }[]>((res, rej) => {
			this.db.all("SELECT * FROM rssMatrix", (err, rows?: { room: string, rss: number, template?: string }[]) => {
				if (err) rej(err);
				else res(rows || []);
			});
		});
	}

	addRssFeed(url: string, timestamp: number) {
		return new Promise<number>((res, rej) => {
			this.db.run("INSERT INTO rss (url, timestamp) VALUES (?, ?)", [url, timestamp], err => {
				if (err) rej(err);
				else this.db.get("SELECT id FROM rss WHERE url = ? AND timestamp = ?", [url, timestamp], (err, row?: { id: number }) => {
					if (err) rej(err);
					else if (!row) rej(new Error("Entry not found"));
					else res(row.id);
				});
			});
		});
	}

	addRssMatrixFeed(id: number, room: string) {
		return new Promise<void>((res, rej) => {
			this.db.run("INSERT INTO rssMatrix VALUES (?, ?, NULL)", [room, id], err => {
				if (err) rej(err);
				else res();
			})
		});
	}

	addRssDiscordFeed(id: number, channel: string) {
		return new Promise<void>((res, rej) => {
			this.db.run("INSERT INTO rssDiscord VALUES (?, ?, NULL)", [channel, id], err => {
				if (err) rej(err);
				else res();
			})
		});
	}

	removeRssMatrixFeed(id: number, room: string) {
		return new Promise<void>((res, rej) => {
			this.db.run("DELETE FROM rssMatrix WHERE room = ? AND rss = ?", [room, id], err => {
				if (err) rej(err);
				else res();
			})
		});
	}

	removeRssDiscordFeed(id: number, channel: Snowflake) {
		return new Promise<void>((res, rej) => {
			this.db.run("DELETE FROM rssDiscord WHERE channel = ? AND rss = ?", [channel, id], err => {
				if (err) rej(err);
				else res();
			})
		});
	}

	setRssMatrixTemplate(id: number, room: string, template: string | null) {
		return new Promise<void>((res, rej) => {
			this.db.run("UPDATE rssMatrix SET template = ? WHERE room = ? AND rss = ?", [template, room, id], err => {
				if (err) rej(err);
				else res();
			});
		});
	}

	setRssDiscordTemplate(id: number, channel: Snowflake, template: string | null) {
		return new Promise<void>((res, rej) => {
			this.db.run("UPDATE rssDiscord SET template = ? WHERE channel = ? AND rss = ?", [template, channel, id], err => {
				if (err) rej(err);
				else res();
			});
		});
	}

	setRssFeedTimestamp(id: number, timestamp: number) {
		return new Promise<void>((res, rej) => {
			this.db.run("UPDATE rss SET timestamp = ? WHERE id = ?", [timestamp, id], err => {
				if (err) rej(err);
				else res();
			});
		});
	}
}