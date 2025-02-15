import { ChatInputCommandInteraction,SlashCommandBuilder } from "discord.js";

import { Summatia } from "../../summatia";
import { RoomMessageEvent } from "../../types/events";
import { SummatiaListeners } from "..";
import { SummatiaCommandHelpModule } from "../commands";

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

	onMatrixMessage(_summatia: Summatia, _roomId: string, _event: RoomMessageEvent) {}
}