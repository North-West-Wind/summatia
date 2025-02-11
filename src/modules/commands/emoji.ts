import { SlashCommandBuilder, ChatInputCommandInteraction, SlashCommandSubcommandBuilder, ModalBuilder, SlashCommandAttachmentOption, SlashCommandStringOption, Guild, Snowflake, Message, GuildEmoji, EmbedBuilder, AttachmentBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ButtonInteraction, InteractionResponse, MessageReaction, MessageReactionEventDetails, PartialMessageReaction, PartialUser, User } from "discord.js";
import { Summatia } from "../../summatia";
import { SummatiaDiscordCommandHelpModule } from "../commands";
import { DiscordEmojiHandler, DiscordHandler, DiscordReactionHandler, Initialized, SummatiaListeners } from "..";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const REF_SAVE_INTERVAL = 30000;
type EmojiCacheEntry = { id?: Snowflake, url: string, active: boolean, ref: boolean };

export class EmojiCommand extends SummatiaDiscordCommandHelpModule implements DiscordHandler, DiscordEmojiHandler, DiscordReactionHandler, Initialized {
	emojis: Map<Snowflake, Map<string, EmojiCacheEntry>>;

	constructor() {
		super("emoji", { listen: [SummatiaListeners.INIT, SummatiaListeners.DISCORD_MESSAGE, SummatiaListeners.DISCORD_MESSAGE_REACTION, SummatiaListeners.DISCORD_GUILD_EMOJI] });
		this.emojis = new Map();
	}

	init(summatia: Summatia) {
		setInterval(async () => {
			for (const [id, map] of this.emojis.entries())
				await summatia.database.providers.emoji.updateEmojisRef(id, Array.from(map.entries()).map(([name, emoji]) => ({ name, ...emoji })));
		}, REF_SAVE_INTERVAL);
	}

	description() {
		return "50+ server emojis without boosts!";
	}

