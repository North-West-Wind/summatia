import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import Command from "../types/command";
import { removeListen } from "../db";

export default class UnlistenCommand implements Command {
	name: string;
	data: SlashCommandBuilder;

	constructor() {
		this.name = "unlisten";
		this.data = new SlashCommandBuilder()
			.setName(this.name)
			.setDescription("Stop Summatia from listening to this channel.");
	}

	async execute(interaction: ChatInputCommandInteraction) {
		await removeListen(interaction.channelId);
		await interaction.reply("Welp. Bye!");
	}
}