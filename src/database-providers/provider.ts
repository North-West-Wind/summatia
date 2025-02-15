import { Database } from "sqlite3";

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
	protected abstract migrations(): (() => any | Promise<any>)[];

	abstract tables(): string[];

	async migrate(currentVersion?: number) {
		if (currentVersion === undefined) {
			console.log("Creating database provider", this.name);
			await this.migrations()[0]();
		} else {
			while (currentVersion < this.version) {
				await this.migrations()[++currentVersion]();
				console.log(`Migrated "${this.name}" from v${currentVersion - 1} to v${currentVersion}`);
			}
			console.log(`${this.name} is up-to-date (v${currentVersion}).`);
		}
	}

	protected async createIfNotExist(name: string, innerQuery: string) {
		const row = await this.get<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [name]);
		if (!row) await this.run(`CREATE TABLE ${name} (${innerQuery})`);
	}

	protected async get<T>(query: string, args?: string[]) {
		return new Promise<T | undefined>((res, rej) => {
			const callback = (err: Error, row?: T) => {
				if (err) rej(err);
				else res(row);
			};
			if (args) this.db.get(query, args, callback);
			else this.db.get(query, callback);
		})
	}

	protected async all<T>(query: string, args?: string[]) {
		return new Promise<T[] | undefined>((res, rej) => {
			const callback = (err: Error, row?: T[]) => {
				if (err) rej(err);
				else res(row);
			};
			if (args) this.db.all(query, args, callback);
			else this.db.all(query, callback);
		})
	}

	protected async run(query: string, args?: any[]) {
		return new Promise<void>((res, rej) => {
			const callback = (err: Error) => {
				if (err) rej(err);
				else res();
			};
			if (args) this.db.run(query, args, callback);
			else this.db.run(query, callback);
		})
	}
}