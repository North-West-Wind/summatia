import { SlashCommandBuilder, ChatInputCommandInteraction, SlashCommandSubcommandBuilder, SlashCommandStringOption, MessageFlags, Snowflake, TextChannel, PartialTextBasedChannelFields } from "discord.js";
import { RoomMessageEvent } from "../../matrix/types/events";
import { Summatia } from "../../summatia";
import { SummatiaCommandHelpModule } from "../commands";
import { Initialized, SummatiaListeners } from "..";
import Parser from "rss-parser";
import { SummatiaDatabase } from "../../db";

const RSS_INTERVAL = 10 * 60 * 1000;
const parser = new Parser();

export class RssCommand extends SummatiaCommandHelpModule implements Initialized {
	summatia?: Summatia;
	rss: { id: number, url: string, timestamp: number }[];
	rssDiscord: Map<number, { channelId: Snowflake, template: string }[]>;

	constructor() {
		super("rss", { listen: [SummatiaListeners.MATRIX_MESSAGE] });
		this.rss = [];
		this.rssDiscord = new Map();
	}

	init(summatia: Summatia) {
		this.summatia = summatia;
		setInterval(this.updateFeeds, RSS_INTERVAL);
	}

	description() {
		return "Updates you from RSS feeds.";
	}

	examples() {
		return ["rss add <url>", "rss remove <id>", "rss list", "rss template <id> <template>"];
	}

	getSlashCommandBuilder() {
		const data = new SlashCommandBuilder()
			.setName(this.name)
			.setDescription(this.description());

		data.addSubcommand(new SlashCommandSubcommandBuilder()
			.setName("add")
			.setDescription("Start listening to an RSS feed.")
			.addStringOption(new SlashCommandStringOption().setName("url").setDescription("RSS feed URL").setRequired(true)));

		data.addSubcommand(new SlashCommandSubcommandBuilder()
			.setName("remove")
			.setDescription("Stop listening to an RSS feed. Get the ID from `rss list`.")
			.addStringOption(new SlashCommandStringOption().setName("id").setDescription("RSS feed ID").setRequired(true)));

		data.addSubcommand(new SlashCommandSubcommandBuilder()
			.setName("list")
			.setDescription("List all RSS feeds I'm listening to."));

		data.addSubcommand(new SlashCommandSubcommandBuilder()
			.setName("template")
			.setDescription("Set a template of an RSS feed.")
			.addStringOption(new SlashCommandStringOption().setName("id").setDescription("RSS feed ID").setRequired(true))
			.addStringOption(new SlashCommandStringOption().setName("template").setDescription("RSS feed template")));
		
		return data;
	}

	async onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction) {
		switch (interaction.options.getSubcommand()) {
			case "add": {
				const result = await this.addFeed(summatia, interaction.options.getString("url", true));
				await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
				break;
			}
		}
	}

	onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {
		
	}

	private async addFeed(summatia: Summatia, url: string): Promise<{ message: string, error: boolean }> {
		try {
			const feed = await parser.parseURL(url);
			const latest = feed.items
				.map(item => (item.isoDate ? new Date(item.isoDate) : new Date(0)).getTime())
				.reduce((a, b) => Math.max(a, b));
			const id = await summatia.database.addRssFeed(url, latest);
			this.rss.push({ id, url, timestamp: latest });
			return { message: "Stored RSS feed as " + id, error: false };
		} catch (err) {
			console.error(err);
			return { message: "Could not add this RSS feed!", error: true };
		}
	}

	private async updateFeeds() {
		if (!this.summatia) return;
		for (const entry of this.rss) {
			try {
				const feed = await parser.parseURL(entry.url);
				let newMaxTimestamp = entry.timestamp;
				for (const item of feed.items) {
					if (!item.pubDate) continue;
					const time = new Date(item.pubDate).getTime();
					if (time <= entry.timestamp) continue;
					if (time > newMaxTimestamp) newMaxTimestamp = time;

					// send to discord
					for (const { channelId, template } of this.rssDiscord.get(entry.id) || []) {
						try {
							const channel = await this.summatia.discord.channels.fetch(channelId);
							if (channel?.isTextBased())
								await (channel as PartialTextBasedChannelFields).send(this.formatTemplate(template, feed, item));
						} catch (err) {
							console.error(err);
						}
					}
				}
			} catch (err) {
				// feed may be down. don't spam my log
			}
		}
	}

	private formatTemplate(template: string, feed: { [key: string]: any }, item: { [key: string]: any }) {
		const matches = Array.from(template.matchAll(/{{([\w.]+)}}/g));
		for (const match of matches) {
			const keys = match[1].split(".");
			let thing: any = keys.shift() == "feed" ? feed : item;
			for (const key of keys) thing = thing[key];
			template = template.replace(match[0], thing);
		}
		return template;
	}
}