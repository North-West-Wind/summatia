import { Database } from "better-sqlite3";

import Logger from "../helpers/logger";

export abstract class SummatiaDatabaseProvider {
	readonly name: string;
	protected db: Database;
	readonly version: number;

	constructor(name: string, db: Database, version = 0) {
		this.name = name;
		this.db = db;
		this.version = version;
	}

	// returned array structure: [none -> this.version, 0 -> 1, 1 -> 2]
	protected abstract migrations(): (() => any)[];

	abstract tables(): string[];

	migrate(currentVersion?: number) {
		if (currentVersion === undefined) {
			Logger.db.log("Creating database provider", this.name);
			this.migrations()[0]();
		} else {
			while (currentVersion < this.version) {
				this.migrations()[++currentVersion]();
				Logger.db.log(`Migrated "${this.name}" from v${currentVersion - 1} to v${currentVersion}`);
			}
			Logger.db.log(`${this.name} is up-to-date (v${currentVersion}).`);
		}
	}

	protected createIfNotExist(name: string, innerQuery: string) {
		const row = this.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [name]);
		if (!row) this.run(`CREATE TABLE ${name} (${innerQuery})`);
	}

	protected get<T>(query: string, ...args: any[]) {
		return this.db.prepare(query).get(...args) as T | undefined;
	}

	protected all<T>(query: string, ...args: any[]) {
		return this.db.prepare(query).all(...args) as T[];
	}

	protected run(query: string, ...args: any[]) {
		this.db.prepare(query).run(...args);
	}
}