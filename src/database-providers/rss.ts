import { Snowflake } from "discord.js";
import { Database } from "better-sqlite3";

import { SummatiaDatabaseProvider } from "./provider";

export class RssDatabaseProvider extends SummatiaDatabaseProvider {
	constructor(db: Database) {
		super("rss", db);
	}

	tables() {
		return ["rss", "rssDiscord", "rssMatrix"];
	}

	protected migrations() {
		return [
			() => {
				this.createIfNotExist("rss", "id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, url VARCHAR(2083) NOT NULL, timestamp INTEGER");
				this.createIfNotExist("rssDiscord", "channel VARCHAR(32) NOT NULL, rss INTEGER NOT NULL, template TEXT, PRIMARY KEY(channel, rss)");
				this.createIfNotExist("rssMatrix", "room TEXT NOT NULL, rss INTEGER NOT NULL, template TEXT, PRIMARY KEY(room, rss)");
			}
		];
	}

	getRssFeedId(url: string) {
		const row = this.get<{ id: number }>("SELECT id FROM rss WHERE url = ?", [url]);
		return row?.id;
	}

	getRssFeed(id: number) {
		return this.get<{ id: number, url: string, timestamp: number }>("SELECT * FROM rss WHERE id = ?", [id]);
	}

	getRssFeeds() {
		return this.all<{ id: number, url: string, timestamp: number }>("SELECT * FROM rss");
	}

	getRssDiscordFeeds() {
		return this.all<{ channel: Snowflake, rss: number, template?: string }>("SELECT * FROM rssDiscord");
	}

	getRssMatrixFeeds() {
		return this.all<{ room: string, rss: number, template?: string }>("SELECT * FROM rssMatrix");
	}

	addRssFeed(url: string, timestamp: number) {
		this.run("INSERT INTO rss (url, timestamp) VALUES (?, ?)", [url, timestamp]);
		const row = this.get<{ id: number }>("SELECT id FROM rss WHERE url = ? AND timestamp = ?", [url, timestamp]);
		if (!row) throw new Error("Entry not found");
		else return row.id;
	}

	addRssMatrixFeed(id: number, room: string) {
		this.run("INSERT INTO rssMatrix VALUES (?, ?, NULL)", [room, id]);
	}

	addRssDiscordFeed(id: number, channel: string) {
		this.run("INSERT INTO rssDiscord VALUES (?, ?, NULL)", [channel, id]);
	}

	removeRssMatrixFeed(id: number, room: string) {
		this.run("DELETE FROM rssMatrix WHERE room = ? AND rss = ?", [room, id]);
	}

	removeRssDiscordFeed(id: number, channel: Snowflake) {
		this.run("DELETE FROM rssDiscord WHERE channel = ? AND rss = ?", [channel, id]);
	}

	setRssMatrixTemplate(id: number, room: string, template: string | null) {
		this.run("UPDATE rssMatrix SET template = ? WHERE room = ? AND rss = ?", [template, room, id]);
	}

	setRssDiscordTemplate(id: number, channel: Snowflake, template: string | null) {
		this.run("UPDATE rssDiscord SET template = ? WHERE channel = ? AND rss = ?", [template, channel, id]);
	}

	setRssFeedTimestamp(id: number, timestamp: number) {
		this.run("UPDATE rss SET timestamp = ? WHERE id = ?", [timestamp, id]);
	}
}