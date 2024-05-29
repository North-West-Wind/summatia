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

	let body = event.content.body;

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
	if (replyEventId) {
		try {
			replyToMe = (await client.getEvent(roomId, replyEventId))?.sender === selfId;
			// separate reply and new message
			let previous: string[] = [];
			let newBody: string[] = [];
			let seenNonReply = false;
			for (const line of body.split("\n")) {
				if (seenNonReply || !line.startsWith("> ")) {
					newBody.push(line);
					seenNonReply = true;
				} else previous.push(line.slice(2));
			}

			if (previous.some(s => s.toLowerCase().includes("summatia")) && !newBody.some(s => s.toLowerCase().includes("summatia"))) body = ""; // wipe body because this is not a real mention
			else body = newBody.join("\n") + "\n\nIn reply to:\n" + previous.join("\n");
		} catch (err) {
			console.error(err);
		}
	}

	if (body.includes(selfId) || body.toLowerCase().includes("summatia") || members == 2 && !name || replyToMe) {
		if (!(await isOnline())) return;
		client.setTyping(roomId, true).catch(() => {}); // nobody cares if you can't set typing
		let parents: string[] = [];
		const parentState = states.filter(state => state.type == "m.space.parent").pop();
		if (parentState) parents = await getRoomParents(client, parentState.state_key);
		let platform: string;
		if (members == 2 && !name) platform = "Matrix Direct Message";
		else platform = `Matrix room "${name}" in space "${parents.reverse().join("/")}"`;
		const matches = body.match(/<@[\w\d]+:[\w\d.]+>/g);
		if (matches)
			for (const match of matches) {
				try {
					const profile = await client.getUserProfile(match.slice(1, -1));
					if (profile) body = body.replace(new RegExp(match.replace(/\./, "\\."), "g"), "@" + profile.displayname);
				} catch (err) { }
			}
		let res = await chat((await client.getUserProfile(event.sender)).displayname, platform, { message: body }, false);
		if (typeof res === "string") await client.replyText(roomId, event, res);
		client.setTyping(roomId, false).catch(() => {}); // nobody cares if you can't set typing
	}
});

client.start().then(async () => console.log(`${await client.getUserId()} is ready!`));