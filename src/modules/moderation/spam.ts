import { BaseGuildTextChannel, Message, TextChannel } from "discord.js";

import { Summatia } from "../../summatia";
import { RoomMessageEvent } from "../../types/events";
import { DiscordHandler, MatrixHandler, SummatiaListeners, SummatiaModule } from "..";
import TimeoutWindow from "../../types/timeout-window";

const CHANNEL_THRESHOLD = 5;

type TWData = { [key in string]: { id: string, content: string }[] };

export class SpamModerationModule extends SummatiaModule implements MatrixHandler, DiscordHandler {
	discordWindows: Map<string, TimeoutWindow<number, TWData>>;
	matrixWindows: Map<string, TimeoutWindow<number, TWData>>;

	constructor() {
		super("spam", { listen: [SummatiaListeners.MATRIX_MESSAGE, SummatiaListeners.DISCORD_MESSAGE] });
		this.discordWindows = new Map();
		this.matrixWindows = new Map();
	}

	async onDiscordMessage(_summatia: Summatia, message: Message) {
		if (message.guild && message.guildId && message.member) {
			const windowId = message.guildId + "_" + message.member.id;
			let timeoutWindow: TimeoutWindow<number, TWData>;
			if (this.discordWindows.has(windowId)) timeoutWindow = this.discordWindows.get(windowId)!;
			else {
				timeoutWindow = new TimeoutWindow(0, 10000);
				this.discordWindows.set(windowId, timeoutWindow);
			}

			if (timeoutWindow.data === undefined) timeoutWindow.data = {};
			if (!timeoutWindow.data[message.channelId]) {
				timeoutWindow.data[message.channelId] = [];
				timeoutWindow.value += 1;
			} else timeoutWindow.refresh();
			timeoutWindow.data[message.channelId].push({ id: message.id, content: message.cleanContent });

			const ownerId = message.guild.ownerId;
			let channelThreshold = Math.min(CHANNEL_THRESHOLD, (await message.guild.channels.fetch()).size);
			if (Object.values(timeoutWindow.data).flatMap(messages => messages.map(({ content }) => content.length)).reduce((a, b, _, { length }) => a + b / length) > 500)
				channelThreshold = Math.min(2, channelThreshold);

			if (timeoutWindow.value == channelThreshold) {
				await (message.channel as TextChannel).send(`<:ahhh:1466025328110600212> <@${message.author.id}> is spamming! <@${ownerId}>`);
				try {
					await message.member.timeout(24 * 60 * 60 * 1000, "You spammed too many messages too quickly.");
					await (message.channel as TextChannel).send(`<@${message.author.id}> has been timed out for 1 day.`);
					message.member.send(`You have been timed out for 1 day on the server ${message.guild.name} for spamming. Please contact <@${ownerId}> if this is a mistake.`)
				} catch (err) {
					this.logger.error(`Failed to timeout user ${message.author.id} in guild ${message.guildId}`, err);
				}
				for (const [channelId, messageIds] of Object.entries(timeoutWindow.data)) {
					try {
						const channel = await message.guild.channels.fetch(channelId);
						await (channel as BaseGuildTextChannel).bulkDelete(messageIds.map(({ id }) => id));
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

		let timeoutWindow: TimeoutWindow<number, TWData>;
		if (this.matrixWindows.has(event.sender)) timeoutWindow = this.matrixWindows.get(event.sender)!;
		else {
			timeoutWindow = new TimeoutWindow(0, 10000);
			this.matrixWindows.set(event.sender, timeoutWindow);
		}

		if (timeoutWindow.data === undefined) timeoutWindow.data = {};
		if (!timeoutWindow.data[roomId]) {
			timeoutWindow.data[roomId] = [];
			timeoutWindow.value += 1;
		} else timeoutWindow.refresh();
		timeoutWindow.data[roomId].push({ id: event.event_id, content: event.content.body });

		let channelThreshold = CHANNEL_THRESHOLD;
		if (Object.values(timeoutWindow.data).flatMap(messages => messages.map(({ content }) => content.length)).reduce((a, b, _, { length }) => a + b / length) > 500)
			channelThreshold = Math.min(2, channelThreshold);

		if (timeoutWindow.value == CHANNEL_THRESHOLD) {
			await summatia.matrix.sendText(roomId, `You some how managed to spam in the ${CHANNEL_THRESHOLD} rooms I'm in. Get bonked`);
			for (const [roomId, eventIds] of Object.entries(timeoutWindow.data)) {
				for (const { id } of eventIds) {
					try {
						await summatia.matrix.redactEvent(roomId, id);
					} catch (err) {
						this.logger.error(`Failed to redact event ${id} in room ${roomId}`, err);
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