	examples(): string[] {
		return [
			"emoji add",
			"emoji use",
			"emoji delete"
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
		data.addSubcommand(new SlashCommandSubcommandBuilder().setName("use").setDescription("Swap an emoji into use."));
		data.addSubcommand(new SlashCommandSubcommandBuilder().setName("delete").setDescription("Delete an emoji from the server."));

		return data;
	}

	onDiscordMessage(_summatia: Summatia, message: Message) {
		if (!message.content || !message.guildId || !this.emojis.has(message.guildId)) return;
		const map = this.emojis.get(message.guildId)!;
		for (const [_, name] of message.content.matchAll(/<:(\w+):\d+>/g)) {
			if (map.has(name))
				map.get(name)!.ref = true;
		}
	}

	async onEmojiCreate(summatia: Summatia, emoji: GuildEmoji) {
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
		if (!reaction.message.guildId || !this.emojis.has(reaction.message.guildId)) return;
		const map = this.emojis.get(reaction.message.guildId)!;
		if (reaction.emoji.name && map.has(reaction.emoji.name))
			map.get(reaction.emoji.name)!.ref = true;
	}

	onMessageReactionRemove() { }

	async onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction) {
		if (!interaction.guild) return await interaction.reply("I can only do this in servers!");
		const subcommand = interaction.options.getSubcommand();

		switch (subcommand) {
			case "add": {
				const attachment = interaction.options.getAttachment("image", true);
				const name = interaction.options.getString("name");
				if (!attachment.contentType?.startsWith("image/")) return await interaction.reply("The attachment is not an image! -▵-'");
				if (attachment.size >= 1 * 1024 * 1024) return await interaction.reply("The image is too big! >▵<");

				if (!this.emojis.has(interaction.guildId!)) await this.setupGuild(summatia, interaction.guild);
				const replacement = await this.findReplacement(interaction.guildId!);
				if (replacement === undefined) return await interaction.reply("Something just went VERY wrong ;▵;");
				if (replacement) {
					if (!replacement.id) replacement.id = (await interaction.guild.emojis.fetch()).find(e => e.name == replacement.name)?.id;
					if (!replacement.id) return await interaction.reply("Replacment is a bit off??");
					await interaction.reply(`Replacing <:${replacement.name}:${replacement.id}>. Yoink!`);
					await interaction.guild.emojis.delete(replacement.id, "Summatia hot swap :>");
					const emoji = await interaction.guild.emojis.create({ attachment: attachment.url, name: name || attachment.name.split(".").slice(0, -1).join(".") });
					await this.addEmoji(summatia, interaction.guildId!, emoji);
					await this.replaceEmoji(summatia, interaction.guildId!, replacement.name);
					await interaction.followUp(`Hello <:${emoji.name}:${emoji.id}>!`);
				} else {
					// no replacement needed!
					const emoji = await interaction.guild.emojis.create({ attachment: attachment.url, name: name || attachment.name.split(".").slice(0, -1).join(".") });
					await this.addEmoji(summatia, interaction.guildId!, emoji);
					await interaction.reply(`Hello <:${emoji.name}:${emoji.id}>!`);
				}
				break;
			}
			case "use": {
				await interaction.deferReply();
				if (!this.emojis.has(interaction.guildId!)) await this.setupGuild(summatia, interaction.guild);
				const int = await this.emojiBrowser(interaction, Array.from(this.emojis.get(interaction.guildId!)!.entries()).filter(([_, emoji]) => !emoji.active).map(([name, emoji]) => ({ name, ...emoji })).sort((a, b) => a.name.localeCompare(b.name)));
				if (!int) return;
				const name = int.values[0];
				const newEmoji = this.emojis.get(interaction.guildId!)?.get(name);
				if (!newEmoji) return await int.update({ content: "You chose the emoji but also didn't. Maybe someone else updated it?", embeds: [], components: [], files: [] });
				const replacement = await this.findReplacement(interaction.guildId!);
				if (replacement === undefined) return await int.update({ content: "Something just went VERY wrong ;▵;", embeds: [], components: [], files: [] });
				if (replacement) {
					if (!replacement.id) replacement.id = (await interaction.guild.emojis.fetch()).find(e => e.name == replacement.name)?.id;
					if (!replacement.id) return await interaction.reply("Replacment is a bit off??");
					await int.update({ content: `Replacing <:${replacement.name}:${replacement.id}>. Yoink!`, embeds: [], components: [], files: [] });
					await interaction.guild.emojis.delete(replacement.id, "Summatia hot swap :>");
					const emoji = await interaction.guild.emojis.create({ attachment: newEmoji.url, name });
					await this.useEmoji(summatia, interaction.guildId!, name, emoji.id);
					await this.replaceEmoji(summatia, interaction.guildId!, replacement.name);
					await interaction.followUp(`Hello <:${emoji.name}:${emoji.id}>!`);
				} else {
					// no replacement needed!
					const emoji = await interaction.guild.emojis.create({ attachment: newEmoji.url, name: int.values[0] });
					await this.useEmoji(summatia, interaction.guildId!, name, emoji.id);
					await int.update({ content: `Hello <:${emoji.name}:${emoji.id}>!`, embeds: [], components: [], files: [] });
				}
				break;
			}
			case "delete": {
				await interaction.deferReply();
				if (!this.emojis.has(interaction.guildId!)) await this.setupGuild(summatia, interaction.guild);
				const int = await this.emojiBrowser(interaction, Array.from(this.emojis.get(interaction.guildId!)!.entries()).map(([name, emoji]) => ({ name, ...emoji })).sort((a, b) => a.name.localeCompare(b.name)));
				if (!int) return;
				const name = int.values[0];
				const emoji = this.emojis.get(interaction.guildId!)?.get(name);
				if (!emoji) return await int.update({ content: "You chose the emoji but also didn't. Maybe someone else updated it?", embeds: [], components: [], files: [] });
				if (emoji.active && emoji.id) await interaction.guild.emojis.delete(emoji.id);
				await int.update({ content: `Poof! **${name}** is gone.`, embeds: [], components: [], files: [] });
				break;
			}
			default: return await interaction.reply("WHAT!?");
		}
	}

	private async emojiBrowser(interaction: ChatInputCommandInteraction, emojis: (EmojiCacheEntry & { name: string })[]) {
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
		
		const embed = new EmbedBuilder().setColor(0x1ccbb7).setTitle("Emoji Browser").setFooter({ text: "Powered by Summatia", iconURL: "https://files.catbox.moe/5j84b7.png" });
		const selectMenu = new StringSelectMenuBuilder().setCustomId("newUse").setPlaceholder("Choose an emoji to use!");
		const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
			...buttonAttributes.map(x => {
				const button = new ButtonBuilder().setCustomId(x.id);
				if (x.emoji) button.setEmoji(x.emoji).setStyle(ButtonStyle.Secondary);
				else if (x.label) button.setLabel(x.label).setStyle(ButtonStyle.Danger);
				return button;
			})
		);

