import { Message, Snowflake } from "discord.js";
import { Summatia } from "../../summatia";
import { ModerationModule } from "../moderation";
import normalizeUrl from "normalize-url";
import { Initialized, SummatiaListeners } from "..";

const THRESHOLD = 5, WINDOW_DURATION = 30_000, TIMEOUT_DURATION = 60_000, KICK_THREAT = 5, THREAT_DURATION = 24 * 60 * 60 * 1000;

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

export class LinkModerationModule extends ModerationModule implements Initialized {
	guildUserLinks: Map<GuildID, Map<UserID, UserLink>>;

	constructor() {
		super("link-mod", { listen: [SummatiaListeners.INIT] });
		this.guildUserLinks = new Map();
	}

	init(summatia: Summatia) {
		
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
			const urls = message.content.split(/\s/g).filter(segment => this.isUrl(segment)).map(url => normalizeUrl(url));
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
				userLink.threat++;
				if (userLink.unthreatTimeout) clearTimeout(userLink.unthreatTimeout);
				userLink.unthreatTimeout = setTimeout(() => userLink.threat--, THREAT_DURATION * userLink.threat);

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