import { Message, Snowflake, TextChannel } from "discord.js";
import { Summatia } from "../../summatia";
import { DiscordHandler, Initialized, MatrixHandler, SummatiaListeners, SummatiaModule } from "..";
import { RoomMessageEvent } from "../../types/events";
import { cleanUrl } from "../../helpers/strings";

const THRESHOLD = 5,
	WINDOW_DURATION = 30_000,
	TIMEOUT_DURATION = 60_000,
	KICK_THREAT = 5,
	THREAT_DURATION = 24 * 60 * 60 * 1000,
	
	CHANNEL_THRESHOLD = 15;

// discord types
type GuildID = Snowflake;
type ChannelID = Snowflake;
type MessageID = Snowflake;
type UserID = Snowflake;

type UserLink = {
	id: Snowflake;
	channels: Map<ChannelID, Map<MessageID, { message: Message, urls: string[] }>>;
	timeouts: Map<ChannelID, NodeJS.Timeout>;
	threat: number;
	unthreatTimeout?: NodeJS.Timeout;
}

// matrix types
type RoomID = string;

export class LinkModerationModule extends SummatiaModule implements MatrixHandler, DiscordHandler, Initialized {
	guildUserLinks: Map<GuildID, Map<UserID, UserLink>>;
	channelLinks: Map<ChannelID, { deleteTimeout: NodeJS.Timeout, messages: { message: Message, urls: string[] }[] }>;
	roomLinks: Map<RoomID, { deleteTimeout: NodeJS.Timeout, events: { event: RoomMessageEvent, urls: string[] }[] }>;

	constructor() {
		super("link-mod", { listen: [SummatiaListeners.INIT, SummatiaListeners.MATRIX_MESSAGE, SummatiaListeners.DISCORD_MESSAGE] });
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
		if (message.guildId && message.member && message.content && /([a-zA-Z0-9]+:\/\/)?([a-zA-Z0-9_]+:[a-zA-Z0-9_]+@)?([a-zA-Z0-9.-]+\.[A-Za-z]{2,4})(:[0-9]+)?(\/.*)?/.test(message.content)) {
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
			const urls = message.content.split(/\s/g).filter(segment => this.isUrl(segment)).map(url => cleanUrl(url));
			userLink.channels.get(message.channelId)!.set(message.id, { message, urls });
			// clear old timeout if exists
			if (userLink.timeouts.has(message.channelId)) userLink.timeouts.get(message.channelId)!.refresh();
			// set timeout for removing threats
			else userLink.timeouts.set(message.channelId, setTimeout(() => {
				userLink.channels.delete(message.channelId);
				userLink.timeouts.delete(message.channelId);
			}, WINDOW_DURATION));

			// look for repeated urls
			const counts = new Map<string, number>();
			for (const map of userLink.channels.values())
				for (const { urls } of map.values())
					for (const url of urls) counts.set(url, (counts.get(url) || 0) + 1);

			if (userLink.channels.size >= THRESHOLD || Array.from(counts.values()).some(count => count >= THRESHOLD)) {
				summatia.database.providers.link.setLinkSpamUser(message.author.id, message.guildId!, ++userLink.threat);
				if (userLink.unthreatTimeout) clearTimeout(userLink.unthreatTimeout);
				userLink.unthreatTimeout = setTimeout(() => summatia.database.providers.link.setLinkSpamUser(message.author.id, message.guildId!, --userLink.threat), THREAT_DURATION * userLink.threat);

				// delete messages
				for (const map of userLink.channels.values())
					for (const { message } of map.values())
						try {
							await message.delete();
						} catch (err) { }

				userLink.channels.clear();
				userLink.timeouts.forEach(timeout => clearTimeout(timeout));
				userLink.timeouts.clear();

				if (userLink.threat >= KICK_THREAT) {
					await message.member.kick("You spam too many links too quickly");
					userLinks.delete(message.author.id);
				} else await message.member.timeout(TIMEOUT_DURATION * userLink.threat * userLink.threat, "You spam too many links too quickly");
			}

			// after handling per-user link spam, handle per-channel link spam
			if (!this.channelLinks.has(message.channelId)) this.channelLinks.set(message.channelId, { deleteTimeout: setTimeout(() => this.channelLinks.delete(message.channelId), WINDOW_DURATION), messages: [] });
			const channelLink = this.channelLinks.get(message.channelId)!;
			channelLink.deleteTimeout.refresh();
			channelLink.messages.push({ message, urls });

			counts.clear();
			for (const messages of this.channelLinks.values())
				for (const { urls } of messages.messages)
					for (const url of urls) counts.set(url, (counts.get(url) || 0) + 1);

			if (channelLink.messages.length >= CHANNEL_THRESHOLD || Array.from(counts.values()).some(count => count >= THRESHOLD)) {
				await (message.channel as TextChannel).send("Too many links!");
				for (const msg of channelLink.messages) {
					await msg.message.delete();
					await msg.message.member?.timeout(TIMEOUT_DURATION);
				}
				this.channelLinks.delete(message.channelId);
			}
		}
	}

	async onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {
		if (event.content?.msgtype !== 'm.text' || await summatia.getRoomMemberCount(roomId) <= 2 || !/([a-zA-Z0-9]+:\/\/)?([a-zA-Z0-9_]+:[a-zA-Z0-9_]+@)?([a-zA-Z0-9.-]+\.[A-Za-z]{2,4})(:[0-9]+)?(\/.*)?/.test(event.content.body)) return;

		const urls = event.content.body.split(/\s/g).filter(segment => this.isUrl(segment)).map(url => cleanUrl(url));

		if (!this.roomLinks.has(roomId)) this.roomLinks.set(roomId, { deleteTimeout: setTimeout(() => this.roomLinks.delete(roomId), WINDOW_DURATION), events: [] });
		const roomLink = this.roomLinks.get(roomId)!;
		roomLink.deleteTimeout.refresh();
		roomLink.events.push({ event, urls });

		const counts = new Map<string, number>();
		for (const messages of this.channelLinks.values())
			for (const { urls } of messages.messages)
				for (const url of urls) counts.set(url, (counts.get(url) || 0) + 1);

		if (roomLink.events.length >= CHANNEL_THRESHOLD || Array.from(counts.values()).some(count => count >= THRESHOLD)) {
			await summatia.matrix.sendText(roomId, "Too many links!");
			for (const evt of roomLink.events) {
				await summatia.matrix.redactEvent(roomId, evt.event.event_id);
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

	private isUrl(str: string) {
		var pattern = new RegExp('^(https?:\\/\\/)?'+ // protocol
			'((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|'+ // domain name
			'((\\d{1,3}\\.){3}\\d{1,3}))'+ // OR ip (v4) address
			'(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*'+ // port and path
			'(\\?[;&a-z\\d%_.~+=-]*)?'+ // query string
			'(\\#[-a-z\\d_]*)?$','i'); // fragment locator
		return !!pattern.test(str);
	}
}