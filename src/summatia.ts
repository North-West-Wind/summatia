import { ActivityType, Client, Events, GatewayIntentBits, MessageFlags, Partials, PresenceData, PresenceStatusData, Routes, Snowflake } from "discord.js";
import { mkdirSync } from "fs";
import { AutojoinRoomsMixin, AutojoinUpgradedRoomsMixin, MatrixClient, RustSdkCryptoStorageProvider, SimpleFsStorageProvider } from "matrix-bot-sdk";

import { SummatiaDatabase } from "./db";
import Logger from "./helpers/logger";
import { DiscordEmojiHandler, DiscordGuildMemberHandler, DiscordHandler, DiscordReactionHandler, Initialized, MatrixHandler, Startup, SummatiaListeners, SummatiaModule } from "./modules";
import { SummatiaCommandModule } from "./modules/commands";
import { SummatiaRest } from "./rest";
import { CustomEmojiAccountData, RoomMessageEvent } from "./types/events";

// Summatia handles both Matrix and Discord
export class Summatia {
	readonly prefix: string;
	matrix: MatrixClient;
	discord: Client<true>;
	useMatrix: boolean;
	useDiscord: boolean;
	modules: { -readonly [key in keyof typeof SummatiaListeners]: Map<string, SummatiaModule> };
	database: SummatiaDatabase;
	rest: SummatiaRest;
	startTime: number;

