import { Message, MessageType, OmitPartialGroupDMChannel } from "discord.js";
import { search } from "google-sr";
import fetch from "node-fetch";
import { AbortSignal } from "node-fetch/externals";

import { Summatia } from "../../summatia";
import { RoomMessageEvent } from "../../types/events";
import { DiscordHandler, MatrixHandler, SummatiaListeners, SummatiaModule } from "..";
import { existsSync, readFileSync } from "fs";
import LLMPipeline from "../../helpers/llm";
import { Chat, TextGenerationOutput, TextGenerationPipeline } from "@huggingface/transformers";
import moment from "moment";

export default class AiModule extends SummatiaModule implements MatrixHandler, DiscordHandler {
	static readonly DEMENTIA = 300_000;
	memory: Map<string, { messages: Chat, lastChat: number }>;
	systemMessage: string;

	constructor() {
		super("ai", { listen: [SummatiaListeners.MATRIX_MESSAGE, SummatiaListeners.DISCORD_MESSAGE] });
		this.memory = new Map();
		if (existsSync("runtime/system.txt")) this.systemMessage = readFileSync("runtime.txt", "utf8");
		else this.systemMessage = "";
		this.systemMessage += "\nKeep your messages short";
		this.systemMessage += "\nYou can call the following functions to obtain additional information:" +
		"\n/time - Retrieve the current time in Hong Kong Time" +
		"\n/search - Search for a certain topic on the Internet";
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
			const memory = this.memory.get(roomId) || { messages: [], lastChat: Date.now() };
			if (Date.now() - memory.lastChat > AiModule.DEMENTIA) memory.messages = [];
			memory.messages.push(this.createUserMessage((await summatia.matrix.getUserProfile(event.sender)).displayname, platform, body, reply));
			const generator = await this.getPipeline();
			const res = await generator(memory.messages) as TextGenerationOutput;
			if (typeof res[0].generated_text === "string")
				await summatia.matrix.replyText(roomId, event, await this.ragOrReturn(res[0].generated_text as string, memory.messages));
			summatia.matrix.setTyping(roomId, false).catch(() => {}); // nobody cares if you can't set typing
		}
	}

	async onDiscordMessage(summatia: Summatia, message: OmitPartialGroupDMChannel<Message<boolean>>) {
		if (message.author.id == message.client.user.id ||
				message.author.bot && !message.webhookId ||
				await summatia.isMatrixInChannel(message.channelId)) return;
		if (!message.mentions.has(message.client.user.id) &&
				!message.content.toLowerCase().includes(message.client.user.username) &&
				!(message.type == MessageType.Reply &&
				message.reference?.messageId && (await message.fetchReference()).author.id == message.client.user.id)) return;
		const interval = setInterval(() => message.channel.sendTyping().catch(() => {}), 10000);
		let res: boolean | string | undefined;
		try {
			const memory = this.memory.get(message.channelId) || { messages: [], lastChat: Date.now() };
			if (Date.now() - memory.lastChat > AiModule.DEMENTIA) memory.messages = [];
			let reply: string | undefined;
			if (message.reference) {
				const ref = await message.fetchReference();
				if (ref.content) reply = ref.cleanContent;
			}

			if (message.channel.isDMBased())
				memory.messages.push(this.createUserMessage(message.author.displayName, "Discord Direct Message", message.cleanContent, reply));
			else
				memory.messages.push(this.createUserMessage(message.author.displayName, `Discord channel "${message.channel.name}" in server "${message.guild?.name}"`, message.cleanContent, reply));
			
			const generator = await this.getPipeline();
			const res = await generator(memory.messages) as TextGenerationOutput;
			if (typeof res[0].generated_text === "string")
				await message.reply(await this.ragOrReturn(res[0].generated_text as string, memory.messages));
	
			if (res && typeof res === "string")
				await message.channel.send(res);
		} catch (err) {
			this.logger.error("Failed to AI reply Discord.", err);
		}
		clearInterval(interval);
	}

	private createUserMessage(name: string, platform: string, message: string, reply?: string) {
		let content = "";
		content += `Platform: ${platform || "Unknown"}; `;
		content += `Message from ${name || "Unknown"}; `;
		if (reply) content += `In reply to:\n${reply}`;
		content += `\n\nMessage:\n${message}`;
		return { role: "user", content } as Chat[0];
	}

	private async getPipeline() {
		return (await LLMPipeline.getInstance("text-generation", "onnx-community/Qwen3-0.6B-ONNX")) as TextGenerationPipeline;
	}

	private async ragOrReturn(response: string, messages: Chat): Promise<string> {
		const args = response.split(" ");
		const generator = await this.getPipeline();
		let content: string;
		switch (args[0]) {
			case "/time":
				content = `Command: /time\n`;
				content = `Current time in Hong Kong: ${moment().format("HH:mm:ss Do MMMM YYYY")}`;
				messages.push({ role: "user", content });
				return this.ragOrReturn((await generator(messages) as TextGenerationOutput)[0].generated_text as string, messages);
			case "/search":
				search({ query: args.slice(1).join(" "), requestConfig: { queryParams: { gl: "us" } } })
				content = `Command: /time\n`;
				content = `Current time in Hong Kong: ${moment().format("HH:mm:ss Do MMMM YYYY")}`;
				messages.push({ role: "user", content });
				return this.ragOrReturn((await generator(messages) as TextGenerationOutput)[0].generated_text as string, messages);
			default:
				return response;
		}
	}
}