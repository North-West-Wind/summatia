import { SlashCommandBuilder, ChatInputCommandInteraction, SlashCommandSubcommandBuilder, SlashCommandStringOption, MessageFlags, Snowflake, TextChannel, PartialTextBasedChannelFields, PermissionFlagsBits } from "discord.js";
import { RoomMessageEvent } from "../../matrix/types/events";
import { Summatia } from "../../summatia";
import { SummatiaCommandHelpModule } from "../commands";
import { Initialized, Startup, SummatiaListeners } from "..";
import Parser from "rss-parser";
import { cleanUrl, renderMarkdown } from "../../helpers/strings";
import { PowerLevelAction } from "matrix-bot-sdk";

const RSS_INTERVAL = 10 * 60 * 1000;
const DEFAULT_TEMPLATE = "New item from {{feed.title}}: {{contentSnippet}}  \n{{link}}";
const DEFAULT_PARSER = new Parser();
const TEMPLATE_MATCH_REGEX = /{{([\w.:-]+(\|[\w.:-]+)*)}}/g;

export class RssCommand extends SummatiaCommandHelpModule implements Initialized, Startup {
	summatia?: Summatia;
	rss: Map<number, { url: string, timestamp: number }>;
	rssDiscord: Map<number, Map<Snowflake, string>>;
	rssMatrix: Map<number, Map<string, string>>;

	constructor() {
		super("rss", { listen: [SummatiaListeners.MATRIX_MESSAGE, SummatiaListeners.INIT, SummatiaListeners.START] });
		this.rss = new Map();
		this.rssDiscord = new Map();
		this.rssMatrix = new Map();
	}

	async init(summatia: Summatia) {
		this.summatia = summatia;
		const rss = summatia.database.providers.rss;
		for (const row of await rss.getRssFeeds())
			this.rss.set(row.id, { url: row.url, timestamp: row.timestamp });
		console.log(`Loaded ${this.rss.size} RSS feeds.`);
		for (const row of await rss.getRssDiscordFeeds()) {
			if (!this.rssDiscord.has(row.rss)) this.rssDiscord.set(row.rss, new Map());
			this.rssDiscord.get(row.rss)!.set(row.channel, row.template || DEFAULT_TEMPLATE);
		}
		console.log(`Loaded ${this.rssDiscord.size ? Array.from(this.rssDiscord.values()).map(m => m.size).reduce((a, b) => a + b) : 0} RSS subscriptions for Discord.`);
		for (const row of await rss.getRssMatrixFeeds()) {
			if (!this.rssMatrix.has(row.rss)) this.rssMatrix.set(row.rss, new Map());
			this.rssMatrix.get(row.rss)!.set(row.room, row.template || DEFAULT_TEMPLATE);
		}
		console.log(`Loaded ${this.rssMatrix.size ? Array.from(this.rssMatrix.values()).map(m => m.size).reduce((a, b) => a + b) : 0} RSS subscriptions for Matrix.`);
	}

