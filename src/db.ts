import { mkdirSync } from "fs";
import sqlite3, { Database } from "better-sqlite3";

import { BridgeDatabaseProvider } from "./database-providers/bridge";
import { ListenDatabaseProvider } from "./database-providers/listen";
import { SummatiaDatabaseProvider } from "./database-providers/provider";
import { RssDatabaseProvider } from "./database-providers/rss";
import { Splatoon3DatabaseProvider } from "./database-providers/splatoon3";
import Logger from "./helpers/logger";

export class SummatiaDatabase {
	private db: Database;
	private ready: boolean;
	providers: {
		bridge: BridgeDatabaseProvider;
		listen: ListenDatabaseProvider;
		rss: RssDatabaseProvider;
		splatoon3: Splatoon3DatabaseProvider;
	}

	constructor() {
		mkdirSync("runtime", { recursive: true });
		this.db = sqlite3("runtime/discord.db");
		this.ready = false;
		this.providers = {
			bridge: new BridgeDatabaseProvider(this.db),
			listen: new ListenDatabaseProvider(this.db),
			rss: new RssDatabaseProvider(this.db),
			splatoon3: new Splatoon3DatabaseProvider(this.db),
		};

		try {
			Logger.db.log("Ensuring migration version table exists...");
			this.ensureMigrateVersionTable();
			for (const provider of Object.values(this.providers)) {
				Logger.db.log(`Initializing database provider ${provider.name}...`);
				const [version, create] = this.getProviderVersion(provider);
				provider.migrate(version);
				if (version != provider.version)
					this.setProviderVersion(provider, create);
			}
			this.ready = true;
		} catch (err) {
			Logger.db.error("Failed to initialize database", err);
		}
	}

	isReady() {
		return this.ready;
	}

	private getProviderVersion(provider: SummatiaDatabaseProvider): [number | undefined, boolean] {
		const row = this.db.prepare("SELECT version FROM migrate_version WHERE name = ?").get(provider.name) as { version: number };
		if (row?.version !== undefined || !provider.tables()) return [row?.version, !row];
		else {
			const row = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(provider.tables()[0]);
			return [row ? 0 : undefined, true];
		}
	}

	private setProviderVersion(provider: SummatiaDatabaseProvider, create: boolean) {
		const query: [string, any[]] = create ?
			["INSERT INTO migrate_version VALUES (?, ?)", [provider.name, provider.version]] : 
			["UPDATE migrate_version SET version = ? WHERE name = ?", [provider.version, provider.name]];
		this.db.prepare(query[0]).run(query[1]);
	}

	private ensureMigrateVersionTable() {
		const row = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get("migrate_version");
		if (row) return;
		this.db.prepare("CREATE TABLE migrate_version (name VARCHAR(32) NOT NULL PRIMARY KEY, version INTEGER NOT NULL)").run();
	}
}