import { MatrixClient } from "matrix-bot-sdk";
import { RoomMessageEvent } from "../types/events";

export enum SummatiaListeners {
	MESSAGE
}

type SummatiaOption = {
	listen: SummatiaListeners[];
}

export class SummatiaModule {
	listen: SummatiaListeners[];

	constructor(options: SummatiaOption) {
		this.listen = options.listen;
	}

	onMessage(client: MatrixClient, roomId: string, event: RoomMessageEvent) { }
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