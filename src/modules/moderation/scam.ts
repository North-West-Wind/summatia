import { ChatInputCommandInteraction, Message, SlashCommandBuilder, SlashCommandStringOption, TextChannel } from "discord.js";
import { DiscordHandler, SummatiaListeners } from "..";
import { Summatia } from "../../summatia";
import LLMPipeline from "../../helpers/llm";
import { TextClassificationOutput, TextClassificationPipeline } from "@huggingface/transformers";
import isUrl from "is-url";
import { SummatiaCommandHelpModule } from "../commands";
import { RoomMessageEvent } from "../../types/events";

export class ScamModerationModule extends SummatiaCommandHelpModule implements DiscordHandler {
	constructor() {
		super("scam", { listen: [SummatiaListeners.DISCORD_MESSAGE] });
	}

	description() {
		return "Tests phishing score of a message.";
	}

	examples() {
		return ["scam free money"];
	}

	getSlashCommandBuilder() {
		const data = new SlashCommandBuilder().setName(this.name).setDescription(this.description());
		data.addStringOption(new SlashCommandStringOption().setName("message").setDescription("Message to test.").setRequired(true));
		return data;
	}

	async onDiscordCommandInteraction(_summatia: Summatia, interaction: ChatInputCommandInteraction) {
		await interaction.deferReply();
		try {
			const { label, score } = await this.classify(interaction.options.getString("message", true));
			await interaction.editReply(`Label: ${label} | Score: ${score}`);
		} catch (err) {
			await interaction.editReply("Failed to classify message");
		}
	}

	async onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {
		if (event.content.msgtype != "m.text" || !event.content.body.startsWith(summatia.prefix + this.name)) return;
		const message = event.content.body.replace(summatia.prefix + this.name, "");
		try {
			const { label, score } = await this.classify(message);
			await summatia.matrix.replyText(roomId, event.event_id, `Label: ${label} | Score: ${score}`);
		} catch (err) {
			await summatia.matrix.replyText(roomId, event.event_id, "Failed to classify message");
		}
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
				const { label, score } = await this.classify(message.cleanContent);
				if (label == "phishing" && score > 0.99) {
					this.logger.log("Scam detected! Score: %d, Content: %s", score, message.cleanContent.slice(0, 512));
					await message.reply(`<@${ownerId}> I think that's a scam <:think:1466025457983033557>`);
				}
			}
		}
	}

	private async classify(message: string) {
		const classifier = await LLMPipeline.getInstance("text-classification", "onnx-community/bert-small-phishing-ONNX") as TextClassificationPipeline;
		const responses = (await classifier(message.slice(0, 512))) as TextClassificationOutput;
		return responses[0];
	}
}