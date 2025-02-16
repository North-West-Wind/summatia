import { createCanvas, loadImage } from "@napi-rs/canvas";
import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, ComponentType, EmbedBuilder, Guild, GuildEmoji, Message, MessageFlags,MessageReaction, PartialMessageReaction, PermissionFlagsBits, SlashCommandAttachmentOption, SlashCommandBooleanOption, SlashCommandBuilder, SlashCommandStringOption, SlashCommandSubcommandBuilder, Snowflake, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from "discord.js";
import { imageMeta } from "image-meta";
import fetch from "node-fetch";
import sharp from "sharp";

import { Summatia } from "../../summatia";
import { DiscordEmojiHandler, DiscordHandler, DiscordReactionHandler, Initialized, Startup, SummatiaListeners } from "..";
import { SummatiaDiscordCommandHelpModule } from "../commands";

const REF_SAVE_INTERVAL = 30000;
type EmojiCacheEntry = { id?: Snowflake, url: string, active: boolean, ref: boolean, animated: boolean };

export class EmojiCommand extends SummatiaDiscordCommandHelpModule implements DiscordHandler, DiscordEmojiHandler, DiscordReactionHandler, Initialized, Startup {
	emojis: Map<Snowflake, Map<string, EmojiCacheEntry>>;
	clockPointer: Map<Snowflake, number>;

	constructor() {
		super("emoji", { listen: [SummatiaListeners.INIT, SummatiaListeners.START, SummatiaListeners.DISCORD_MESSAGE, SummatiaListeners.DISCORD_MESSAGE_REACTION, SummatiaListeners.DISCORD_GUILD_EMOJI] });
		this.emojis = new Map();
		this.clockPointer = new Map();
	}

	async init(summatia: Summatia) {
		(await summatia.database.providers.emoji.getPointers())?.forEach(({ id, index }) => this.clockPointer.set(id, index));
		setInterval(async () => {
			for (const [id, map] of this.emojis.entries())
				await summatia.database.providers.emoji.updateEmojisRef(id, Array.from(map.entries()).map(([name, emoji]) => ({ name, ...emoji })));
		}, REF_SAVE_INTERVAL);
	}

	async start(summatia: Summatia) {
		for (const guildId of (await summatia.database.providers.emoji.getGuilds()) || [])
			await this.setupGuild(summatia, await summatia.discord.guilds.fetch(guildId));
	}

	description() {
		return "50+ server emojis without boosts!";
	}

	examples(): string[] {
		return [
			"emoji add <image> [name]",
			"emoji use [animated]",
			"emoji delete [animated]",
			"emoji list"
		];
	}

	getSlashCommandBuilder() {
		const data = new SlashCommandBuilder()
			.setName(this.name)
			.setDescription(this.description());

		data.addSubcommand(new SlashCommandSubcommandBuilder()
			.setName("add")
			.setDescription("Upload an emoji to the server.")
			.addAttachmentOption(new SlashCommandAttachmentOption().setName("image").setDescription("The image that will become an emoji.").setRequired(true))
			.addStringOption(new SlashCommandStringOption().setName("name").setDescription("The name to use for this emoji.").setRequired(false)));
		data.addSubcommand(new SlashCommandSubcommandBuilder().setName("use").setDescription("Swap an emoji into use.")
			.addBooleanOption(new SlashCommandBooleanOption().setName("animated").setDescription("Whether to modify animated emojis or not.").setRequired(false)));
		data.addSubcommand(new SlashCommandSubcommandBuilder().setName("delete").setDescription("Delete an emoji from the server.")
			.addBooleanOption(new SlashCommandBooleanOption().setName("animated").setDescription("Whether to modify animated emojis or not.").setRequired(false)));
		data.addSubcommand(new SlashCommandSubcommandBuilder().setName("list").setDescription("List all emojis, no matter active or not."));

		return data;
	}

	onDiscordMessage(_summatia: Summatia, message: Message) {
		if (!message.content || !message.guildId || !this.emojis.has(message.guildId)) return;
		for (const [_, name, id] of message.content.matchAll(/<:(\w+):(\d+)>/g))
			this.referenceEmoji(message.guildId, name, id);
	}

	async onEmojiCreate(summatia: Summatia, emoji: GuildEmoji) {
		if ((await emoji.fetchAuthor()).id === summatia.discord.user.id) return;
		// manually modified emojis. re-sync
		await this.setupGuild(summatia, emoji.guild);
	}

