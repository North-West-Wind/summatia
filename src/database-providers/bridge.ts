import { Snowflake } from "discord.js";
import { SummatiaDatabaseProvider } from "./provider";
import { Database, verbose } from "sqlite3";

export class BridgeDatabaseProvider extends SummatiaDatabaseProvider {
	mautrixDb?: Database;

	constructor(db: Database) {
		super(db);

		if (process.env.MAUTRIX_DATABASE) {
			const sqlite3 = verbose();
			this.mautrixDb = new sqlite3.Database(process.env.MAUTRIX_DATABASE, sqlite3.OPEN_READONLY);
		}
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
}