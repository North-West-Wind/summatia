import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { DiscordCommandHandler, Helpful, MatrixHandler, SummatiaListeners, SummatiaModule, SummatiaOption } from ".";
import { RoomMessageEvent } from "../types/events";
import { Summatia } from "../summatia";

export abstract class SummatiaCommandModule extends SummatiaModule implements MatrixHandler, DiscordCommandHandler {
	constructor(name: string, options: SummatiaOption = { listen: [] }) {
		options.listen = addNoRepeat(options.listen, SummatiaListeners.MATRIX_MESSAGE, SummatiaListeners.DISCORD_COMMAND_INTERACTION);
		super(name, options);
	}

	abstract getSlashCommandBuilder(summatia: Summatia): SlashCommandBuilder;

	abstract onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction): any | Promise<any>;
	abstract onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent): any | Promise<any>;

	isValidMatrixCommand(summatia: Summatia, event: RoomMessageEvent) {
		return event.content.msgtype == "m.text" && event.content.body.startsWith(summatia.prefix + this.name);
	}

	getMatrixArgs(summatia: Summatia, body: string) {
		const args = body.slice(summatia.prefix.length).split(/\s+/);
		args.shift();
		return args;
	}
}

export abstract class SummatiaCommandHelpModule extends SummatiaCommandModule implements Helpful {
	constructor(name: string, options: SummatiaOption = { listen: [] }) {
		options.listen = addNoRepeat(options.listen, SummatiaListeners.HELP);
		super(name, options);
	}

	abstract description(): string;
	abstract examples(): string[];
}

export abstract class SummatiaMatrixCommandHelpModule extends SummatiaModule implements MatrixHandler, Helpful {
	constructor(name: string, options: SummatiaOption = { listen: [] }) {
		options.listen = addNoRepeat(options.listen, SummatiaListeners.MATRIX_MESSAGE, SummatiaListeners.HELP_MATRIX, SummatiaListeners.HELP);
		super(name, options);
	}

	abstract description(): string;
	abstract examples(): string[];
	abstract onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent): any | Promise<any>;
}

export abstract class SummatiaDiscordCommandHelpModule extends SummatiaModule implements Helpful, DiscordCommandHandler {
	constructor(name: string, options: SummatiaOption = { listen: [] }) {
		options.listen = addNoRepeat(options.listen, SummatiaListeners.DISCORD_COMMAND_INTERACTION, SummatiaListeners.HELP_DISCORD, SummatiaListeners.HELP);
		super(name, options);
	}

	abstract description(): string;
	abstract examples(): string[];
	abstract getSlashCommandBuilder(summatia: Summatia): SlashCommandBuilder;
	abstract onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction): any | Promise<any>;
}

function addNoRepeat<T>(arr: T[], ...additions: T[]): T[] {
	return Array.from(new Set(arr.concat(additions)));
}