	async onEmojiDelete(summatia: Summatia, emoji: GuildEmoji) {
		if (!emoji.name) return;
		await this.deleteEmoji(summatia, emoji.guild.id, emoji.name);
	}

	async onEmojiUpdate(summatia: Summatia, oldEmoji: GuildEmoji, newEmoji: GuildEmoji) {
		if (!oldEmoji.name || !newEmoji.name || oldEmoji.name == newEmoji.name) return;
		await this.deleteEmoji(summatia, oldEmoji.guild.id, oldEmoji.name);
		await this.addEmoji(summatia, newEmoji.guild.id, newEmoji);
	}

	onMessageReactionAdd(_summatia: Summatia, reaction: MessageReaction | PartialMessageReaction) {
		if (!(reaction.emoji instanceof GuildEmoji) || !this.emojis.has(reaction.emoji.guild.id) || !reaction.emoji.name) return;
		this.referenceEmoji(reaction.emoji.guild.id, reaction.emoji.name, reaction.emoji.id);
	}

	onMessageReactionRemove() { }

	async onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction) {
		if (!interaction.guild) return await interaction.reply("I can only do this in servers!");
		const selfPerm = (await interaction.guild.members.fetchMe()).permissions;
		if (!selfPerm.has(PermissionFlagsBits.ManageGuildExpressions) || !selfPerm.has(PermissionFlagsBits.CreateGuildExpressions)) return await interaction.reply({ content: "I don't have permission to modify emojis!", flags: MessageFlags.Ephemeral });
		const subcommand = interaction.options.getSubcommand();

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!this.emojis.has(interaction.guildId!)) await this.setupGuild(summatia, interaction.guild);

		switch (subcommand) {
			case "add": {
				if (!interaction.memberPermissions?.has(PermissionFlagsBits.CreateGuildExpressions)) return await interaction.editReply("You don't have permission to do this!");

				const attachment = interaction.options.getAttachment("image", true);
				const name = (interaction.options.getString("name") || attachment.name.split(".").slice(0, -1).join(".")).replace(/[^\w]/g, "_");
				if (!attachment.contentType?.startsWith("image/")) return await interaction.editReply("The attachment is not an image! -▵-'");
				
				const att = await this.resizeEmoji(attachment.url, attachment.contentType == "image/gif", { width: attachment.width || undefined, height: attachment.height || undefined, size: attachment.size });
				if (typeof att == "number") {
					if (att == 0) await interaction.editReply("The image file size (>256KB) is too big! >▵<");
					else await interaction.editReply("The image file size (>256KB) is too big even after resizing it! >▵<");
					return;
				}

				if (this.emojis.get(interaction.guildId!)!.has(name)) return await interaction.editReply(`The name **${name}** is already in use!`);
				const replacement = await this.findReplacement(summatia, interaction.guildId!, attachment.contentType == "image/gif");
				if (replacement === undefined) return await interaction.editReply("Something just went VERY wrong ;▵;");
				if (replacement) {
					if (!replacement.id) replacement.id = (await interaction.guild.emojis.fetch()).find(e => e.name == replacement.name)?.id;
					if (!replacement.id) return await interaction.editReply("Replacment is a bit off??");
					await interaction.editReply(`Replacing <:${replacement.name}:${replacement.id}>. Yoink!`);
					await interaction.guild.emojis.delete(replacement.id, "Summatia hot swap :>");
					const emoji = await interaction.guild.emojis.create({ attachment: att, name });
					await this.addEmoji(summatia, interaction.guildId!, emoji);
					await this.unuseEmoji(summatia, interaction.guildId!, replacement.name);
					await interaction.followUp(`Hello <:${emoji.name}:${emoji.id}>!`);
				} else {
					// no replacement needed!
					const emoji = await interaction.guild.emojis.create({ attachment: att, name });
					await this.addEmoji(summatia, interaction.guildId!, emoji);
					await interaction.editReply(`Hello <:${emoji.name}:${emoji.id}>!`);
				}
				break;
			}
			case "use": {
				const animated = !!interaction.options.getBoolean("animated");
				const int = await this.emojiBrowser(summatia, interaction, Array.from(this.emojis.get(interaction.guildId!)!.entries()).filter(([_, emoji]) => !emoji.active && emoji.animated == animated).map(([name, emoji]) => ({ name, ...emoji })).sort((a, b) => a.name.localeCompare(b.name)));
				if (!int) return;
				const name = int.values[0];
				const newEmoji = this.emojis.get(interaction.guildId!)?.get(name);
				if (!newEmoji) return await int.update({ content: "You chose the emoji but also didn't. Maybe someone else updated it?", embeds: [], components: [] });

				const att = await this.resizeEmoji(newEmoji.url, newEmoji.animated);
				if (typeof att === "number") return await int.update({ content: "I used to be able to fit this in 256KB. Now I can't???", embeds: [], components: [] });

				const replacement = await this.findReplacement(summatia, interaction.guildId!, newEmoji.animated);
				if (replacement === undefined) return await int.update({ content: "Something just went VERY wrong ;▵;", embeds: [], components: [] });
				if (replacement) {
					if (!replacement.id) replacement.id = (await interaction.guild.emojis.fetch()).find(e => e.name == replacement.name)?.id;
					if (!replacement.id) return await int.update({ content: "Replacment is a bit off??", embeds: [], components: [] });
					await int.update({ content: `Replacing <:${replacement.name}:${replacement.id}>. Yoink!`, embeds: [], components: [] });
					await interaction.guild.emojis.delete(replacement.id, "Summatia hot swap :>");
					const emoji = await interaction.guild.emojis.create({ attachment: att, name });
					await this.useEmoji(summatia, interaction.guildId!, name, emoji.id);
					await this.unuseEmoji(summatia, interaction.guildId!, replacement.name);
					await interaction.followUp(`Hello <:${emoji.name}:${emoji.id}>!`);
				} else {
					// no replacement needed!
					const emoji = await interaction.guild.emojis.create({ attachment: att, name: int.values[0] });
					await this.useEmoji(summatia, interaction.guildId!, name, emoji.id);
					await int.update({ content: `Hello <:${emoji.name}:${emoji.id}>!`, embeds: [], components: [] });
				}
				break;
			}
			case "delete": {
				if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuildExpressions)) return await interaction.editReply("You don't have permission to do this!");
				const animated = !!interaction.options.getBoolean("animated");
				const int = await this.emojiBrowser(summatia, interaction, Array.from(this.emojis.get(interaction.guildId!)!.entries()).filter(([_, emoji]) => emoji.animated == animated).map(([name, emoji]) => ({ name, ...emoji })).sort((a, b) => a.name.localeCompare(b.name)));
				if (!int) return;
				const name = int.values[0];
				const emoji = this.emojis.get(interaction.guildId!)?.get(name);
				if (!emoji) return await int.update({ content: "You chose the emoji but also didn't. Maybe someone else updated it?", embeds: [], components: [] });
				if (emoji.active && emoji.id) await interaction.guild.emojis.delete(emoji.id);
				await this.deleteEmoji(summatia, interaction.guildId!, name);
				await int.update({ content: `Poof! **${name}** is gone.`, embeds: [], components: [] });
				break;
			}
			case "list": {
				await this.emojiBrowser(summatia, interaction, Array.from(this.emojis.get(interaction.guildId!)!.entries()).map(([name, emoji]) => ({ name, ...emoji })).sort((a, b) => a.name.localeCompare(b.name)), false)
				break;
			}
			default: return await interaction.editReply("WHAT!?");
		}
	}

	private async emojiBrowser(summatia: Summatia, interaction: ChatInputCommandInteraction, emojis: (EmojiCacheEntry & { name: string })[], selectable = true) {
		if (!emojis.length) {
			await interaction.editReply("You don't have extra emojis. Good job :>");
			return;
		}

		const buttonAttributes = [
			{ id: "first", emoji: "⏪", label: undefined },
			{ id: "prev", emoji: "◀", label: undefined },
			{ id: "stop", emoji: undefined, label: "Stop" },
			{ id: "next", emoji: "▶", label: undefined },
			{ id: "last", emoji: "⏩", label: undefined },
		];
		
		const embed = new EmbedBuilder().setColor(0x1ccbb7).setFooter({ text: "Powered by Summatia", iconURL: "https://files.catbox.moe/5j84b7.png" });
		const selectMenu = new StringSelectMenuBuilder().setCustomId("newUse").setPlaceholder("Choose an emoji to use!");
		const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
			...buttonAttributes.map(x => {
				const button = new ButtonBuilder().setCustomId(x.id);
				if (x.emoji) button.setEmoji(x.emoji).setStyle(ButtonStyle.Secondary);
				else if (x.label) button.setLabel(x.label).setStyle(ButtonStyle.Danger);
				return button;
			})
		);

		const uuidCache = new Map<number, string>();

		const makeFields = async (interaction: ChatInputCommandInteraction | ButtonInteraction, page: number) => {
			if (!interaction.isChatInputCommand()) await interaction.deferUpdate();

			embed.setTitle(`Emoji Browser - Page ${page + 1}`);
			const fields = [];
			const options = [];
			let uuid = uuidCache.get(page);
			const canvas = createCanvas(128 * 3, 128 * 3);
			const ctx = canvas.getContext("2d");
			for (let ii = 0; ii < Math.min(9, emojis.length - page * 9); ii++) {
				const emoji = emojis[ii + page * 9];
				let value = emoji.name;
				if (emoji.active && emoji.id && !emoji.animated) value += ` <:${emoji.name}:${emoji.id}>`;
				fields.push({ name: `${ii + 1} ${emoji.animated ? "(a)" : ""}`, value, inline: true });
				options.push(new StringSelectMenuOptionBuilder().setValue(emoji.name).setLabel(emoji.name));
				if (!uuid) {
					const image = await loadImage(emoji.url);
					ctx.drawImage(image, (ii % 3) * 128, Math.floor(ii / 3) * 128, 128 * image.width / Math.max(image.width, image.height), 128 * image.height / Math.max(image.width, image.height));
				}
			}
			embed.setFields(fields);
			if (!uuid) uuid = summatia.rest.addTmpFile(await canvas.encode("png"), "image/png", 60000);
			embed.setImage(summatia.rest.fullPath(`/tmp/${uuid}`));
			selectMenu.setOptions(options);

			const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

			const res = await interaction.editReply({ embeds: [embed], components: selectable ? [row1, row2] : [row2] });
			try {
				const int = await res.awaitMessageComponent({ filter: int => int.user.id == interaction.user.id, time: 60000 });
				if (int.componentType == ComponentType.Button) {
					switch (int.customId) {
						case buttonAttributes[0].id: return await makeFields(int, 0);
						case buttonAttributes[1].id: {
							let newPage = page - 1;
							if (newPage < 0) newPage = Math.ceil(emojis.length / 9) - 1;
							return await makeFields(int, newPage);
						}
						case buttonAttributes[2].id: {
							await int.update({ content: "Cancelled :<", components: [], embeds: [] });
							return;
						}
						case buttonAttributes[3].id: {
							let newPage = page + 1;
							if (newPage > Math.ceil(emojis.length / 9) - 1) newPage = 0;
							return await makeFields(int, newPage);
						}
						case buttonAttributes[4].id: return await makeFields(int, Math.ceil(emojis.length / 9) - 1);
					}
				} else if (int.componentType == ComponentType.StringSelect) {
					return int;
				}
			} catch (err) {
				if (interaction.isChatInputCommand()) await interaction.editReply({ content: "Time's Up :>", components: [], embeds: [] });
				else await interaction.update({ content: "Time's Up :>", components: [], embeds: [] });
			}
		};
		return await makeFields(interaction, 0);
	}

	private async setupGuild(summatia: Summatia, guild: Guild) {
		const emojis: (EmojiCacheEntry & { name: string })[] | undefined =
			this.emojis.has(guild.id) ?
			Array.from(this.emojis.get(guild.id)!.entries()).map(([name, emoji]) => ({ name, ...emoji })) :
		 	(await summatia.database.providers.emoji.getEmojis(guild.id))?.map(e => ({ name: e.name, url: e.url, active: e.active, ref: e.ref, animated: e.animated }));
		if (!emojis) {
			this.emojis.set(guild.id, new Map((await guild.emojis.fetch()).filter(e => e.name).map(e => [e.name!, { url: e.imageURL(), active: true, ref: false, animated: !!e.animated }])));
			this.logger.log(`Setup guild emojis for ${guild.name}`);
		} else {
			let changed = false;
			(await guild.emojis.fetch()).filter(e => e.name).forEach(e => {
				const index = emojis.findIndex(em => em.name == e.name);
				if (index < 0) {
					emojis.push({ id: e.id, name: e.name!, url: e.imageURL(), active: true, ref: false, animated: !!e.animated });
					changed = true;
				} else {
					emojis[index].id = e.id;
					if (emojis[index].url != e.imageURL()) {
						emojis[index].url = e.imageURL();
						changed = true;
					}
				}
			});
			this.emojis.set(guild.id, new Map(emojis.map(e => {
				const oldActive = e.active;
				e.active = !!e.id;
				if (oldActive != e.active) changed = true;
				return [e.name, e];
			})));
			this.logger.log(`Restored guild emojis for ${guild.name}`);
			if (changed) {
				await this.saveGuildEmojis(summatia, guild.id);
				this.logger.log(`Guild emojis for ${guild.name} changed. Syncing to DB...`);
			}
		}
	}

	private async saveGuildEmojis(summatia: Summatia, guildId: Snowflake) {
		await summatia.database.providers.emoji.setEmojis(guildId, Array.from(this.emojis.get(guildId)?.entries() || []).map(([name, emoji]) => ({ name, ...emoji })))
	}

	// CLOCK algorithm replacement policy
	private async findReplacement(summatia: Summatia, guildId: Snowflake, animated: boolean) {
		if (!this.emojis.has(guildId)) return undefined;
		const map = this.emojis.get(guildId)!;
		const emojis = Array.from(map.entries()).filter(([_, e]) => e.active && e.animated == animated).sort((a, b) => a[0].localeCompare(b[0]));
		if (emojis.length < 50) return null;
		let index = (this.clockPointer.get(guildId) || 0) % emojis.length;
		for (let ii = 0; ii < emojis.length; ii++) {
			const [name, emoji] = emojis[index];
			if (emoji.ref) {
				emoji.ref = false;
				map.set(name, emoji);
			} else {
				this.clockPointer.set(guildId, index);
				await summatia.database.providers.emoji.setPointer(guildId, index);
				return { name, ...emoji };
			}
			index = (index + 1) % emojis.length;
		}
		// All emojis had reference bit set. So the first one must not be.
		return { name: emojis[index][0], ...emojis[index][1] };
	}

	private async addEmoji(summatia: Summatia, guildId: Snowflake, emoji: GuildEmoji) {
		if (!this.emojis.has(guildId)) this.emojis.set(guildId, new Map());
		this.emojis.get(guildId)!.set(emoji.name!, { id: emoji.id, url: emoji.imageURL(), active: true, ref: true, animated: !!emoji.animated });
		await summatia.database.providers.emoji.addEmoji(guildId, emoji.name!, { url: emoji.imageURL(), active: true, ref: true, animated: !!emoji.animated });
	}

	private async useEmoji(summatia: Summatia, guildId: Snowflake, name: string, id: Snowflake) {
		const emoji = this.emojis.get(guildId)?.get(name);
		if (emoji) {
			emoji.id = id;
			emoji.active = true;
			emoji.ref = true;
			this.emojis.get(guildId)!.set(name, emoji);
			await summatia.database.providers.emoji.updateEmojiActive(guildId, name, true);
		}
	}

	private async unuseEmoji(summatia: Summatia, guildId: Snowflake, name: string) {
		const emoji = this.emojis.get(guildId)?.get(name);
		if (emoji) {
			emoji.id = undefined;
			emoji.active = false;
			this.emojis.get(guildId)!.set(name, emoji);
			await summatia.database.providers.emoji.updateEmojiActive(guildId, name, false);
		}
	}

	private async deleteEmoji(summatia: Summatia, guildId: Snowflake, name: string) {
		if (this.emojis.get(guildId)?.delete(name))
			await summatia.database.providers.emoji.removeEmoji(guildId, name);
	}

	private async resizeEmoji(url: string, animated: boolean, info?: { width?: number, height?: number, size: number }) {
		let att: string | Buffer;
		let tmp: Buffer | undefined;
		if (!info) {
			const res = await fetch(url);
			tmp = await res.buffer();
			const meta = imageMeta(tmp);
			info = { width: meta.width, height: meta.height, size: tmp.byteLength };
		}
		if (info.size >= 256 * 1024) {
			// try resizing to 128x128 if too large
			if (Math.min(info.width || 0, info.height || 0) > 128) {
				const w = 128 * info.width! / Math.min(info.width!, info.height!);
				const h = 128 * info.height! / Math.min(info.width!, info.height!);
				if (!tmp) {
					const res = await fetch(url);
					tmp = await res.buffer();
				}
				const resized = sharp(tmp).resize(w, h);
				if (animated) att = await resized.gif().toBuffer();
				else att = await resized.png().toBuffer();
				if (att.byteLength >= 256 * 1024) return 1;
			} else return 0;
		} else att = url;
		return att;
	}

	private referenceEmoji(guildId: Snowflake, name: string, id: Snowflake) {
		const emoji = this.emojis.get(guildId)?.get(name);
		if (emoji?.id == id) {
			emoji.ref = true;
			this.emojis.get(guildId)?.set(name, emoji);
		}
	}
}