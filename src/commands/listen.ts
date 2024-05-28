import { ChatInputCommandInteraction, SlashCommandBuilder, SlashCommandIntegerOption } from "discord.js";
import Command from "../types/command";
import { addListen } from "../db";

export default class ListenCommand implements Command {
	name: string;
	data: SlashCommandBuilder;

	constructor() {
		this.name = "listen";
		this.data = new SlashCommandBuilder()
			.setName(this.name)
			.setDescription("Make Summatia listen to this channel.");

		this.data.addIntegerOption(new SlashCommandIntegerOption().setName("chance").setDescription("Chance of Summatia responding.").setMinValue(0).setMaxValue(100).setRequired(true))
	}

	async execute(interaction: ChatInputCommandInteraction) {
		await addListen(interaction.channelId, interaction.options.getInteger("chance", true));
		await interaction.reply("I'm listening to y'all talking.")
	}
}