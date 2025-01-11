import { Message } from "discord.js";
import { DiscordHandler, SummatiaListeners, SummatiaModule, SummatiaOption } from ".";
import { Summatia } from "../summatia";

export abstract class ModerationModule extends SummatiaModule implements DiscordHandler {
	constructor(name: string, options: SummatiaOption = { listen: [] }) {
		const set = new Set(options.listen);
		set.add(SummatiaListeners.DISCORD_MESSAGE);
		options.listen = Array.from(set);
		super(name, options);
	}

	abstract onDiscordMessage(summatia: Summatia, message: Message): void | Promise<void>;
}