	constructor(prefix: string, useMatrix: boolean, useDiscord: boolean) {
		this.prefix = prefix;
		this.useMatrix = useMatrix;
		this.useDiscord = useDiscord;
		const modules: Partial<typeof this.modules> = {};
		let listener: keyof typeof SummatiaListeners;
		for (listener in SummatiaListeners)
			modules[listener] = new Map();
		this.modules = modules as typeof this.modules;
		this.database = new SummatiaDatabase();
		this.startTime = 0;

		// matrix client init
		if (!process.env.MATRIX_HOMESERVER) throw new Error("Matrix homeserver not set");
		if (!process.env.MATRIX_TOKEN) throw new Error("Matrix bot token not set");

		mkdirSync("runtime/crypto", { recursive: true });

		const storage = new SimpleFsStorageProvider("runtime/matrix.json");
		const cryptoStorage = new RustSdkCryptoStorageProvider("runtime/crypto");
		
		this.matrix = new MatrixClient(process.env.MATRIX_HOMESERVER!, process.env.MATRIX_TOKEN!, storage, cryptoStorage);
		AutojoinRoomsMixin.setupOnClient(this.matrix);
		AutojoinUpgradedRoomsMixin.setupOnClient(this.matrix);

		// discord client init
		if (!process.env.DISCORD_CLIENT_ID) throw new Error("Discord client ID not set");
		if (!process.env.DISCORD_TOKEN) throw new Error("Discord bot token not set");

		this.discord = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.GuildMembers,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.DirectMessages
			],
			partials: [
				Partials.Channel
			]
		});
		
		this.rest = new SummatiaRest();
	}

	addModule(module: SummatiaModule) {
		for (const listen of module.listen) {
			if (!this.modules[listen]) this.modules[listen] = new Map();
			this.modules[listen].set(module.name, module);
		}
	}

	async waitDatabase() {
		while (!this.database.isReady())
			await new Promise<void>((res) => setTimeout(res, 100));
	}

	// create non-once event listeners
	async setup() {
		this.matrix.on("room.message", async (roomId: string, event: RoomMessageEvent) => {
			// don't listen to old messages
			if (event.origin_server_ts < this.startTime) return;
			// don't listen to self in bridged channels
			const selfId = await this.matrix.getUserId();
			if (event.sender === selfId || event.sender === "@discord_" + this.getDiscordId() + ":matrix.northwestw.in") return;

			this.modules[SummatiaListeners.MATRIX_MESSAGE]
				?.forEach(module => (module as unknown as MatrixHandler).onMatrixMessage(this, roomId, event));
		});

		this.discord.on(Events.MessageCreate, async message => {
			// don't listen to self, other bots or webhooks
			if (message.author.id == message.client.user.id || message.author.bot && !message.webhookId) return;

			this.modules[SummatiaListeners.DISCORD_MESSAGE]
				?.forEach(module => (module as unknown as DiscordHandler).onDiscordMessage(this, message));
		});
		
		this.discord.on(Events.InteractionCreate, async interaction => {
			if (interaction.isChatInputCommand()) {
				const command = this.modules[SummatiaListeners.DISCORD_COMMAND_INTERACTION].get(interaction.commandName);
				if (!command) return;
				try {
					await (command as SummatiaCommandModule).onDiscordCommandInteraction(this, interaction);
				} catch (err) {
					Logger.discord.error(`Interaction execution of ${command.name} went wrong.`, err);
					if (interaction.replied || interaction.deferred) await interaction.followUp({ content: "It didn't work :<", flags: MessageFlags.Ephemeral });
					else await interaction.reply({ content: "It didn't work :<", flags: MessageFlags.Ephemeral });
				}
			}
		});

		this.discord.on(Events.GuildMemberAdd, member => {
			if (member.id == member.client.user.id || member.user.bot) return;
			this.modules[SummatiaListeners.DISCORD_GUILD_MEMBER]
				?.forEach(module => (module as unknown as DiscordGuildMemberHandler).onGuildMemberAdd(this, member));
		}).on(Events.GuildMemberRemove, member => {
			if (member.id == member.client.user.id || member.user.bot) return;
			this.modules[SummatiaListeners.DISCORD_GUILD_MEMBER]
				?.forEach(module => (module as unknown as DiscordGuildMemberHandler).onGuildMemberRemove(this, member));
		}).on(Events.GuildMemberUpdate, member => {
			if (member.id == member.client.user.id || member.user.bot) return;
			this.modules[SummatiaListeners.DISCORD_GUILD_MEMBER]
				?.forEach(module => (module as unknown as DiscordGuildMemberHandler).onGuildMemberUpdate(this, member));
		});

		this.discord.on(Events.GuildEmojiCreate, emoji => {
			this.modules[SummatiaListeners.DISCORD_GUILD_EMOJI]
				?.forEach(module => (module as unknown as DiscordEmojiHandler).onEmojiCreate(this, emoji));
		}).on(Events.GuildEmojiDelete, emoji => {
			this.modules[SummatiaListeners.DISCORD_GUILD_EMOJI]
				?.forEach(module => (module as unknown as DiscordEmojiHandler).onEmojiDelete(this, emoji));
		}).on(Events.GuildEmojiUpdate, (oldEmoji, newEmoji) => {
			this.modules[SummatiaListeners.DISCORD_GUILD_EMOJI]
				?.forEach(module => (module as unknown as DiscordEmojiHandler).onEmojiUpdate(this, oldEmoji, newEmoji));
		})

		this.discord.on(Events.MessageReactionAdd, (reaction, user, details) => {
			this.modules[SummatiaListeners.DISCORD_MESSAGE_REACTION]
				?.forEach(module => (module as unknown as DiscordReactionHandler).onMessageReactionAdd(this, reaction, user, details));
		}).on(Events.MessageReactionRemove, (reaction, user, details) => {
			this.modules[SummatiaListeners.DISCORD_MESSAGE_REACTION]
				?.forEach(module => (module as unknown as DiscordReactionHandler).onMessageReactionRemove(this, reaction, user, details));
		});

		// init modules with INIT
		for (const module of this.modules[SummatiaListeners.INIT].values() || []) {
			Logger.module.log(`Initializing ${module.name}...`);
			await (module as unknown as Initialized).init(this);
		}

		this.rest.setup();

		Logger.system.log("Finished setup");
	}

	// login and stuff
	async start() {
		this.startTime = Date.now();

		await Promise.all([
			this.useMatrix ? this.matrix.start().then(async () => Logger.matrix.log(`${await this.matrix!.getUserId()} is ready!`)) : undefined,
			new Promise<void>(res => {
				if (!this.useDiscord) return res();
				this.discord.once(Events.ClientReady, async readyClient => {
					Logger.discord.log(`${readyClient.user.tag} is ready!`);
					this.setDiscordPresence("online");
					res();
				});
	
				this.discord.login(process.env.DISCORD_TOKEN);
			})
		]);

		for (const module of this.modules[SummatiaListeners.START].values() || []) {
			Logger.module.log(`Starting ${module.name}...`);
			await (module as unknown as Startup).start(this);
		}

		this.rest.start();
	}

	async refreshDiscordCommands() {
		if (!this.useDiscord) return;

		// application command registration
		this.discord.rest.setToken(process.env.DISCORD_TOKEN!);
		const commands = Array.from(this.modules[SummatiaListeners.DISCORD_COMMAND_INTERACTION].values() || []).map(cmd => (cmd as SummatiaCommandModule).getSlashCommandBuilder(this).toJSON());
		try {
			Logger.discord.log(`Started refreshing ${commands.length} application (/) commands.`);

			let data: unknown;
			if (process.env.GUILD_ID)
				data = await this.discord.rest.put(
					Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID!, process.env.GUILD_ID),
					{ body: commands },
				);
			else
				data = await this.discord.rest.put(
					Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!),
					{ body: commands },
				);
	
			Logger.discord.log(`Successfully reloaded ${(data as []).length} application (/) commands.`);

			data = await this.discord.rest.get(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!));
			for (const { id, name } of data as { id: string, name: string }[]) {
				if (!commands.some(command => command.name == name)) {
					await this.discord.rest.delete(Routes.applicationCommand(process.env.DISCORD_CLIENT_ID!, id));
					Logger.discord.log("Successfully deleted applcation (/) command %s.", name);
				}
			}
		} catch (error) {
			Logger.discord.error("Failed to refresh application (/) commands.", error);
		}
	}

	setDiscordPresence(status: PresenceStatusData) {
		const data: PresenceData = { status };
		if (status == "online") data.activities = [{ name: "Integrelle", type: ActivityType.Playing }];
		this.discord.user.setPresence(data);
		Logger.discord.log(`${this.discord.user.tag} is ${status}`);
	}

	async getRoomParents(roomId: string) {
		if (!this.useMatrix) return [];
		const states = await this.matrix.getRoomState(roomId);
		let names: string[] = [];
		const name = states.filter(state => state.type == "m.room.name").pop()?.content.name || "";
		const parentState = states.filter(state => state.type == "m.space.parent").pop();
		if (parentState) names = await this.getRoomParents(parentState.state_key);
		names.unshift(name);
		return names;
	}

	getDiscordId() {
		if (!this.useDiscord) return undefined;
		return this.discord.user.id;
	}

	async isMatrixInChannel(channelId: Snowflake) {
		if (!this.useMatrix) return false;
		try {
			const mxid = await this.database.providers.bridge.getChannelRoom(channelId);
			if (!mxid) return false;
			const rooms = await this.matrix.getJoinedRooms();
			return rooms.some(id => id == mxid);
		} catch (err) {
			return false;
		}
	}

	async isDiscordInRoom(roomId: string) {
		if (!this.useDiscord) return false;
		try {
			const dcid = await this.database.providers.bridge.getRoomChannel(roomId);
			if (!dcid) return false;
			const mxUser = "@discord_" + this.getDiscordId() + ":matrix.northwestw.in";
			const members = await this.matrix.getRoomMembers(roomId);
			return members.some(member => member.stateKey == mxUser);
		} catch (err) {
			return false;
		}
	}

	async getRoomMemberCount(roomId: string) {
		if (!this.useMatrix) return -1;
		const states = await this.matrix.getRoomState(roomId);
		// get the number of members in the room
		return (states.map(state => {
			if (state.type != "m.room.member") return 0;
			if (state.content.membership == "join") return 1;
			if (state.content.membership == "leave") return -1;
			return 0;
		}) as number[]).reduce((a, b) => a + b);
	}

	async getRoomName(roomId: string) {
		if (!this.useMatrix) return undefined;
		const states = await this.matrix.getRoomState(roomId);
		for (let ii = states.length - 1; ii >= 0; ii--)
			if (states[ii].type == "m.room.name")
				return states[ii].content.name;
		return "";
	}

	async getCustomEmojiHTML(shortcode: string) {
		if (!this.useMatrix) return undefined;
		if (shortcode.startsWith(":")) shortcode = shortcode.slice(1);
		if (shortcode.endsWith(":")) shortcode = shortcode.slice(0, shortcode.length - 1);
		const data = await this.matrix.getAccountData("im.ponies.user_emotes") as CustomEmojiAccountData | undefined;
		if (data?.images && data.images[shortcode])
			return `<img data-mx-emoticon src="${data.images[shortcode].url}" alt="${shortcode}" title="${shortcode}" />`
		return `:${shortcode}:`;
	}
}