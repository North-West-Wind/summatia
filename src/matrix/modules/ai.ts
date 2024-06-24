import { MatrixClient } from "matrix-bot-sdk";
import { SummatiaListeners, SummatiaModule } from ".";
import { RoomMessageEvent } from "../types/events";
import { discordId } from "../..";
import { chat, isOnline } from "../../api";
import { getRoomParents } from "../helpers/rooms";

export default class AiModule extends SummatiaModule {
	constructor() {
		super({ listen: [SummatiaListeners.MESSAGE] });
	}

	async onMessage(client: MatrixClient, roomId: string, event: RoomMessageEvent) {
		if (event.content?.msgtype !== 'm.text') return;
		const selfId = await client.getUserId()
		if (event.sender === selfId || event.sender === "@discord_" + discordId() + ":matrix.northwestw.in") return;
	
		let body = event.content.body, bridged = false;
	
		const states = await client.getRoomState(roomId);
		let name = states.filter(state => state.type == "m.room.name").pop()?.content.name || "";
		let members = (states.map(state => {
			if (state.type != "m.room.member") return 0;
			if (state.content.membership == "join") {
				if (state.state_key === "@discord_" + discordId() + ":matrix.northwestw.in") bridged = true;
				return 1;
			}
			if (state.content.membership == "leave") return -1;
			return 0;
		}) as number[]).reduce((a, b) => a + b);
	
		if (bridged) return;
	
		let replyToMe = false;
		let reply: string | undefined;
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
				else {
					body = newBody.join("\n");
					reply = previous.join("\n");
				}
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
			let res = await chat((await client.getUserProfile(event.sender)).displayname, platform, { message: body, reply }, Date.now() - event.origin_server_ts > 60000);
			if (typeof res === "string") await client.replyText(roomId, event, res);
			client.setTyping(roomId, false).catch(() => {}); // nobody cares if you can't set typing
		}
	}
}