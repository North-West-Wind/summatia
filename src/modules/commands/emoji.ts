import { SlashCommandBuilder, ChatInputCommandInteraction, SlashCommandSubcommandBuilder, ModalBuilder, SlashCommandAttachmentOption, SlashCommandStringOption } from "discord.js";
import { Summatia } from "../../summatia";
import { SummatiaDiscordCommandHelpModule } from "../commands";

export class EmojiCommand extends SummatiaDiscordCommandHelpModule {
	constructor() {
		super("emoji");
	}

	description() {
		return "50+ server emojis without boosts!";
	}

	examples(): string[] {
		return [
			"emoji add",
			"emoji use",
			"emoji delete"
		];
	}

	getSlashCommandBuilder() {
		const data = new SlashCommandBuilder()
			.setName(this.name)
			.setDescription(this.description());

		data.addSubcommand(new SlashCommandSubcommandBuilder()
			.setName("add")
			.setDescription("Upload an emoji to the server.")
			.addAttachmentOption(new SlashCommandAttachmentOption().setName("image").setDescription("The image that will become an emoji.").setRequired(true))
			.addStringOption(new SlashCommandStringOption().setName("name").setDescription("The name to use for this emoji.").setRequired(false)));
		data.addSubcommand(new SlashCommandSubcommandBuilder().setName("use").setDescription("Swap an emoji into use."));
		data.addSubcommand(new SlashCommandSubcommandBuilder().setName("delete").setDescription("Delete an emoji from the server."));

		return data;
	}

	async onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction) {
		if (!interaction.guild) return await interaction.reply("I can only do this in servers!");
		const subcommand = interaction.options.getSubcommand();
		const modal = new ModalBuilder().setCustomId(this.name);

		switch (subcommand) {
			case "add": {
				const attachment = interaction.options.getAttachment("image", true);
				const name = interaction.options.getString("name");
				if (!attachment.contentType?.startsWith("image/")) return await interaction.reply("The attachment is not an image! -▵-");
				if (attachment.size >= 1 * 1024 * 1024) return await interaction.reply("The image is too big! >▵<");
				interaction.guild.emojis.create({ attachment: attachment.url, name: name || attachment.name.split(".").slice(0, -1).join(".") });
				break;
			}
			case "use": {
				break;
			}
			case "delete": {
				break;
			}
			default: return await interaction.reply("WHAT!?");
		}

		await interaction.showModal(modal); 
	}
}