		const makeFields = async (interaction: ChatInputCommandInteraction | ButtonInteraction, page: number) => {
			const fields = [];
			const options = [];
			const canvas = createCanvas(128 * 3, 128 * 3);
			const ctx = canvas.getContext("2d");
			for (let ii = 0; ii < Math.min(9, emojis.length - page * 9); ii++) {
				const emoji = emojis[ii + page * 9];
				fields.push({ name: "\u200b", value: emoji.name, inline: true });
				options.push(new StringSelectMenuOptionBuilder().setValue(emoji.name));
				const image = await loadImage(emoji.url);
				ctx.drawImage(image, (ii % 3) * 128, Math.floor(ii / 3) * 128, 128, 128);
			}
			embed.setFields(fields);
			const attachment = new AttachmentBuilder(canvas.data()).setName("emojis.png");
			embed.setImage("attachment://emojis.png");
			selectMenu.setOptions(options);

			const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

			let res: Message | InteractionResponse;
			if (interaction.isChatInputCommand()) res = await interaction.editReply({ embeds: [embed], components: [row1, row2], files: [attachment] });
			else res = await interaction.update({ embeds: [embed], components: [row1, row2], files: [attachment] });
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
				await interaction.editReply("Cancelled :<");
			}
		};
		return await makeFields(interaction, 0);
	}

	private async setupGuild(summatia: Summatia, guild: Guild) {
		const emojis: (EmojiCacheEntry & { name: string })[] | undefined = (await summatia.database.providers.emoji.getEmojis(guild.id))?.map(e => ({ name: e.name, url: e.url, active: e.active, ref: e.ref }));
		if (!emojis) {
			this.emojis.set(guild.id, new Map((await guild.emojis.fetch()).filter(e => e.name).map(e => [e.name!, { url: e.url, active: true, ref: false }])))
		} else {
			let changed = false;
			(await guild.emojis.fetch()).filter(e => e.name).forEach(e => {
				const index = emojis.findIndex(em => em.name == e.name);
				if (index < 0) {
					emojis.push({ id: e.id, name: e.name!, url: e.url, active: true, ref: false });
					changed = true;
				} else {
					emojis[index].id = e.id;
					if (emojis[index].url != e.url) {
						emojis[index].url = e.url;
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
			if (changed) await this.saveGuildEmojis(summatia, guild.id);
		}
	}

	private async saveGuildEmojis(summatia: Summatia, guildId: Snowflake) {
		if (this.emojis.has(guildId))
			await summatia.database.providers.emoji.setEmojis(guildId, Array.from(this.emojis.get(guildId)!.entries()).map(([name, emoji]) => ({ name, ...emoji })))
	}

	// CLOCK algorithm replacement policy
	private async findReplacement(guildId: Snowflake) {
		if (!this.emojis.has(guildId)) return undefined;
		const emojis = Array.from(this.emojis.get(guildId)!.entries()).filter(([_, e]) => e.active);
		if (emojis.length < 50) return null;
		for (const [name, emoji] of emojis) {
			if (emoji.ref) emoji.ref = false;
			else return { name, ...emoji };
		}
		// All emojis had reference bit set. So the first one must not be.
		return { name: emojis[0][0], ...emojis[0][1] };
	}

	private async addEmoji(summatia: Summatia, guildId: Snowflake, emoji: GuildEmoji) {
		if (!this.emojis.has(guildId)) this.emojis.set(guildId, new Map());
		this.emojis.get(guildId)!.set(emoji.name!, { id: emoji.id, url: emoji.url, active: true, ref: false });
		await summatia.database.providers.emoji.addEmoji(guildId, emoji.name!, { url: emoji.url, active: true, ref: false });
	}

	private async useEmoji(summatia: Summatia, guildId: Snowflake, name: string, id: Snowflake) {
		if (!this.emojis.has(guildId)) return;
		const emoji = this.emojis.get(guildId)!.get(name);
		if (emoji) {
			emoji.id = id;
			emoji.active = true;
			await summatia.database.providers.emoji.updateEmojiActive(guildId, name, true);
		}
	}

	private async replaceEmoji(summatia: Summatia, guildId: Snowflake, name: string) {
		if (!this.emojis.has(guildId)) return;
		const oldCache = this.emojis.get(guildId)!.get(name);
		if (oldCache) {
			oldCache.id = undefined;
			oldCache.active = false;
			await summatia.database.providers.emoji.updateEmojiActive(guildId, name, false);
		}
	}

	private async deleteEmoji(summatia: Summatia, guildId: Snowflake, name: string) {
		if (!this.emojis.has(guildId)) return;
		if (this.emojis.get(guildId)!.delete(name))
			await summatia.database.providers.emoji.removeEmoji(guildId, name);
	}
}