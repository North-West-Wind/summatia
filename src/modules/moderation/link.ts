import { ChannelType, Message, Snowflake, TextChannel } from "discord.js";

import { Summatia } from "../../summatia";
import { RoomMessageEvent } from "../../types/events";
import { DiscordHandler, Initialized, MatrixHandler, SummatiaListeners, SummatiaModule } from "..";

const CHANNEL_THRESHOLD = 5,
	WINDOW_DURATION = 10_000,
	TIMEOUT_DURATION = 600_000,
	KICK_THREAT = 5,
	THREAT_DURATION = 24 * 60 * 60 * 1000,
	
	MESSAGE_THRESHOLD = 15;

// discord types
type GuildID = Snowflake;
type ChannelID = Snowflake;
type MessageID = Snowflake;
type UserID = Snowflake;

type UserLink = {
	id: Snowflake;
	channels: Map<ChannelID, Map<MessageID, Message>>;
	timeouts: Map<ChannelID, NodeJS.Timeout>;
	threat: number;
	unthreatTimeout?: NodeJS.Timeout;
}

// matrix types
type RoomID = string;

export class SpamModerationModule extends SummatiaModule implements MatrixHandler, DiscordHandler, Initialized {
	guildUserLinks: Map<GuildID, Map<UserID, UserLink>>;
	channelLinks: Map<ChannelID, { deleteTimeout: NodeJS.Timeout, messages: Message[] }>;
	roomLinks: Map<RoomID, { deleteTimeout: NodeJS.Timeout, events: RoomMessageEvent[] }>;

	constructor() {
		super("spam", { listen: [SummatiaListeners.INIT, SummatiaListeners.MATRIX_MESSAGE, SummatiaListeners.DISCORD_MESSAGE] });
		this.guildUserLinks = new Map();
		this.channelLinks = new Map();
		this.roomLinks = new Map();
	}

	async init(summatia: Summatia) {
		for (const entry of await summatia.database.providers.link.getLinkSpamUsers()) {
			const userLink = this.defaultUserLink(entry.user);
			userLink.threat = entry.threat;
			if (!this.guildUserLinks.has(entry.guild)) this.guildUserLinks.set(entry.guild, new Map([[entry.user, userLink]]));
			else this.guildUserLinks.get(entry.guild)!.set(entry.user, userLink);
		}
	}

	async onDiscordMessage(summatia: Summatia, message: Message) {
		if (message.guild && message.guildId && message.member) {
			const ownerId = message.guild.ownerId;
			const channelThreshold = Math.min(CHANNEL_THRESHOLD, (await message.guild.channels.fetch()).filter(channel => channel?.type == ChannelType.GuildText).size);
			// there's at least 1 url
			// if guild entry doesn't exist, create it
			if (!this.guildUserLinks.has(message.guildId)) this.guildUserLinks.set(message.guildId, new Map());
			const userLinks = this.guildUserLinks.get(message.guildId)!;
			// if user entry doesn't exist, create it
			if (!userLinks.has(message.author.id)) userLinks.set(message.author.id, this.defaultUserLink(message.author.id));
			const userLink = userLinks.get(message.author.id)!;
			// add channel id to set
			if (!userLink.channels.has(message.channelId)) userLink.channels.set(message.channelId, new Map());
			// add message and urls to map, urls are normalized
			userLink.channels.get(message.channelId)!.set(message.id, message);
			// clear old timeout if exists
			if (userLink.timeouts.has(message.channelId)) userLink.timeouts.get(message.channelId)!.refresh();
			// set timeout for removing threats
			else userLink.timeouts.set(message.channelId, setTimeout(() => {
				userLink.channels.delete(message.channelId);
				userLink.timeouts.delete(message.channelId);
			}, WINDOW_DURATION));

			// handle spam on every channel
			if (userLink.channels.size >= channelThreshold) {
				summatia.database.providers.link.setLinkSpamUser(message.author.id, message.guildId!, ++userLink.threat);
				if (userLink.unthreatTimeout) clearTimeout(userLink.unthreatTimeout);
				userLink.unthreatTimeout = setTimeout(() => summatia.database.providers.link.setLinkSpamUser(message.author.id, message.guildId!, --userLink.threat), THREAT_DURATION * userLink.threat);

				// delete messages
				for (const map of userLink.channels.values())
					for (const message of map.values())
						try {
							await message.delete();
						} catch (err) {
							this.logger.error("Failed to delete message.", err);
						}

				userLink.channels.clear();
				userLink.timeouts.forEach(timeout => clearTimeout(timeout));
				userLink.timeouts.clear();

				if (userLink.threat >= KICK_THREAT) {
					await message.member.kick("You spammed too many messages too quickly");
					userLinks.delete(message.author.id);
					await (message.channel as TextChannel).send(`<@${ownerId}> I kicked <@${message.author.id}> (**${message.member.displayName}**) for spamming`);
				} else {
					await message.member.timeout(TIMEOUT_DURATION * userLink.threat * userLink.threat, "You spammed too many messages too quickly");
					await (message.channel as TextChannel).send(`<@${ownerId}> I timed out <@${message.author.id}> for spamming (channel)`);
				}
			}

			// after handling per-user link spam, handle per-channel link spam
			if (!this.channelLinks.has(message.channelId)) this.channelLinks.set(message.channelId, { deleteTimeout: setTimeout(() => this.channelLinks.delete(message.channelId), WINDOW_DURATION), messages: [] });
			const channelLink = this.channelLinks.get(message.channelId)!;
			channelLink.deleteTimeout.refresh();
			channelLink.messages.push(message);

			if (channelLink.messages.length >= MESSAGE_THRESHOLD) {
				for (const msg of channelLink.messages) {
					await msg.delete();
				}
				await message.member.timeout(TIMEOUT_DURATION);
				await (message.channel as TextChannel).send(`<@${ownerId}> I timed out <@${message.author.id}> for spamming (message)`);
				this.channelLinks.delete(message.channelId);
			}
		}
	}

	async onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {
		if (event.content?.msgtype !== 'm.text' || await summatia.getRoomMemberCount(roomId) <= 2) return;

		if (!this.roomLinks.has(roomId)) this.roomLinks.set(roomId, { deleteTimeout: setTimeout(() => this.roomLinks.delete(roomId), WINDOW_DURATION), events: [] });
		const roomLink = this.roomLinks.get(roomId)!;
		roomLink.deleteTimeout.refresh();
		roomLink.events.push(event);

		if (roomLink.events.length >= MESSAGE_THRESHOLD) {
			await summatia.matrix.sendText(roomId, "Too many links!");
			for (const evt of roomLink.events) {
				await summatia.matrix.redactEvent(roomId, evt.event_id);
			}
			this.channelLinks.delete(roomId);
		}
	}

	private defaultUserLink(id: Snowflake) {
		return {
			id,
			channels: new Map(),
			timeouts: new Map(),
			threat: 0
		} as UserLink;
	}
}