import { Message, Snowflake } from "discord.js";
import { Summatia } from "../../summatia";
import { ModerationModule } from "../moderation";

const THRESHOLD = 5, WINDOW_DURATION = 30_000, TIMEOUT_DURATION = 60_000, KICK_THREAT = 5, THREAT_DURATION = 24 * 60 * 60 * 1000;

type UserLink = {
	id: Snowflake;
	channelIds: Set<Snowflake>;
	timeouts: Map<Snowflake, NodeJS.Timeout>;
	threat: number;
	unthreatTimeout?: NodeJS.Timeout;
}

export class LinkModerationModule extends ModerationModule {
	guildUserLinks: Map<Snowflake, Map<Snowflake, UserLink>>;

	constructor() {
		super("link-mod");
		this.guildUserLinks = new Map();
	}

	async onDiscordMessage(summatia: Summatia, message: Message) {
		if (message.guildId && message.member && message.content && /([a-zA-Z0-9]+:\/\/)?([a-zA-Z0-9_]+:[a-zA-Z0-9_]+@)?([a-zA-Z0-9.-]+\.[A-Za-z]{2,4})(:[0-9]+)?(\/.*)?/.test(message.content)) {
			// there's at least 1 url
			if (!this.guildUserLinks.has(message.guildId)) this.guildUserLinks.set(message.guildId, new Map());
			const userLinks = this.guildUserLinks.get(message.guildId)!;
			if (!userLinks.has(message.author.id)) userLinks.set(message.author.id, this.defaultUserLink(message.author.id));
			const userLink = userLinks.get(message.author.id)!;
			userLink.channelIds.add(message.channelId);
			if (userLink.timeouts.has(message.channelId)) userLink.timeouts.get(message.channelId)!.refresh();
			else userLink.timeouts.set(message.channelId, setTimeout(() => {
				userLink.channelIds.delete(message.channelId);
				userLink.timeouts.delete(message.channelId);
			}, WINDOW_DURATION));

			if (userLink.channelIds.size >= THRESHOLD) {
				userLink.threat++;
				if (userLink.unthreatTimeout) clearTimeout(userLink.unthreatTimeout);
				userLink.unthreatTimeout = setTimeout(() => userLink.threat--, THREAT_DURATION * userLink.threat)

				userLink.channelIds.clear();
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
			channelIds: new Set(),
			timeouts: new Map(),
			threat: 0
		} as UserLink;
	}
}