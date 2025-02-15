import { Message, MessageType, OmitPartialGroupDMChannel } from "discord.js";
import fetch from "node-fetch";
import { AbortSignal } from "node-fetch/externals";

import { Summatia } from "../summatia";
import { RoomMessageEvent } from "../types/events";
import { DiscordHandler, MatrixHandler, SummatiaListeners, SummatiaModule } from ".";

export default class AiModule extends SummatiaModule implements MatrixHandler, DiscordHandler {
	constructor() {
		if (!process.env.OLLAMA_MEMORY_HOST) throw new Error("ollama-memory host not set");
		super("ai", { listen: [SummatiaListeners.MATRIX_MESSAGE, SummatiaListeners.DISCORD_MESSAGE] });
	}

	async onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {
		if (event.content?.msgtype !== 'm.text') return;
		if (await summatia.isDiscordInRoom(roomId)) return;
	
		let body = event.content.body;
	
		const states = await summatia.matrix.getRoomState(roomId);
		const name = states.filter(state => state.type == "m.room.name").pop()?.content.name || "";
		// get the number of members in the room
		const members = (states.map(state => {
			if (state.type != "m.room.member") return 0;
			if (state.content.membership == "join") return 1;
			if (state.content.membership == "leave") return -1;
			return 0;
		}) as number[]).reduce((a, b) => a + b);
	
		const selfId = await summatia.matrix.getUserId();
		let replyToMe = false;
		let reply: string | undefined;
		const replyEventId = (event.content["m.relates_to"] as any)?.["m.in_reply_to"].event_id;
		if (replyEventId) {
			try {
				replyToMe = (await summatia.matrix.getEvent(roomId, replyEventId))?.sender === selfId;
				// separate reply and new message
				const previous: string[] = [];
				const newBody: string[] = [];
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
				this.logger.error("Failed to get reply relation event.", err);
			}
		}

		if (body.includes(selfId) || body.toLowerCase().includes("summatia") || members == 2 && !name || replyToMe) {
			if (!(await this.isOnline())) return;
			summatia.matrix.setTyping(roomId, true).catch(() => {}); // nobody cares if you can't set typing
			let parents: string[] = [];
			const parentState = states.filter(state => state.type == "m.space.parent").pop();
			if (parentState) parents = await summatia.getRoomParents(parentState.state_key);
			let platform: string;
			if (members == 2 && !name) platform = "Matrix Direct Message";
			else platform = `Matrix room "${name}" in space "${parents.reverse().join("/")}"`;
			const matches = body.match(/<@[\w\d]+:[\w\d.]+>/g);
			if (matches)
				for (const match of matches) {
					try {
						const profile = await summatia.matrix.getUserProfile(match.slice(1, -1));
						if (profile) body = body.replace(new RegExp(match.replace(/\./, "\\."), "g"), "@" + profile.displayname);
					} catch (err) {
						this.logger.error(`Failed to get user profile of ${match.slice(1, -1)}`, err);
					}
				}
			const res = await this.chat((await summatia.matrix.getUserProfile(event.sender)).displayname, platform, { message: body, reply }, Date.now() - event.origin_server_ts > 60000);
			if (typeof res === "string") await summatia.matrix.replyText(roomId, event, res);
			summatia.matrix.setTyping(roomId, false).catch(() => {}); // nobody cares if you can't set typing
		}
	}

	async onDiscordMessage(summatia: Summatia, message: OmitPartialGroupDMChannel<Message<boolean>>) {
		if (message.author.id == message.client.user.id ||
				message.author.bot && !message.webhookId ||
				await summatia.isMatrixInChannel(message.channelId) ||
				!(await this.isOnline())) return;
		const interval = setInterval(() => message.channel.sendTyping().catch(() => {}), 10000);
		let res: boolean | string | undefined;
		try {
			if (message.channel.isDMBased()) res = await this.chatDiscord(message.author.displayName, "Discord Direct Message", message, false);
			else if (message.mentions.has(message.client.user.id) ||
				message.content.toLowerCase().includes("summatia") ||
				message.type == MessageType.Reply && message.reference?.messageId && (await message.channel.messages.fetch(message.reference.messageId)).author.id == message.client.user.id) res = await this.chatDiscord(message.author.displayName, `Discord channel "${message.channel.name}" in server "${message.guild?.name}"`, message, false);
			else {
				const chance = await summatia.database.providers.listen.shouldListen(message.channelId);
				if (chance >= 0) res = await this.chatDiscord(message.author.displayName, `Discord channel "${message.channel.name}" in server "${message.guild?.name}"`, message, Math.random() * 100 > chance);
			}
	
			if (res && typeof res === "string")
				await message.channel.send(res);
		} catch (err) {
			this.logger.error("Failed to AI reply Discord.", err);
		}
		clearInterval(interval);
	}

	private async isOnline() {
		const res = await fetch(process.env.OLLAMA_MEMORY_HOST! + "/check");
		return res.ok;
	}

	private async chat(name: string, platform: string, content: ({ message: string, images?: string[] } | { message?: string, images: string[] }) & { reply?: string }, noResponse: boolean) {
		const sendObj: { name: string, platform: string, noResponse: boolean, message?: string, reply?: string, images?: string[] } = {
			name,
			platform,
			noResponse
		};
		if (content.message) sendObj.message = content.message;
		if (content.images) sendObj.images = content.images;
		try {
			const res = await fetch(process.env.OLLAMA_MEMORY_HOST! + "/chat/summatia", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(sendObj),
				signal: AbortSignal.timeout(1800_000) as AbortSignal // 30 minute timeout
			});
			const json = await res.json();
			if (json.error) return false;
			else return noResponse ? true : json.message.content;
		} catch (err) {
			return false;
		}
	}

	private async chatDiscord(name: string, platform: string, message: Message, noResponse: boolean) {
		let msg: string | undefined, reply: string | undefined;
		let imgs: string[] | undefined;
		if (message.content) msg = message.cleanContent;
		if (message.reference) {
			const ref = await message.fetchReference();
			if (ref.content) reply = ref.cleanContent;
		}
		if (message.attachments.size) {
			const images: string[] = [];
			for (const attachment of message.attachments.values()) {
				if (!attachment.contentType?.startsWith("image/")) continue;
				try {
					const res = await fetch(attachment.url);
					if (res.ok) images.push((await res.buffer()).toString("base64"));
				} catch (err) {
					this.logger.error("Failed to convert attachment to Base64.", err);
				}
			}
			imgs = images;
		}
		return await this.chat(name, platform, { message: msg!, images: imgs!, reply }, noResponse);
	}
}