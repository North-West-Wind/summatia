import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { SummatiaCommandHelpModule } from "../commands";
import { Summatia } from "../../summatia";
import { RoomMessageEvent } from "../../types/events";
import { SummatiaListeners } from "..";

export default class UnlistenCommand extends SummatiaCommandHelpModule {
	constructor() {
		super("unlisten", { listen: [SummatiaListeners.HELP_DISCORD] });
	}

	description() {
		return "Stops me from listening to this channel.";
	}

	examples() {
		return ["unlisten"];
	}

	getSlashCommandBuilder() {
		return new SlashCommandBuilder()
			.setName(this.name)
			.setDescription(this.description());
	}

	async onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction) {
		await summatia.database.providers.listen.removeListen(interaction.channelId);
		await interaction.reply("Welp. Bye!");
	}

	onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {}
}