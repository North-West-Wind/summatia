import { Collection, Message, Snowflake, TextChannel } from "discord.js";
import { SummatiaModule, DiscordHandler, SummatiaListeners } from "..";
import { Summatia } from "../../summatia";
import LLMPipeline from "../../helpers/llm";
import { TextClassificationOutput } from "@huggingface/transformers";
import isUrl from "is-url";

const RESET_DURATION = 5000;
const SPAM_CHANNELS = 4;

type UserID = Snowflake;
type ChannelID = Snowflake;
type MessageID = Snowflake;

export class ScamModerationModule extends SummatiaModule implements DiscordHandler {
	window: Map<UserID, Map<ChannelID, { timeout: NodeJS.Timeout, messages: Set<MessageID> }>>;

	constructor() {
		super("scam", { listen: [SummatiaListeners.DISCORD_MESSAGE] });
		this.window = new Map();
	}

	async onDiscordMessage(_summatia: Summatia, message: Message) {
		const ownerId = message.guild?.ownerId || "416227242264363008";

		// @everyone and then crypto images
		if (message.content == "@everyone" && (message.attachments.size == 4 || message.attachments.size == 5)) {
			await message.delete();
			await (message.channel as TextChannel).send("Highly suspicious. Get bonked <:bonk:1465722513861378244>");
		}
		// ScamLLM classifier
		else if (message.content && !isUrl(message.content)) {
			const classifier = await LLMPipeline.getInstance("text-classification", "onnx-community/ScamLLM-ONNX");
			const responses = (await classifier(message.content)) as TextClassificationOutput;
			if (responses[0].label == "LABEL_1" && responses[0].score > 0.8)
				await message.reply(`<@${ownerId}}> I think that's a scam <:think:1466025457983033557>`);
		}

		// Multi-channel spammer
		const channelMap = this.window.get(message.author.id) || new Map<ChannelID, { timeout: NodeJS.Timeout, messages: Set<MessageID> }>();
		if (channelMap.has(message.channelId)) {
			const map = channelMap.get(message.channelId)!;
			map.timeout.refresh();
			map.messages.add(message.id);
		} else {
			channelMap.set(message.channelId, { timeout: setTimeout(() => {
				const channelMap = this.window.get(message.author.id);
				if (!channelMap) return;
				channelMap.delete(message.channelId);
				if (channelMap.size == 0) this.window.delete(message.author.id);
			}, RESET_DURATION), messages: new Set([message.id]) });
		}
		let maxSize = SPAM_CHANNELS;
		try {
			const channels = await message.guild?.channels.fetch();
			if (channels && channels.size < maxSize) maxSize = channels.size;
		} catch (err) {
			this.logger.error("Failed to fetch channels", err);
		}
		if (channelMap.size >= maxSize) {
			await (message.channel as TextChannel).send(`<@${ownerId}> Spam detected. <@${message.author.id}> will be in timeout for the next hour`);
			await message.member?.timeout(3600000, "Spam detection by Summatia");
			for (const [channelId, { timeout, messages }] of channelMap.entries()) {
				try {
					timeout.close();
					const channel = await message.guild?.channels.fetch(channelId) as TextChannel;
					await channel.bulkDelete(Array.from(messages));
				} catch (err) {
					this.logger.error("Failed to remove messages in channel " + channelId, err);
				}
			}
			channelMap.clear();
			this.window.delete(message.author.id);
		} else this.window.set(message.author.id, channelMap);
	}
}