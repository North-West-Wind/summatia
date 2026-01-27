import { Message, TextChannel } from "discord.js";
import { SummatiaModule, DiscordHandler, SummatiaListeners } from "..";
import { Summatia } from "../../summatia";

export class SpamModerationModule extends SummatiaModule implements DiscordHandler {
	constructor() {
		super("spam", { listen: [SummatiaListeners.DISCORD_MESSAGE] });
	}

	async onDiscordMessage(_summatia: Summatia, message: Message) {
		if (message.content == "@everyone" && (message.attachments.size == 4 || message.attachments.size == 5)) {
			await message.delete();
			(message.channel as TextChannel).send("Highly suspicious. Get bonked <:bonk:1465722513861378244>");
		}
	}
}