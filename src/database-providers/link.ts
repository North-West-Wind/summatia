import { Snowflake } from "discord.js";
import { Database } from "sqlite3";

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
			async () => await this.createIfNotExist("linkSpam", "user varchar(32) NOT NULL, guild varchar(32) NOT NULL, threat INTEGER NOT NULL, PRIMARY KEY(user, guild)")
		];
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