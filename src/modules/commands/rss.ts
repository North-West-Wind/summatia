import { SlashCommandBuilder, ChatInputCommandInteraction, SlashCommandSubcommandBuilder, SlashCommandStringOption, MessageFlags, Snowflake, TextChannel, PartialTextBasedChannelFields } from "discord.js";
import { RoomMessageEvent } from "../../matrix/types/events";
import { Summatia } from "../../summatia";
import { SummatiaCommandHelpModule } from "../commands";
import { Initialized, SummatiaListeners } from "..";
import Parser from "rss-parser";
import { cleanUrl, renderMarkdown } from "../../helpers/strings";

const RSS_INTERVAL = 10 * 60 * 1000;
const DEFAULT_TEMPLATE = "New item from {{feed.title}}: {{item.name}}\n  {{item.link}}"
const parser = new Parser();

export class RssCommand extends SummatiaCommandHelpModule implements Initialized {
	summatia?: Summatia;
	rss: Map<number, { url: string, timestamp: number }>;
	rssDiscord: Map<number, Map<Snowflake, string>>;
	rssMatrix: Map<number, Map<string, string>>;

	constructor() {
		super("rss", { listen: [SummatiaListeners.MATRIX_MESSAGE] });
		this.rss = new Map();
		this.rssDiscord = new Map();
		this.rssMatrix = new Map();
	}

	async init(summatia: Summatia) {
		this.summatia = summatia;
		const rss = summatia.database.providers.rss;
		for (const row of await rss.getRssFeeds())
			this.rss.set(row.id, { url: row.url, timestamp: row.timestamp });
		for (const row of await rss.getRssDiscordFeeds()) {
			if (!this.rssDiscord.has(row.rss)) this.rssDiscord.set(row.rss, new Map());
			const map = this.rssDiscord.get(row.rss)!;
			map.set(row.channel, row.template || DEFAULT_TEMPLATE);
		}
		for (const row of await rss.getRssMatrixFeeds()) {
			if (!this.rssMatrix.has(row.rss)) this.rssMatrix.set(row.rss, new Map());
			const map = this.rssMatrix.get(row.rss)!;
			map.set(row.room, row.template || DEFAULT_TEMPLATE);
		}
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
			.setDescription("List all RSS feeds subscribed for this room/channel."));

		data.addSubcommand(new SlashCommandSubcommandBuilder()
			.setName("template")
			.setDescription("Set a template of an RSS feed.")
			.addStringOption(new SlashCommandStringOption().setName("id").setDescription("RSS feed ID").setRequired(true))
			.addStringOption(new SlashCommandStringOption().setName("template").setDescription("RSS feed template")));
		
