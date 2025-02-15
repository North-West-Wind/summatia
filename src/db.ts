import { mkdirSync } from "fs";
import { Database, verbose } from "sqlite3";
import { LinkDatabaseProvider } from "./database-providers/link";
import { ListenDatabaseProvider } from "./database-providers/listen";
import { BridgeDatabaseProvider } from "./database-providers/bridge";
import { RssDatabaseProvider } from "./database-providers/rss";
import { Splatoon3DatabaseProvider } from "./database-providers/splatoon3";
import { EmojiDatabaseProvider } from "./database-providers/emoji";
import { SummatiaDatabaseProvider } from "./database-providers/provider";

export class SummatiaDatabase {
	private db: Database;
	private ready: boolean;
	providers: {
		bridge: BridgeDatabaseProvider;
		listen: ListenDatabaseProvider;
		link: LinkDatabaseProvider;
		rss: RssDatabaseProvider;
		splatoon3: Splatoon3DatabaseProvider;
		emoji: EmojiDatabaseProvider;
	}

	constructor() {
		mkdirSync("runtime", { recursive: true });
		const sqlite3 = verbose();
		this.db = new sqlite3.Database("runtime/discord.db");
		this.ready = false;
		this.providers = {
			bridge: new BridgeDatabaseProvider(this.db),
			listen: new ListenDatabaseProvider(this.db),
			link: new LinkDatabaseProvider(this.db),
			rss: new RssDatabaseProvider(this.db),
			splatoon3: new Splatoon3DatabaseProvider(this.db),
			emoji: new EmojiDatabaseProvider(this.db),
		};
		this.init();
	}

	async init() {
		try {
			this.log("Ensuring migration version table exists...");
			await this.ensureMigrateVersionTable();
			for (const provider of Object.values(this.providers)) {
				this.log(`Initializing database provider ${provider.name}...`);
				const [version, create] = await this.getProviderVersion(provider);
				await provider.migrate(version);
				if (version != provider.version)
					await this.setProviderVersion(provider, create);
			}
			this.ready = true;
		} catch (err) {
			this.log("Failed to initialize database");
			console.error(err);
		}
	}

	isReady() {
		return this.ready;
	}

	private getProviderVersion(provider: SummatiaDatabaseProvider) {
		return new Promise<[number | undefined, boolean]>((res, rej) => {
			this.db.get("SELECT version FROM migrate_version WHERE name = ?", [provider.name], (err, row?: { version: number }) => {
				if (err) rej(err);
				else if (row?.version !== undefined || !provider.tables()) res([row?.version, !row]);
				else {
					this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [provider.tables()[0]], (err, row) => {
						if (err) rej(err);
						if (row) res([0, true]);
						else res([undefined, true]);
					});
				}
			});
		});
	}

	private setProviderVersion(provider: SummatiaDatabaseProvider, create: boolean) {
		return new Promise<void>((res, rej) => {
			const query: [string, any[]] = create ?
				["INSERT INTO migrate_version VALUES (?, ?)", [provider.name, provider.version]] : 
				["UPDATE migrate_version SET version = ? WHERE name = ?", [provider.version, provider.name]];
			this.db.run(query[0], query[1], (err) => {
				if (err) rej(err);
				else res();
			});
		});
	}

	private ensureMigrateVersionTable() {
		return new Promise<void>((res, rej) => {
			this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", ["migrate_version"], (err, row) => {
				if (err) rej(err);
				else if (!row)
					this.db.run("CREATE TABLE migrate_version (name VARCHAR(32) NOT NULL PRIMARY KEY, version INTEGER NOT NULL)", (err) => {
						if (err) rej(err);
						else res();
					});
				else res();
			});
		})
	}

	private log(message: string, ...args: any[]) {
		console.log(`[DB] ${message}`, ...args);
	}
}