	async start(summatia: Summatia) {
		this.updateFeeds();
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
		const allowed = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
		const notAllowedResult = { message: "You don't have the permission to use this!", error: true };
		switch (interaction.options.getSubcommand()) {
			case "add":
				if (!allowed) result = notAllowedResult;
				else result = await this.addFeed(summatia, interaction.options.getString("url", true), interaction.channelId, false);
				break;
			case "remove":
				if (!allowed) result = notAllowedResult;
				else result = await this.removeFeed(summatia, interaction.options.getInteger("id", true), interaction.channelId, false);
				break;
			case "list":
				result = await this.listFeeds(summatia, interaction.channelId, false);
				break;
			case "template":
				if (!allowed && interaction.options.getString("template", false)) result = notAllowedResult;
				else result = await this.getOrSetTemplate(summatia, interaction.options.getInteger("id", true), interaction.options.getString("template", false), interaction.channelId, false);
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
			const result = await this.listFeeds(summatia, roomId, true);
			await summatia.matrix.sendHtmlText(roomId, renderMarkdown(result.message));
			return;
		}
		let result: { message: string, error: boolean } | undefined;
		const allowed = await summatia.matrix.userHasPowerLevelForAction(event.sender, roomId, PowerLevelAction.RedactEvents);
		const notAllowedResult = { message: "You don't have the permission to use this!", error: true };
		switch (args.shift()) {
			case "add":
				if (!args.length) {
					await summatia.matrix.sendText(roomId, "No RSS feed URL provided.");
					return;
				}
				if (!allowed) result = notAllowedResult;
				else result = await this.addFeed(summatia, args.shift()!, roomId, true);
				break;
			case "remove":
				if (!args.length || isNaN(parseInt(args[0]))) {
					await summatia.matrix.sendText(roomId, "No RSS feed ID provided.");
					return;
				}
				if (!allowed) result = notAllowedResult;
				else result = await this.removeFeed(summatia, parseInt(args.shift()!), roomId, true);
				break;
			case "list":
				result = await this.listFeeds(summatia, roomId, true);
				break;
			case "template":
				if (!args.length || isNaN(parseInt(args[0]))) {
					await summatia.matrix.sendText(roomId, "No RSS feed ID provided.");
					return;
				}
				const template = event.content.body.replace(new RegExp(`${summatia.prefix}${this.name}\\s+template\\s+\\d+`), "");
				if (!allowed && template) result = notAllowedResult;
				else result = await this.getOrSetTemplate(summatia, parseInt(args.shift()!), template, roomId, true);
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
				const feed = await DEFAULT_PARSER.parseURL(url);
				const timestamp = feed.items
					.map(item => (item.isoDate ? new Date(item.isoDate) : new Date(0)).getTime())
					.reduce((a, b) => Math.max(a, b));
				id = await rss.addRssFeed(url, timestamp);
				this.rss.set(id, { url, timestamp });
			} else if (!this.rss.has(id)) {
				// rss is not in memory
				const { url, timestamp } = (await rss.getRssFeed(id))!;
				this.rss.set(id, { url, timestamp });
			}

			const map = isMatrix ? this.rssMatrix : this.rssDiscord;
			if (map.get(id)?.has(channelOrRoom))
				return { message: "Already subscribed to this RSS feed.", error: true };
			if (map.has(id)) map.get(id)!.set(channelOrRoom, DEFAULT_TEMPLATE);
			else map.set(id, new Map([[channelOrRoom, DEFAULT_TEMPLATE]]));

			if (isMatrix) await summatia.database.providers.rss.addRssMatrixFeed(id, channelOrRoom);
			else await summatia.database.providers.rss.addRssDiscordFeed(id, channelOrRoom);

			await this.addBridgedFeed(summatia, id, channelOrRoom, isMatrix);

			return { message: `Listening to RSS feed ${id}`, error: false };
		} catch (err) {
			console.error(err);
			return { message: "Could not add this RSS feed!", error: true };
		}
	}

	private async addBridgedFeed(summatia: Summatia, id: number, channelOrRoom: string, isMatrix: boolean) {
		try {
			channelOrRoom = await this.getBridge(summatia, channelOrRoom, isMatrix);
			if (channelOrRoom) {
				isMatrix = !isMatrix;
				const map = isMatrix ? this.rssMatrix : this.rssDiscord;
				if (map.get(id)?.has(channelOrRoom)) return;
				if (map.has(id)) map.get(id)!.set(channelOrRoom, DEFAULT_TEMPLATE);
				else map.set(id, new Map([[channelOrRoom, DEFAULT_TEMPLATE]]));
		
				if (isMatrix) await summatia.database.providers.rss.addRssMatrixFeed(id, channelOrRoom);
				else await summatia.database.providers.rss.addRssDiscordFeed(id, channelOrRoom);
			}
		} catch (err) {
			console.error(err);
		}
	}

	private async removeFeed(summatia: Summatia, id: number, channelOrRoom: string, isMatrix: boolean): Promise<{ message: string, error: boolean }> {
		try {
			const map = isMatrix ? this.rssMatrix : this.rssDiscord;

			if (map.get(id)?.delete(channelOrRoom)) {
				if (isMatrix) await summatia.database.providers.rss.removeRssMatrixFeed(id, channelOrRoom);
				else await summatia.database.providers.rss.removeRssDiscordFeed(id, channelOrRoom);
				await this.removeBridgedFeed(summatia, id, channelOrRoom, isMatrix);
				return { message: `Unsubscirbed from RSS feed ${id}.`, error: false };
			}
			return { message: `This ${isMatrix ? "room" : "channel"} is not subscribed to this RSS feed.`, error: true };
		} catch (err) {
			console.error(err);
			return { message: "Could not remove this RSS feed!", error: true };
		}
	}

	private async removeBridgedFeed(summatia: Summatia, id: number, channelOrRoom: string, isMatrix: boolean) {
		try {
			channelOrRoom = await this.getBridge(summatia, channelOrRoom, isMatrix);
			if (channelOrRoom) {
				isMatrix = !isMatrix;
				const map = isMatrix ? this.rssMatrix : this.rssDiscord;
				if (map.get(id)?.delete(channelOrRoom)) {
					if (isMatrix) await summatia.database.providers.rss.removeRssMatrixFeed(id, channelOrRoom);
					else await summatia.database.providers.rss.removeRssDiscordFeed(id, channelOrRoom);
				}
			}
		} catch (err) {
			console.error(err);
		}
	}

	private async listFeeds(summatia: Summatia, channelOrRoom: string, isMatrix: boolean): Promise<{ message: string, error: boolean }> {
		try {
			const maps = isMatrix ? this.rssMatrix : this.rssDiscord;
			const feeds: string[] = [];
			for (const [id, map] of maps.entries()) {
				if (map.has(channelOrRoom))
					feeds.push(`ID ${id} - ${this.rss.get(id)?.url}`);
			}
			return {
				message: (feeds.length ?
					`This ${isMatrix ? "room" : "channel"} is subscribed to:  \n${feeds.join("  \n")}` :
					`This ${isMatrix ? "room" : "channel"} hasn't subscribed to anything.`) +
					await this.listBridgedFeeds(summatia, channelOrRoom, isMatrix),
				error: false
			};
		} catch (err) {
			console.error(err);
			return { message: "Could not list RSS feeds!", error: true };
		}
	}

	private async listBridgedFeeds(summatia: Summatia, channelOrRoom: string, isMatrix: boolean): Promise<string> {
		try {
			channelOrRoom = await this.getBridge(summatia, channelOrRoom, isMatrix);
			if (channelOrRoom) {
				const maps = isMatrix ? this.rssMatrix : this.rssDiscord;
				const feeds: string[] = [];
				for (const [id, map] of maps.entries()) {
					if (map.has(channelOrRoom))
						feeds.push(`ID ${id} - ${this.rss.get(id)?.url}`);
				}
				if (!feeds.length) return "";
				return `\n\nBridged ${isMatrix ? "channel" : "room"} subscribed to:  \n${feeds.join("  \n")}`;
			} else return "";
		} catch (err) {
			console.error(err);
			return "";
		}
	}

	private async getOrSetTemplate(summatia: Summatia, id: number, template: string | null, channelOrRoom: string, isMatrix: boolean) {
		try {
			const map = isMatrix ? this.rssMatrix : this.rssDiscord;

			if (!map.get(id)?.has(channelOrRoom))
				return { message: `This ${isMatrix ? "room" : "channel"} is not subscribed to this RSS feed.`, error: true };

			if (!template) {
				template = map.get(id)!.get(channelOrRoom)!;
				return { message: `Current template for feed ${id}:\n\n${template}`, error: false };
			}

			map.get(id)!.set(channelOrRoom, template);
			
			if (isMatrix) await summatia.database.providers.rss.setRssMatrixTemplate(id, channelOrRoom, template);
			else await summatia.database.providers.rss.setRssDiscordTemplate(id, channelOrRoom, template);

			await this.setBridgedTemplate(summatia, id, template, channelOrRoom, isMatrix);

			return { message: `New template set. \`${template}\``, error: true };
		} catch (err) {
			console.error(err);
			return { message: "Could not remove this RSS feed!", error: true };
		}
	}

	private async setBridgedTemplate(summatia: Summatia, id: number, template: string, channelOrRoom: string, isMatrix: boolean) {
		try {
			channelOrRoom = await this.getBridge(summatia, channelOrRoom, isMatrix);
			if (channelOrRoom) {
				isMatrix = !isMatrix;
				const map = isMatrix ? this.rssMatrix : this.rssDiscord;
				if (!map.get(id)?.has(channelOrRoom)) return;
	
				map.get(id)!.set(channelOrRoom, template);
				
				if (isMatrix) await summatia.database.providers.rss.setRssMatrixTemplate(id, channelOrRoom, template);
				else await summatia.database.providers.rss.setRssDiscordTemplate(id, channelOrRoom, template);
			}
		} catch (err) {
			console.error(err);
		}
	}

	private async updateFeeds() {
		if (!this.summatia) return;
		console.log(`Polling ${this.rss.size} RSS feeds...`);
		for (const [id, entry] of this.rss.entries()) {
			const feedFields = new Set<string>(), itemFields = new Set<any>();
			for (const [_, template] of Array.from(this.rssMatrix.get(id)?.entries() || []).concat(Array.from(this.rssDiscord.get(id)?.entries() || []))) {
				const [f, i] = this.getTemplateFields(template);
				(f as string[]).forEach(v => feedFields.add(v));
				i.forEach(v => itemFields.add(v));
			}
			const parser = new Parser({ customFields: { feed: Array.from(feedFields), item: Array.from(itemFields) } });
			try {
				const feed = await parser.parseURL(entry.url);
				let newMaxTimestamp = entry.timestamp;
				for (const item of feed.items) {
					if (!item.pubDate) continue;
					const time = new Date(item.pubDate).getTime();
					if (time <= entry.timestamp) continue;
					if (time > newMaxTimestamp) newMaxTimestamp = time;

					const bridged = new Set<Snowflake>();

					// send to matrix
					if (this.summatia.useMatrix)
						for (const [roomId, template] of this.rssMatrix.get(id)?.entries() || []) {
							try {
								await this.summatia.matrix.sendHtmlText(roomId, renderMarkdown(this.formatTemplate(template, feed, item)));
								const channel = await this.summatia.database.providers.bridge.getRoomChannel(roomId);
								if (channel) bridged.add(channel);
							} catch (err) {
								console.error(err);
							}
						}

					// send to discord
					if (this.summatia.useDiscord)
						for (const [channelId, template] of this.rssDiscord.get(id)?.entries() || []) {
							if (bridged.has(channelId)) continue; // already sent in matrix
							try {
								const channel = await this.summatia.discord.channels.fetch(channelId);
								if (channel?.isTextBased())
									await (channel as PartialTextBasedChannelFields).send(this.formatTemplate(template, feed, item));
							} catch (err) {
								console.error(err);
							}
						}
					
					if (entry.timestamp != newMaxTimestamp) {
						entry.timestamp = newMaxTimestamp;
						this.rss.set(id, entry);
						try {
							await this.summatia.database.providers.rss.setRssFeedTimestamp(id, newMaxTimestamp);
						} catch (err) {
							console.error(err);
						}
					}
				}
			} catch (err) {
				// feed may be down. don't spam my log
			}
		}
		console.log(`RSS polling complete.`);
		setTimeout(() => this.updateFeeds(), RSS_INTERVAL);
	}

	private formatTemplate(template: string, feed: { [key: string]: any }, item: { [key: string]: any }) {
		const matches = Array.from(template.matchAll(TEMPLATE_MATCH_REGEX));
		for (const match of matches) {
			// special new line replacement
			if (match[1] == "n") template = template.replace(match[0], "  \n");
			else {
				let thing: any;
				for (const prop of match[1].split("|")) {
					const keys = prop.replace("\\.", "&").split(".").map(p => p.replace("&", "."));
					const first = keys.shift()!;
					switch (first) {
						case "feed":
							thing = feed;
							break;
						case "item":
							thing = item;
							break;
						default:
							thing = item[first];
					}
					for (const key of keys) {
						if (thing === undefined || thing === null) break;
						if (Array.isArray(thing) && !isNaN(parseInt(key))) thing = thing[parseInt(key)];
						else thing = thing[key];
					}
					if (thing !== undefined) break;
				}
				template = template.replace(match[0], thing);
			}
		}
		return template;
	}

	private getTemplateFields(template: string) {
		const feed: string[] = [], item: string[] = [];
		const matches = Array.from(template.matchAll(TEMPLATE_MATCH_REGEX));
		for (const match of matches) {
			for (const prop of match[1].split("|")) {
				const keys = prop.split(".");
				const first = keys.shift()!;
				switch (first) {
					case "feed":
						if (keys.length)
							feed.push(keys.shift()!);
						break;
					case "item":
						if (keys.length)
							item.push(keys.shift()!);
						break;
					default:
						feed.push(first);
				}
			}
		}
		return [feed, item.map(field => [field, field, { includeSnippet: true, keepArray: true }])];
	}

	private async getBridge(summatia: Summatia, channelOrRoom: string, isMatrix: boolean) {
		if (isMatrix) {
			const channel = await summatia.database.providers.bridge.getRoomChannel(channelOrRoom);
			if (channel) channelOrRoom = channel;
			else channelOrRoom = "";
		} else {
			const room = await summatia.database.providers.bridge.getChannelRoom(channelOrRoom);
			if (room) channelOrRoom = room;
			else channelOrRoom = "";
		}
		return channelOrRoom;
	}
}