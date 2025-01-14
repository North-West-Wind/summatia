import { Message } from "discord.js";
import { RoomMessageEvent } from "../matrix/types/events";

export enum SummatiaListeners {
	// called before starting in setup
	INIT,
	
	// used for the "help" command. Matrix or Discord makes a feature only appear on MX/DC. Passing none makes it appears on both.
	HELP,
	HELP_MATRIX,
	HELP_DISCORD,

	// listen to Matrix or Discord events
	MATRIX_MESSAGE,
	DISCORD_MESSAGE,
	DISCORD_COMMAND_INTERACTION,
}

export type SummatiaOption = {
	listen: SummatiaListeners[];
}

export class SummatiaModule {
	name: string;
	listen: SummatiaListeners[];

	constructor(name: string, options: SummatiaOption = { listen: [] }) {
		this.name = name;
		this.listen = options.listen;
	}
}

// This must be put after SummatiaModule
import { Summatia } from "../summatia";

export interface Initialized {
	init(summatia: Summatia): void;
}

export interface MatrixHandler {
	onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent): any;
}

export interface DiscordHandler {
	onDiscordMessage(summatia: Summatia, message: Message): any;
}

export interface Helpful {
	description(): string;
	examples(): string[];
}