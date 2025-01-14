import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Helpful, MatrixHandler, SummatiaListeners, SummatiaModule, SummatiaOption } from ".";
import { RoomMessageEvent } from "../matrix/types/events";
import { Summatia } from "../summatia";

export abstract class SummatiaCommandModule extends SummatiaModule implements MatrixHandler {
	constructor(name: string, options: SummatiaOption = { listen: [] }) {
		options.listen = addNoRepeat(options.listen, SummatiaListeners.MATRIX_MESSAGE, SummatiaListeners.DISCORD_COMMAND_INTERACTION);
		super(name, options);
	}

	abstract getSlashCommandBuilder(summatia: Summatia): SlashCommandBuilder;

	abstract onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction): any | Promise<any>;
	abstract onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent): any | Promise<any>;
}

export abstract class SummatiaCommandHelpModule extends SummatiaCommandModule implements Helpful {
	constructor(name: string, options: SummatiaOption = { listen: [] }) {
		options.listen = addNoRepeat(options.listen, SummatiaListeners.HELP);
		super(name, options);
	}

	abstract description(): string;
	abstract examples(): string[];
}

function addNoRepeat<T>(arr: T[], ...additions: T[]): T[] {
	return Array.from(new Set(arr.concat(additions)));
}