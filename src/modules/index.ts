import { Message } from "discord.js";
import { MatrixClient } from "matrix-bot-sdk";
import { RoomMessageEvent } from "../matrix/types/events";

export enum SummatiaListeners {
	MESSAGE
}

type SummatiaOption = {
	listen: SummatiaListeners[];
}

export class SummatiaModule {
	name: string;
	listen: SummatiaListeners[];

	constructor(name: string, options: SummatiaOption) {
		this.name = name;
		this.listen = options.listen;
	}
}

// This must be put after SummatiaModule
import { Summatia } from "../summatia";

export interface MatrixHandler {
	onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent): void;
}

export interface DiscordHandler {
	onDiscordMessage(summatia: Summatia, message: Message): void;
}

import AiModule from "./ai";
import LargeMediaModule from "./large-media";
const MODULES = new Map<string, SummatiaModule>();
MODULES.set("ai", new AiModule());
MODULES.set("large-media", new LargeMediaModule());

export const LISTEN_MODULES: Partial<{ -readonly [key in keyof typeof SummatiaListeners]: Map<string, SummatiaModule> }> = {};
let key: keyof typeof SummatiaListeners;
for (key in SummatiaListeners) {
	const listen = SummatiaListeners[key];
	LISTEN_MODULES[listen as any] = new Map(Array.from(MODULES).filter(([id, module]) => module.listen.includes(listen as any)));
}