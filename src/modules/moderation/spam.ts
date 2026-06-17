import { Message, Snowflake, TextBasedChannel, TextChannel } from "discord.js";

import { Summatia } from "../../summatia";
import { RoomMessageEvent } from "../../types/events";
import { DiscordHandler, MatrixHandler, SummatiaListeners, SummatiaModule } from "..";
import TimeoutWindow from "../../types/timeout-window";

const CHANNEL_THRESHOLD = 5;

export class SpamModerationModule extends SummatiaModule implements MatrixHandler, DiscordHandler {
	discordWindows: Map<string, TimeoutWindow<number, { channel: Snowflake, message: Snowflake }[]>>;
	matrixWindows: Map<string, TimeoutWindow<number, { room: string, event: string }[]>>;

	constructor() {
		super("spam", { listen: [SummatiaListeners.MATRIX_MESSAGE, SummatiaListeners.DISCORD_MESSAGE] });
		this.discordWindows = new Map();
		this.matrixWindows = new Map();
	}

	async onDiscordMessage(_summatia: Summatia, message: Message) {
		if (message.guild && message.guildId && message.member) {
			const windowId = message.guildId + "_" + message.member.id;
			let timeoutWindow: TimeoutWindow<number, { channel: Snowflake, message: Snowflake }[]>;
			if (this.discordWindows.has(windowId)) timeoutWindow = this.discordWindows.get(windowId)!;
			else {
				timeoutWindow = new TimeoutWindow(0, 8000);
				this.discordWindows.set(windowId, timeoutWindow);
			}

			timeoutWindow.value += 1;
			if (timeoutWindow.data === undefined) timeoutWindow.data = [];
			timeoutWindow.data.push({ channel: message.channelId, message: message.id });

			const ownerId = message.guild.ownerId;
			const channelThreshold = Math.min(CHANNEL_THRESHOLD, (await message.guild.channels.fetch()).size);

			if (timeoutWindow.value == channelThreshold) {
				await (message.channel as TextChannel).send(`<:ahhh:1466025328110600212> <@${message.author.id}> is spamming! <@${ownerId}>`);
				try {
					await message.member.timeout(7 * 24 * 60 * 60 * 1000, "You spammed too many messages too quickly.");
					await (message.channel as TextChannel).send(`<@${message.author.id}> has been timed out for 1 week.`);
					message.member.send(`You have been timed out for 1 week on the server ${message.guild.name} for spamming. Please contact <@${ownerId}> if this is a mistake.`)
				} catch (err) {
					this.logger.error(`Failed to timeout user ${message.author.id} in guild ${message.guildId}`, err);
				}
				for (const entry of timeoutWindow.data) {
					try {
						const channel = await message.guild.channels.fetch(entry.channel);
						await (channel as TextBasedChannel).messages.delete(entry.message);
					} catch (err) {
						this.logger.error(`Failed to delete message ${entry.message} in channel ${entry.channel}`, err);
					}
				}
				timeoutWindow.data = [];
			} else if (timeoutWindow.value > channelThreshold) {
				await message.delete();
				timeoutWindow.data = [];
			}
		}
	}

	async onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {
		if (event.content?.msgtype !== 'm.text' || await summatia.getRoomMemberCount(roomId) <= 2) return;

		let timeoutWindow: TimeoutWindow<number, { room: string, event: string }[]>;
		if (this.matrixWindows.has(event.sender)) timeoutWindow = this.matrixWindows.get(event.sender)!;
		else {
			timeoutWindow = new TimeoutWindow(0, 8000);
			this.matrixWindows.set(event.sender, timeoutWindow);
		}

		timeoutWindow.value += 1;
		if (timeoutWindow.data === undefined) timeoutWindow.data = [];
		timeoutWindow.data.push({ room: roomId, event: event.event_id });

		if (timeoutWindow.value == CHANNEL_THRESHOLD) {
			await summatia.matrix.sendText(roomId, `You some how managed to spam in the ${CHANNEL_THRESHOLD} rooms I'm in. Get bonked`);
			for (const entry of timeoutWindow.data) {
				try {
					await summatia.matrix.redactEvent(entry.room, entry.event);
				} catch (err) {
					this.logger.error("Failed to redact event", err);
				}
			}
			timeoutWindow.data = [];
		} else if (timeoutWindow.value > CHANNEL_THRESHOLD) {
			await summatia.matrix.redactEvent(roomId, event.event_id);
			timeoutWindow.data = [];
		}
	}
}