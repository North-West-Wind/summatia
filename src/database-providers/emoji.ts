import { Snowflake } from "discord.js";
import { Database } from "sqlite3";

import { SummatiaDatabaseProvider } from "./provider";

type GuildEmoji = {
	guildId: Snowflake;
	name: string;
	url: string;
	active: number;
	ref: number;
	animated: number;
}

export class EmojiDatabaseProvider extends SummatiaDatabaseProvider {
	constructor(db: Database) {
		super("emoji", db, 1);
	}

	tables() {
		return ["guildEmojis", "emojiPointer"];
	}

	protected migrations() {
		return [
			async () => {
				await this.createIfNotExist("guildEmojis", "guildId VARCHAR(32) NOT NULL, name VARCHAR(255) NOT NULL, url TEXT NOT NULL, active TINYINT(1) NOT NULL, ref TINYINT(1) NOT NULL, animated TINYINT(1) NOT NULL, PRIMARY KEY (guildId, name)")
				await this.createIfNotExist("emojiPointer", "id VARCHAR(32) NOT NULL PRIMARY KEY, index INTEGER NOT NULL");
			},
			async () => await this.createIfNotExist("emojiPointer", "id VARCHAR(32) NOT NULL PRIMARY KEY, index INTEGER NOT NULL")
		];
	}

	async getGuilds() {
		return (await this.all<{ guildId: string }>("SELECT DISTINCT guildId FROM guildEmojis"))?.map(x => x.guildId);
	}

	async getEmojis(guildId: Snowflake) {
		const rows = await this.all<GuildEmoji>("SELECT * FROM guildEmojis WHERE guildId = ?", [guildId]);
		return rows?.map(e => ({
			...e,
			active: !!e.active,
			ref: !!e.ref,
			animated: !!e.animated,
		}));
	}

	async setEmojis(guildId: Snowflake, emojis: { name: string, url: string, active: boolean, ref: boolean, animated: boolean }[]) {
		const rows = await this.getEmojis(guildId);
		for (const emoji of emojis) {
			if (rows?.find(e => e.name == emoji.name)) await this.run(
				"UPDATE guildEmojis SET url = ?, active = ?, ref = ?, animated = ? WHERE guildId = ? AND name = ?",
				[emoji.url, emoji.active ? 1 : 0, emoji.ref ? 1 : 0, emoji.animated ? 1 : 0, guildId, emoji.name]
			);
			else await this.run(
				"INSERT INTO guildEmojis VALUES (?, ?, ?, ?, ?, ?)",
				[guildId, emoji.name, emoji.url, emoji.active ? 1 : 0, emoji.ref ? 1 : 0, emoji.animated ? 1 : 0]
			);
		}
	}

	async removeEmoji(guildId: Snowflake, name: string) {
		await this.run("DELETE FROM guildEmojis WHERE guildId = ? AND name = ?", [guildId, name]);
	}

	async updateEmojisRef(guildId: Snowflake, emojis: { name: string, ref: boolean }[]) {
		for (const emoji of emojis)
			await this.run("UPDATE guildEmojis SET ref = ? WHERE guildId = ? AND name = ?", [emoji.ref ? 1 : 0, guildId, emoji.name]);
	}

	async addEmoji(guildId: Snowflake, name: string, emoji: { url: string, active: boolean, ref: boolean, animated: boolean }) {
		const row = await this.get<{ name: string }>("SELECT name FROM guildEmojis WHERE guildId = ? AND name = ?", [guildId, name]);
		if (!row) await this.run("INSERT INTO guildEmojis VALUES (?, ?, ?, ?, ?, ?)", [guildId, name, emoji.url, emoji.active ? 1 : 0, emoji.ref ? 1 : 0, emoji.animated ? 1 : 0]);
	}

	async updateEmojiActive(guildId: Snowflake, name: string, active: boolean) {
		await this.run("UPDATE guildEmojis SET ref = ? WHERE guildId = ? AND name = ?", [active ? 1 : 0, guildId, name]);
	}

	async getPointers() {
		return await this.all<{ id: Snowflake, index: number }>("SELECT * FROM emojiPointer");
	}

	async setPointer(guildId: Snowflake, index: number) {
		const row = await this.get<{ index: number }>("SELECT index FROM emojiPointer WHERE id = ?", [guildId]);
		if (row !== undefined) {
			if (row.index != index) await this.run("UPDATE emojiPointer SET index = ? WHERE id = ?", [index, guildId]);
		} else
			await this.run("INSERT INTO emojiPointer VALUES (?, ?)", [guildId, index]);
	}
}