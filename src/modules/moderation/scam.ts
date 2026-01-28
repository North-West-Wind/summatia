import { Message, TextChannel } from "discord.js";
import { SummatiaModule, DiscordHandler, SummatiaListeners } from "..";
import { Summatia } from "../../summatia";
import LLMPipeline from "../../helpers/llm";
import { TextClassificationOutput } from "@huggingface/transformers";

export class ScamModerationModule extends SummatiaModule implements DiscordHandler {
	constructor() {
		super("spam", { listen: [SummatiaListeners.DISCORD_MESSAGE] });
	}

	async onDiscordMessage(_summatia: Summatia, message: Message) {
		// @everyone and then crypto images
		if (message.content == "@everyone" && (message.attachments.size == 4 || message.attachments.size == 5)) {
			await message.delete();
			await (message.channel as TextChannel).send("Highly suspicious. Get bonked <:bonk:1465722513861378244>");
		}
		// ScamLLM classifier
		if (message.content) {
			const classifier = await LLMPipeline.getInstance("text-classification", "onnx-community/ScamLLM-ONNX");
			const responses = (await classifier(message.content)) as TextClassificationOutput;
			console.log(responses);
			if (responses[0].label == "Label 1")
				await (message.channel as TextChannel).send("<@416227242264363008> I think that's a scam <:think:1466025457983033557>");
		}
	}
}