import * as fs from "fs";
import { AutojoinRoomsMixin, AutojoinUpgradedRoomsMixin, MatrixClient, RustSdkCryptoStorageProvider, SimpleFsStorageProvider } from "matrix-bot-sdk";
import { RoomMessageEvent } from "./types/events";
import { chat, isOnline } from "../api";
import { discordId } from "..";
import { getRoomParents } from "./helpers/rooms";

if (!process.env.MATRIX_HOMESERVER) throw new Error("homeserver not set");
if (!process.env.MATRIX_TOKEN) throw new Error("bot token not set");

if (!fs.existsSync("runtime") || !fs.statSync("runtime").isDirectory()) fs.mkdirSync("runtime");
if (!fs.existsSync("runtime/crypto") || !fs.statSync("runtime/crypto").isDirectory()) fs.mkdirSync("runtime/crypto");

const storage = new SimpleFsStorageProvider("runtime/matrix.json");
const cryptoStorage = new RustSdkCryptoStorageProvider("runtime/crypto");

const client = new MatrixClient(process.env.MATRIX_HOMESERVER!, process.env.MATRIX_TOKEN!, storage, cryptoStorage);
AutojoinRoomsMixin.setupOnClient(client);
AutojoinUpgradedRoomsMixin.setupOnClient(client);

client.on("room.message", async (roomId: string, event: RoomMessageEvent) => {
	if (event.content?.msgtype !== 'm.text') return;
	const selfId = await client.getUserId()
	if (event.sender === selfId || event.sender === "@discord_" + discordId()) return;

	const body = event.content.body;

	const states = await client.getRoomState(roomId);
	let name = states.filter(state => state.type == "m.room.name").pop()?.content.name || "";
	let members = (states.map(state => {
		if (state.type != "m.room.member") return 0;
		if (state.content.membership == "join") return 1;
		if (state.content.membership == "leave") return -1;
		return 0;
	}) as number[]).reduce((a, b) => a + b);

	let replyToMe = false;
	const replyEventId = (event.content["m.relates_to"] as any)?.["m.in_reply_to"]?.event_id;
	try {
		replyToMe = replyEventId && (await client.getEvent(roomId, replyEventId))?.sender === selfId;
	} catch (err) {
		console.error(err);
	}

	if (body.includes(selfId) || body.toLowerCase().includes("summatia") || members == 2 && !name || replyToMe) {
		if (!(await isOnline())) return;
		let parents: string[] = [];
		const parentState = states.filter(state => state.type == "m.space.parent").pop();
		if (parentState) parents = await getRoomParents(client, parentState.state_key);
		let platform: string;
		if (members == 2 && !name) platform = "Matrix Direct Message";
		else platform = `Matrix room "${name}" in space "${parents.reverse().join("/")}"`;
		let res = await chat((await client.getUserProfile(event.sender)).displayName, platform, { message: body }, false);
		if (typeof res === "string") await client.replyText(roomId, event, res);
	}
});

client.start().then(async () => console.log(`${await client.getUserId()} is ready!`));