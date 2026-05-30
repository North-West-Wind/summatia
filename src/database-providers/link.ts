import { Snowflake } from "discord.js";
import { Database } from "better-sqlite3";

import { SummatiaDatabaseProvider } from "./provider";

export class LinkDatabaseProvider extends SummatiaDatabaseProvider {
	constructor(db: Database) {
		super("link", db);
	}

	tables() {
		return ["linkSpam"];
	}

	protected migrations() {
		return [
			() => this.createIfNotExist("linkSpam", "user varchar(32) NOT NULL, guild varchar(32) NOT NULL, threat INTEGER NOT NULL, PRIMARY KEY(user, guild)")
		];
	}

	getLinkSpamUsers() {
		return this.all<{ user: string, guild: string, threat: number }>("SELECT * FROM linkSpam") || [];
	}

	setLinkSpamUser(userId: string, guildId: string, threat: number) {
		const row = this.get("SELECT user FROM linkSpam WHERE user = ? AND guild = ?", [userId, guildId]);
		if (row) this.run("UPDATE linkSpam SET COLUMN threat = ? WHERE user = ? AND guild = ?", [threat, userId, guildId]);
		else this.run("INSERT INTO linkSpam VALUES(?, ?, ?)", [userId, guildId, threat]);
	}
}