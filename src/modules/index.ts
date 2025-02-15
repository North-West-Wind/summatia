import { ChatInputCommandInteraction, GuildEmoji, GuildMember, Message, MessageReaction, MessageReactionEventDetails, PartialGuildMember, PartialMessageReaction, PartialUser, SlashCommandBuilder, User } from "discord.js";
import { RoomMessageEvent } from "../types/events";

type PromiseOpt<T> = T | Promise<T>;

export enum SummatiaListeners {
	// called before starting in setup
	INIT,
	// called after start
	START,
	
	// used for the "help" command. Matrix or Discord makes a feature only appear on MX/DC. Passing none makes it appears on both.
	HELP,
	HELP_MATRIX,
	HELP_DISCORD,

	// listen to Matrix or Discord events
	MATRIX_MESSAGE,
	DISCORD_MESSAGE,
	DISCORD_MESSAGE_REACTION,
	DISCORD_COMMAND_INTERACTION,
	DISCORD_GUILD_MEMBER,
	DISCORD_GUILD_EMOJI,
}

export type SummatiaOption = {
	listen: SummatiaListeners[];
}

export class SummatiaModule {
	name: string;
	listen: SummatiaListeners[];
	logger: Logger;

	constructor(name: string, options: SummatiaOption = { listen: [] }) {
		this.name = name;
		this.listen = options.listen;
		this.logger = new Logger(name);
	}
}

// This must be put after SummatiaModule
import { Summatia } from "../summatia";
import Logger from "../helpers/logger";

export interface Initialized {
	init(summatia: Summatia): void | Promise<void>;
}

export interface Startup {
	start(summatia: Summatia): void | Promise<void>;
}

export interface MatrixHandler {
	onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent): any;
}

export interface DiscordHandler {
	onDiscordMessage(summatia: Summatia, message: Message): any;
}

export interface Helpful {
	description(): string;
	examples(): string[];
}

export interface DiscordCommandHandler {
	getSlashCommandBuilder(summatia: Summatia): SlashCommandBuilder;
	onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction): any | Promise<any>;
}

export interface DiscordGuildMemberHandler {
	onGuildMemberAdd(summatia: Summatia, member: GuildMember): any | Promise<any>;
	onGuildMemberRemove(summatia: Summatia, member: GuildMember | PartialGuildMember): any | Promise<any>;
	onGuildMemberUpdate(summatia: Summatia, member: GuildMember | PartialGuildMember): any | Promise<any>;
}

export interface DiscordEmojiHandler {
	onEmojiCreate(summatia: Summatia, emoji: GuildEmoji): PromiseOpt<any>;
	onEmojiDelete(summatia: Summatia, emoji: GuildEmoji): PromiseOpt<any>;
	onEmojiUpdate(summatia: Summatia, oldEmoji: GuildEmoji, newEmoji: GuildEmoji): PromiseOpt<any>;
}

export interface DiscordReactionHandler {
	onMessageReactionAdd(summatia: Summatia, reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, details: MessageReactionEventDetails): any | Promise<any>;
	onMessageReactionRemove(summatia: Summatia, reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, details: MessageReactionEventDetails): any | Promise<any>;
}