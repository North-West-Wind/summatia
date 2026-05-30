import { Snowflake } from "discord.js";
import { Database } from "better-sqlite3";

import { SummatiaDatabaseProvider } from "./provider";

export class ListenDatabaseProvider extends SummatiaDatabaseProvider {
	constructor(db: Database) {
		super("listen", db);
	}

	tables() {
		return ["listen"];
	}
	
	protected migrations() {
		return [
			() => this.createIfNotExist("listen", "channel varchar(32) NOT NULL PRIMARY KEY, chance INTEGER NOT NULL")
		];
	}

	addListen(channel: Snowflake, chance: number) {
		const row = this.get<{ channel: string }>("SELECT channel FROM listen WHERE channel = ?", [channel]);
		if (!row) this.run("INSERT INTO listen VALUES (?, ?)", [channel, chance]);
		else this.run("UPDATE listen SET chance = ? WHERE channel = ?", [chance, channel]);
	}

	removeListen(channel: Snowflake) {
		this.run("DELETE FROM listen WHERE channel = ?", [channel]);
	}

	shouldListen(channel: Snowflake) {
		const row = this.get<{ chance: number }>("SELECT chance FROM listen WHERE channel = ?", [channel]);
		return row ? row.chance : -1;
	}
}