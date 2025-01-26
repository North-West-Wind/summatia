import { Database } from "sqlite3";

export class SummatiaDatabaseProvider {
	protected db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	async init() {}

	protected createIfNotExist(name: string, innerQuery: string) {
		return new Promise<void>((res, rej) => {
			this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [name], (err, row) => {
				if (err) rej(err);
				else if (!row) this.db.run(`CREATE TABLE ${name} (${innerQuery})`, (err) => {
					if (err) rej(err);
					else res();
				});
				else res();
			});
		});
	}
}