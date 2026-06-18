import { Message, TextChannel } from "discord.js";
import { SummatiaModule, DiscordHandler, SummatiaListeners } from "..";
import { Summatia } from "../../summatia";
import LLMPipeline from "../../helpers/llm";
import { TextClassificationOutput, TextClassificationPipeline } from "@huggingface/transformers";
import isUrl from "is-url";

export class ScamModerationModule extends SummatiaModule implements DiscordHandler {
	constructor() {
		super("scam", { listen: [SummatiaListeners.DISCORD_MESSAGE] });
	}

	async onDiscordMessage(_summatia: Summatia, message: Message) {
		if (message.guild) {
			const ownerId = message.guild.ownerId;
			// @everyone and then crypto images
			// this is not reliable anymore. the spam module takes care of this most of the time.
			if (message.content == "@everyone" && (message.attachments.size == 4 || message.attachments.size == 5)) {
				await message.delete();
				await (message.channel as TextChannel).send("Highly suspicious. Get bonked <:bonk:1465722513861378244>");
			}
			// scam classifier
			else if (message.content && !message.author.bot && !message.webhookId && !isUrl(message.content)) {
				const classifier = await LLMPipeline.getInstance("text-classification", "onnx-community/bert-small-phishing-ONNX") as TextClassificationPipeline;
				classifier.tokenizer.model_max_length
				const responses = (await classifier(message.cleanContent.slice(0, 512))) as TextClassificationOutput;
				if (responses[0].label == "phishing" && responses[0].score > 0.9) {
					this.logger.log("Scam detected! Score: %d, Content: %s", responses[0].score, message.cleanContent.slice(0, 512));
					await message.reply(`<@${ownerId}> I think that's a scam <:think:1466025457983033557>`);
				}
			}
		}
	}
}