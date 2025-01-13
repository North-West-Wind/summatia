import { Message } from "discord.js";
import { RoomMessageEvent } from "../matrix/types/events";

export enum SummatiaListeners {
	INIT,
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
	onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent): void;
}

export interface DiscordHandler {
	onDiscordMessage(summatia: Summatia, message: Message): void;
}