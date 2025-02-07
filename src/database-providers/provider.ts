import { Database } from "sqlite3";

export class SummatiaDatabaseProvider {
	protected db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	async init() {}

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