		return data;
	}

	async onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction) {
		let result: { message: string, error: boolean } | undefined;
		switch (interaction.options.getSubcommand()) {
			case "add":
				result = await this.addFeed(summatia, interaction.options.getString("url", true), interaction.channelId, false);
				break;
			case "remove":
				result = await this.removeFeed(summatia, interaction.options.getInteger("id", true), interaction.channelId, false);
				break;
			case "list":
				result = await this.listFeeds(interaction.channelId, false);
				break;
			case "template":
				result = await this.setTemplate(summatia, interaction.options.getInteger("id", true), interaction.options.getString("template", false) || null, interaction.channelId, false);
				break;
		}
		if (result) await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
	}

	async onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {
		if (event.content.msgtype != "m.text" || !event.content.body.startsWith(summatia.prefix + this.name)) return;
		const args = event.content.body.slice(summatia.prefix.length).split(/\s+/);
		args.shift();
		// if no arguments, default to list
		if (!args.length) {
			const result = await this.listFeeds(roomId, false);
			await summatia.matrix.sendHtmlText(roomId, renderMarkdown(result.message));
			return;
		}
		let result: { message: string, error: boolean } | undefined;
		switch (args.shift()) {
			case "add":
				if (!args.length) {
					await summatia.matrix.sendText(roomId, "No RSS feed URL provided.");
					return;
				}
				result = await this.addFeed(summatia, args.shift()!, roomId, true);
				break;
			case "remove":
				if (!args.length || isNaN(parseInt(args[0]))) {
					await summatia.matrix.sendText(roomId, "No RSS feed ID provided.");
					return;
				}
				result = await this.removeFeed(summatia, parseInt(args.shift()!), roomId, true);
				break;
			case "list":
				result = await this.listFeeds(roomId, true);
				break;
			case "template":
				if (!args.length || isNaN(parseInt(args[0]))) {
					await summatia.matrix.sendText(roomId, "No RSS feed ID provided.");
					return;
				}
				const template = event.content.body.replace(new RegExp(`${summatia.prefix}${this.name}\\s+template\\s+\\d+\\s+`), "");
				result = await this.setTemplate(summatia, parseInt(args.shift()!), template, roomId, true);
				break;
		}
		if (result) await summatia.matrix.sendHtmlText(roomId, renderMarkdown(result.message));
	}

	private async addFeed(summatia: Summatia, url: string, channelOrRoom: string, isMatrix: boolean): Promise<{ message: string, error: boolean }> {
		const rss = summatia.database.providers.rss;
		try {
			url = cleanUrl(url);
			let id = await rss.getRssFeedId(url);
			if (id === undefined) {
				const feed = await parser.parseURL(url);
				const timestamp = feed.items
					.map(item => (item.isoDate ? new Date(item.isoDate) : new Date(0)).getTime())
					.reduce((a, b) => Math.max(a, b));
				id = await rss.addRssFeed(url, timestamp);
				this.rss.set(id, { url, timestamp });
			}

			const map = isMatrix ? this.rssMatrix : this.rssDiscord;
			const addFunc = isMatrix ? summatia.database.providers.rss.addRssMatrixFeed : summatia.database.providers.rss.addRssDiscordFeed;

			if (map.get(id)?.has(channelOrRoom))
				return { message: "Already subscribed to this RSS feed.", error: true };
			if (map.has(id)) map.get(id)!.set(channelOrRoom, DEFAULT_TEMPLATE);
			else map.set(id, new Map([[channelOrRoom, DEFAULT_TEMPLATE]]));

			await addFunc(id, channelOrRoom);

			return { message: `Listening to RSS feed ${id}`, error: false };
		} catch (err) {
			console.error(err);
			return { message: "Could not add this RSS feed!", error: true };
		}
	}

	private async removeFeed(summatia: Summatia, id: number, channelOrRoom: string, isMatrix: boolean): Promise<{ message: string, error: boolean }> {
		try {
			const map = isMatrix ? this.rssMatrix : this.rssDiscord;
			const removeFunc = isMatrix ? summatia.database.providers.rss.removeRssMatrixFeed : summatia.database.providers.rss.removeRssDiscordFeed;

			if (map.get(id)?.delete(channelOrRoom)) {
				await removeFunc(id, channelOrRoom);
				return { message: `Unsubscirbed from RSS feed ${id}.`, error: false };
			}
			return { message: `This ${isMatrix ? "room" : "channel"} is not subscribed to this RSS feed.`, error: true };
		} catch (err) {
			console.error(err);
			return { message: "Could not remove this RSS feed!", error: true };
		}
	}

	private async listFeeds(channelOrRoom: string, isMatrix: boolean): Promise<{ message: string, error: boolean }> {
		try {
			const maps = isMatrix ? this.rssMatrix : this.rssDiscord;
			const feeds: string[] = [];
			for (const [id, map] of maps.entries()) {
				if (map.has(channelOrRoom))
					feeds.push(`ID ${id} - ${this.rss.get(id)?.url}`);
			}
			return { message: feeds.length ? `This ${isMatrix ? "room" : "channel"} is subscribed to:\n  ${feeds.join("\n  ")}` : `This ${isMatrix ? "room" : "channel"} hasn't subscribed to anything.`, error: false };
		} catch (err) {
			console.error(err);
			return { message: "Could not list RSS feeds!", error: true };
		}
	}

	private async setTemplate(summatia: Summatia, id: number, template: string | null, channelOrRoom: string, isMatrix: boolean) {
		try {
			const map = isMatrix ? this.rssMatrix : this.rssDiscord;
			const setFunc = isMatrix ? summatia.database.providers.rss.setRssMatrixTemplate : summatia.database.providers.rss.setRssDiscordTemplate;

			if (!map.get(id)?.has(channelOrRoom))
				return { message: `This ${isMatrix ? "room" : "channel"} is not subscribed to this RSS feed.`, error: true };

			if (!map.has(id)) map.set(id, new Map([[channelOrRoom, template || DEFAULT_TEMPLATE]]));
			else map.get(id)!.set(channelOrRoom, template || DEFAULT_TEMPLATE);
			
			await setFunc(id, channelOrRoom, template);

			return { message: `New template set.`, error: true };
		} catch (err) {
			console.error(err);
			return { message: "Could not remove this RSS feed!", error: true };
		}
	}

	private async updateFeeds() {
		if (!this.summatia) return;
		for (const [id, entry] of this.rss.entries()) {
			try {
				const feed = await parser.parseURL(entry.url);
				let newMaxTimestamp = entry.timestamp;
				for (const item of feed.items) {
					if (!item.pubDate) continue;
					const time = new Date(item.pubDate).getTime();
					if (time <= entry.timestamp) continue;
					if (time > newMaxTimestamp) newMaxTimestamp = time;

					// send to discord
					if (this.summatia.useDiscord)
						for (const [channelId, template] of this.rssDiscord.get(id)?.entries() || []) {
							try {
								const channel = await this.summatia.discord.channels.fetch(channelId);
								if (channel?.isTextBased())
									await (channel as PartialTextBasedChannelFields).send(this.formatTemplate(template, feed, item));
							} catch (err) {
								console.error(err);
							}
						}

					// send to matrix
					if (this.summatia.useMatrix)
						for (const [roomId, template] of this.rssMatrix.get(id)?.entries() || []) {
							try {
								await this.summatia.matrix.sendHtmlText(roomId, renderMarkdown(this.formatTemplate(template, feed, item)));
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