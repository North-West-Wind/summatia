import { mkdirSync } from "fs";
import { Database, verbose } from "sqlite3";
import { LinkDatabaseProvider } from "./database-providers/link";
import { ListenDatabaseProvider } from "./database-providers/listen";
import { BridgeDatabaseProvider } from "./database-providers/bridge";
import { RssDatabaseProvider } from "./database-providers/rss";

export class SummatiaDatabase {
	private db: Database;
	private ready: boolean;
	providers: {
		bridge: BridgeDatabaseProvider;
		listen: ListenDatabaseProvider;
		link: LinkDatabaseProvider;
		rss: RssDatabaseProvider;
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
		};
		this.init();
	}

	async init() {
		try {
			for (const provider of Object.values(this.providers))
				await provider.init();
			this.ready = true;
		} catch (err) {
			console.log("Failed to initialize database");
			console.error(err);
		}
	}

	isReady() {
		return this.ready;
	}
}