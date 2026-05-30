import { Snowflake } from "discord.js";
import sqlite3, { Database } from "better-sqlite3";

import { SummatiaDatabaseProvider } from "./provider";

export class BridgeDatabaseProvider extends SummatiaDatabaseProvider {
	mautrixDb?: Database;

	constructor(db: Database) {
		super("bridge", db);

		if (process.env.MAUTRIX_DATABASE) {
			this.mautrixDb = sqlite3(process.env.MAUTRIX_DATABASE, { readonly: true });
		}
	}

	tables() {
		return [];
	}

	protected migrations() {
		return [() => {}];
	}

	getChannelRoom(channelId: Snowflake) {
		if (!this.mautrixDb) return undefined;
		const row = this.mautrixDb?.prepare("SELECT mxid FROM portal WHERE dcid = ?").get(channelId) as { mxid?: string };
		return row?.mxid || "";
	}

	getRoomChannel(roomId: string) {
		if (!this.mautrixDb) return undefined;
		const row = this.mautrixDb?.prepare("SELECT dcid FROM portal WHERE mxid = ?").get(roomId) as { dcid?: string };
		return row?.dcid || "";
	}
}