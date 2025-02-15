import { randomUUID } from "crypto";
import express from "express";
import { AddressInfo } from "net";
import Logger from "./helpers/logger";

const PORT = 3128; // It sounds like "Summatia" in Cantonese lol
const HOST = "https://smta.northwestw.in";

export class SummatiaRest {
	app: express.Express;
	tmpFiles: Map<string, { data: Buffer, type: string }>;

	constructor() {
		this.app = express();
		this.tmpFiles = new Map();
	}

	setup() {
		this.app.get("/tmp/:id", (req, res) => {
			this.log("Received request for", req.params.id);
			if (!this.tmpFiles.has(req.params.id)) return res.status(404);
			const file = this.tmpFiles.get(req.params.id)!;
			res.setHeader("Content-Type", file.type);
			res.end(file.data);
		});

		this.log("Finished REST setup");
	}

	start() {
		const server = this.app.listen(process.env.PORT || PORT, () => Logger.rest.log(`REST listening at port ${(server.address() as AddressInfo).port}`));
	}

	fullPath(path: string) {
		return `${process.env.HOST || HOST}${path}`;
	}

	addTmpFile(data: Buffer, type: string, timeout: number) {
		const uuid = randomUUID();
		this.tmpFiles.set(uuid, { data, type });
		this.log("Added tmp file", uuid);
		setTimeout(() => this.tmpFiles.delete(uuid), timeout);
		return uuid;
	}
}