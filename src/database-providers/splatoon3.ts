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
	async init() {
		await this.createIfNotExist("s3subs", "id TEXT NOT NULL PRIMARY KEY, bitflag INTEGER NOT NULL");
	}

	async getSubscriptions(id: string) {
		const row = await this.get<{ bitflag: number }>("SELECT bitflag FROM s3subs WHERE id = ?", [id]);
		return new BitflagManipulator(row?.bitflag || 0);
	}

	async setSubscriptions(id: string, manipulator: BitflagManipulator) {
		const row = await this.get("SELECT id FROM s3subs WHERE id = ?", [id]);
		if (row) {
			if (manipulator.bitflag) await this.run("DELETE FROM s3subs WHERE id = ?", [id]);
			else await this.run("UPDATE s3subs SET bitflag = ? WHERE id = ?", [manipulator.bitflag, id]);
		} else if (manipulator.bitflag) await this.run("INSERT INTO s3subs VALUES (?, ?)", [id, manipulator.bitflag]);
	}

	async getAllSubscriptions() {
		const map = new Map<string, BitflagManipulator>();
		(await this.all<{ roomId: string, bitflag: number }>("SELECT * FROM s3subs") || []).forEach(r => map.set(r.roomId, new BitflagManipulator(r.bitflag)));
		return map;
	}
}