import { Message, Snowflake, TextChannel } from "discord.js";
import { SummatiaModule, DiscordHandler, SummatiaListeners } from "..";
import { Summatia } from "../../summatia";
import LLMPipeline from "../../helpers/llm";
import { TextClassificationOutput } from "@huggingface/transformers";
import isUrl from "is-url";

export class ScamModerationModule extends SummatiaModule implements DiscordHandler {
	constructor() {
		super("scam", { listen: [SummatiaListeners.DISCORD_MESSAGE] });
	}

	async onDiscordMessage(_summatia: Summatia, message: Message) {
		if (message.guild) {
			const ownerId = message.guild.ownerId;
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
					await message.reply(`<@${ownerId}> I think that's a scam <:think:1466025457983033557>`);
			}
		}
	}
}