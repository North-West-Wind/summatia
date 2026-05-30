import { Database } from "better-sqlite3";

import { SummatiaDatabaseProvider } from "./provider";

export class BitflagManipulator {
	bitflag: number;

	constructor(bitflag: number) {
		this.bitflag = bitflag;
	}

	get(index: number) {
		if (index < 0 || index >= 32) throw new Error("Bitflag index must be in range [0,32)");
		return !!((this.bitflag >> index) & 0x1);
	}

	set(index: number, val: boolean) {
		if (index < 0 || index >= 32) throw new Error("Bitflag index must be in range [0,32)");
		if (val) this.bitflag |= 1 << index;
		else this.bitflag &= ~(1 << index);
	}
}

export class Splatoon3DatabaseProvider extends SummatiaDatabaseProvider {
	constructor(db: Database) {
		super("splatoon3", db);
	}

	tables() {
		return ["s3subs", "s3past"];
	}

	protected migrations(): (() => any | Promise<any>)[] {
		return [
			() => {
				this.createIfNotExist("s3subs", "id TEXT NOT NULL PRIMARY KEY, bitflag INTEGER NOT NULL");
				this.createIfNotExist("s3past", "id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, s3id VARCHAR(32) NOT NULL");
			}
		];
	}

	setSubscriptions(id: string, manipulator: BitflagManipulator) {
		const row = this.get<{ id: string }>("SELECT id FROM s3subs WHERE id = ?", [id]);
		if (row?.id) {
			if (!manipulator.bitflag) this.run("DELETE FROM s3subs WHERE id = ?", [id]);
			else this.run("UPDATE s3subs SET bitflag = ? WHERE id = ?", [manipulator.bitflag, id]);
		} else if (manipulator.bitflag) this.run("INSERT INTO s3subs VALUES (?, ?)", [id, manipulator.bitflag]);
	}

	getAllSubscriptions() {
		const map = new Map<string, BitflagManipulator>();
		(this.all<{ id: string, bitflag: number }>("SELECT * FROM s3subs") || []).forEach(r => map.set(r.id, new BitflagManipulator(r.bitflag)));
		return map;
	}

	async addPastFest(s3id: string) {
		this.run("INSERT INTO s3past (s3id) VALUES (?)", [s3id]);
	}

	async getPastFests() {
		return (this.all<{ s3id: string }>("SELECT s3id FROM s3past"))?.map(x => x.s3id) || [];
	}
}