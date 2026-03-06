import { SlashCommandBuilder, ChatInputCommandInteraction, SlashCommandUserOption, SlashCommandRoleOption, SlashCommandStringOption, SlashCommandIntegerOption, SlashCommandChannelOption, ChannelType, Role, Snowflake, TextBasedChannel, SnowflakeUtil, TextChannel } from "discord.js";
import { Summatia } from "../../summatia";
import { SummatiaDiscordCommandHelpModule } from "../commands";

export class RemoveMessageCommand extends SummatiaDiscordCommandHelpModule {
	constructor() {
		super("rm");
	}

	description() {
		return "Bulk delete messages from a certain user or role in a given time range.";
	}

	examples(): string[] {
		return [
			"rm user:user1 after:1234567 channel:#general",
			"rm role:role2 after:69420141 before:54456789"
		];
	}

	getSlashCommandBuilder() {
		const data = new SlashCommandBuilder().setName(this.name).setDescription(this.description());
		data
			.addUserOption(new SlashCommandUserOption().setName("user").setDescription("The user whose messages will be removed.").setRequired(false))
			.addRoleOption(new SlashCommandRoleOption().setName("role").setDescription("The role which will have its members' messages removed.").setRequired(false))
			.addStringOption(new SlashCommandStringOption().setName("after").setDescription("Messages sent after this message ID will be removed.").setRequired(true))
			.addStringOption(new SlashCommandStringOption().setName("before").setDescription("Messages sent before this message ID will be removed.").setRequired(false))
			.addChannelOption(new SlashCommandChannelOption().setName("channel").setDescription("Channel where the messages should be removed.").setRequired(false).addChannelTypes(ChannelType.GuildText));

		return data;
	}

	async onDiscordCommandInteraction(_summatia: Summatia, interaction: ChatInputCommandInteraction) {
		if (!interaction.guild) return await interaction.reply("This command can only be used in servers.");
		const user = interaction.options.getUser("user");
		const role = interaction.options.getRole("role");
		if (!user && !role) return await interaction.reply("You must supply either one of user and role.");
		await interaction.deferReply();
		const channel = interaction.options.getChannel("channel", false, [ChannelType.GuildText]);
		let authorIds: Set<Snowflake>;
		if (role) authorIds = new Set<Snowflake>((role as Role).members.keys());
		else authorIds = new Set<Snowflake>([user!.id]);
		const channels: TextChannel[] = [];
		if (channel) channels.push(channel);
		else channels.push(...(await interaction.guild.channels.fetch()).filter(channel => channel?.type == ChannelType.GuildText).values());
		
		let success = 0;
		let failure = 0;
		for (const channel of channels) {
			try {
				const pendingDeletion: Snowflake[] = [];
				const messages = await channel.messages.fetch({ after: interaction.options.getString("after", true), before: interaction.options.getString("before") || undefined });
				for (const message of messages.values())
					if (authorIds.has(message.author.id))
						pendingDeletion.push(message.id);
				await channel.bulkDelete(pendingDeletion);
				success++;
			} catch (err) {
				this.logger.error("Failed to bulk delete in channel " + channel.id, err);
				failure++;
			}
		}
		await interaction.editReply(`Success/Failure: ${success}/${failure}`);
	}
}