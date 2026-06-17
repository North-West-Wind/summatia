import { BaseGuildTextChannel, Message, Snowflake, TextBasedChannel, TextChannel } from "discord.js";

import { Summatia } from "../../summatia";
import { RoomMessageEvent } from "../../types/events";
import { DiscordHandler, MatrixHandler, SummatiaListeners, SummatiaModule } from "..";
import TimeoutWindow from "../../types/timeout-window";

const CHANNEL_THRESHOLD = 5;

export class SpamModerationModule extends SummatiaModule implements MatrixHandler, DiscordHandler {
	discordWindows: Map<string, TimeoutWindow<number, { [key in Snowflake]: Snowflake[] }>>;
	matrixWindows: Map<string, TimeoutWindow<number, { [key in string]: string[] }>>;

	constructor() {
		super("spam", { listen: [SummatiaListeners.MATRIX_MESSAGE, SummatiaListeners.DISCORD_MESSAGE] });
		this.discordWindows = new Map();
		this.matrixWindows = new Map();
	}

	async onDiscordMessage(_summatia: Summatia, message: Message) {
		if (message.guild && message.guildId && message.member) {
			const windowId = message.guildId + "_" + message.member.id;
			let timeoutWindow: TimeoutWindow<number, { [key in Snowflake]: Snowflake[] }>;
			if (this.discordWindows.has(windowId)) timeoutWindow = this.discordWindows.get(windowId)!;
			else {
				timeoutWindow = new TimeoutWindow(0, 8000);
				this.discordWindows.set(windowId, timeoutWindow);
			}

			if (timeoutWindow.data === undefined) timeoutWindow.data = {};
			if (!timeoutWindow.data[message.channelId]) {
				timeoutWindow.data[message.channelId] = [];
				timeoutWindow.value += 1;
			}
			timeoutWindow.data[message.channelId].push(message.id);

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
				for (const [channelId, messageIds] of Object.entries(timeoutWindow.data)) {
					try {
						const channel = await message.guild.channels.fetch(channelId);
						await (channel as BaseGuildTextChannel).bulkDelete(messageIds);
					} catch (err) {
						this.logger.error(`Failed to delete ${messageIds.length} messages in channel ${channelId}`, err);
					}
				}
				timeoutWindow.data = {};
			} else if (timeoutWindow.value > channelThreshold) {
				await message.delete().catch(() => {});
				timeoutWindow.data = {};
			}
		}
	}

	async onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {
		if (event.content?.msgtype !== 'm.text' || await summatia.getRoomMemberCount(roomId) <= 2) return;

		let timeoutWindow: TimeoutWindow<number, { [key in string]: string[] }>;
		if (this.matrixWindows.has(event.sender)) timeoutWindow = this.matrixWindows.get(event.sender)!;
		else {
			timeoutWindow = new TimeoutWindow(0, 8000);
			this.matrixWindows.set(event.sender, timeoutWindow);
		}

		if (timeoutWindow.data === undefined) timeoutWindow.data = {};
		if (!timeoutWindow.data[roomId]) {
			timeoutWindow.data[roomId] = [];
			timeoutWindow.value += 1;
		}
		timeoutWindow.data[roomId].push(event.event_id);

		if (timeoutWindow.value == CHANNEL_THRESHOLD) {
			await summatia.matrix.sendText(roomId, `You some how managed to spam in the ${CHANNEL_THRESHOLD} rooms I'm in. Get bonked`);
			for (const [roomId, eventIds] of Object.entries(timeoutWindow.data)) {
				for (const eventId of eventIds) {
					try {
						await summatia.matrix.redactEvent(roomId, eventId);
					} catch (err) {
						this.logger.error(`Failed to redact event ${eventId} in room ${roomId}`, err);
					}
				}
			}
			timeoutWindow.data = {};
		} else if (timeoutWindow.value > CHANNEL_THRESHOLD) {
			await summatia.matrix.redactEvent(roomId, event.event_id).catch(() => {});
			timeoutWindow.data = {};
		}
	}
}