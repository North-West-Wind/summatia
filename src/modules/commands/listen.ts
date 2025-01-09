import { ChatInputCommandInteraction, SlashCommandBuilder, SlashCommandIntegerOption } from "discord.js";
import { SummatiaCommandModule } from "../commands";
import { Summatia } from "../../summatia";
import { RoomMessageEvent } from "../../matrix/types/events";

export default class ListenCommand extends SummatiaCommandModule {
	constructor() {
		super("listen");
	}

	getSlashCommandBuilder() {
		const data = new SlashCommandBuilder()
			.setName(this.name)
			.setDescription("Make Summatia listen to this channel.");

		data.addIntegerOption(new SlashCommandIntegerOption().setName("chance").setDescription("Chance of Summatia responding.").setMinValue(0).setMaxValue(100).setRequired(true));
		return data;
	}

	async onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction) {
		await summatia.database.addListen(interaction.channelId, interaction.options.getInteger("chance", true));
		await interaction.reply("I'm listening to y'all talking.")
	}

	onMatrixMessage(_summatia: Summatia, _roomId: string, _event: RoomMessageEvent) {}
}