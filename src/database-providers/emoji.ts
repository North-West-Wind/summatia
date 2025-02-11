import { Snowflake } from "discord.js";
import { SummatiaDatabaseProvider } from "./provider";

type GuildEmoji = {
	guildId: Snowflake;
	name: string;
	url: string;
	active: number;
	ref: number;
}

export class EmojiDatabaseProvider extends SummatiaDatabaseProvider {
	async init() {
		await this.createIfNotExist("guildEmojis", "guildId VARCHAR(32) NOT NULL, name VARCHAR(255) NOT NULL, url TEXT NOT NULL, active TINYINT(1) NOT NULL, ref TINYINT(1) NOT NULL, PRIMARY KEY (guildId, name)");
	}

	async getEmojis(guildId: Snowflake) {
		const rows = await this.all<GuildEmoji>("SELECT * FROM guildEmojis WHERE guildId = ?", [guildId]);
		return rows?.map(e => ({
			...e,
			active: !!e.active,
			ref: !!e.ref,
		}));
	}

	async setEmojis(guildId: Snowflake, emojis: { name: string, url: string, active: boolean, ref: boolean }[]) {
		const rows = await this.getEmojis(guildId);
		for (const emoji of emojis) {
			if (rows?.find(e => e.name == emoji.name)) await this.run(
				"UPDATE guildEmojis SET url = ?, active = ?, ref = ? WHERE guildId = ? AND name = ?",
				[emoji.url, emoji.active ? 1 : 0, emoji.ref ? 1 : 0, guildId, emoji.name]
			);
			else await this.run(
				"INSERT INTO guildEmojis VALUES (?, ?, ?, ?, ?)",
				[guildId, emoji.name, emoji.url, emoji.active ? 1 : 0, emoji.ref ? 1 : 0]
			);
		}
	}

	async removeEmoji(guildId: Snowflake, name: string) {
		await this.run("DELETE FROM guildEmojis WHERE guildId = ? AND name = ?", [guildId, name]);
	}
}