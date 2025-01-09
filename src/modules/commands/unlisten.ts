import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { SummatiaCommandModule } from "../commands";
import { Summatia } from "../../summatia";
import { RoomMessageEvent } from "../../matrix/types/events";

export default class UnlistenCommand extends SummatiaCommandModule {

	constructor() {
		super("unlisten");
	}

	getSlashCommandBuilder() {
		return new SlashCommandBuilder()
			.setName(this.name)
			.setDescription("Stop Summatia from listening to this channel.");
	}

	async onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction) {
		await summatia.database.removeListen(interaction.channelId);
		await interaction.reply("Welp. Bye!");
	}

	onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {}
}