import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { MatrixHandler, SummatiaListeners, SummatiaModule, SummatiaOption } from ".";
import { RoomMessageEvent } from "../matrix/types/events";
import { Summatia } from "../summatia";

export abstract class SummatiaCommandModule extends SummatiaModule implements MatrixHandler {
	constructor(name: string, options: SummatiaOption = { listen: [] }) {
		const set = new Set(options.listen);
		set.add(SummatiaListeners.MATRIX_MESSAGE);
		set.add(SummatiaListeners.DISCORD_COMMAND_INTERACTION);
		options.listen = Array.from(set);
		super(name, options);
	}

	abstract getSlashCommandBuilder(): SlashCommandBuilder;

	abstract onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction): void | Promise<void>;
	abstract onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent): void | Promise<void>;
}