import * as fs from "fs";
import { AutojoinRoomsMixin, AutojoinUpgradedRoomsMixin, MatrixClient, RustSdkCryptoStorageProvider, SimpleFsStorageProvider } from "matrix-bot-sdk";
import { RoomMessageEvent } from "./types/events";
import { LISTEN_MODULES, SummatiaListeners } from "./modules";

if (!process.env.MATRIX_HOMESERVER) throw new Error("homeserver not set");
if (!process.env.MATRIX_TOKEN) throw new Error("bot token not set");

if (!fs.existsSync("runtime") || !fs.statSync("runtime").isDirectory()) fs.mkdirSync("runtime");
if (!fs.existsSync("runtime/crypto") || !fs.statSync("runtime/crypto").isDirectory()) fs.mkdirSync("runtime/crypto");

const storage = new SimpleFsStorageProvider("runtime/matrix.json");
const cryptoStorage = new RustSdkCryptoStorageProvider("runtime/crypto");

const client = new MatrixClient(process.env.MATRIX_HOMESERVER!, process.env.MATRIX_TOKEN!, storage, cryptoStorage);
AutojoinRoomsMixin.setupOnClient(client);
AutojoinUpgradedRoomsMixin.setupOnClient(client);

client.on("room.message", (roomId: string, event: RoomMessageEvent) => {
	LISTEN_MODULES[SummatiaListeners.MESSAGE]?.forEach(module => module.onMessage(client, roomId, event));
});

client.start().then(async () => console.log(`${await client.getUserId()} is ready!`));