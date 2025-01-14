import { ChatInputCommandInteraction, SlashCommandBuilder, SlashCommandIntegerOption } from "discord.js";
import { SummatiaCommandHelpModule, SummatiaCommandModule } from "../commands";
import { Summatia } from "../../summatia";
import { RoomMessageEvent } from "../../matrix/types/events";
import { SummatiaListeners } from "..";

export default class ListenCommand extends SummatiaCommandHelpModule {
	constructor() {
		super("listen", { listen: [SummatiaListeners.HELP_DISCORD] });
	}

	description() {
		return "Allows me to listen to your conversations."
	}

	examples() {
		return ["listen"];
	}

	getSlashCommandBuilder() {
		const data = new SlashCommandBuilder()
			.setName(this.name)
			.setDescription(this.description());

		data.addIntegerOption(new SlashCommandIntegerOption().setName("chance").setDescription("Chance of responding.").setMinValue(0).setMaxValue(100).setRequired(true));
		return data;
	}

	async onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction) {
		await summatia.database.addListen(interaction.channelId, interaction.options.getInteger("chance", true));
		await interaction.reply("I'm listening to y'all talking.")
	}

	onMatrixMessage(_summatia: Summatia, _roomId: string, _event: RoomMessageEvent) {}
}