import { ActivityType, Client, Events, GatewayIntentBits, MessageFlags, Partials, PresenceData, PresenceStatusData, Routes, Snowflake } from "discord.js";
import { AutojoinRoomsMixin, AutojoinUpgradedRoomsMixin, MatrixClient, RustSdkCryptoStorageProvider, SimpleFsStorageProvider } from "matrix-bot-sdk";
import { RoomMessageEvent } from "./types/events";
import { DiscordEmojiHandler, DiscordGuildMemberHandler, DiscordHandler, DiscordReactionHandler, Initialized, MatrixHandler, Startup, SummatiaListeners, SummatiaModule } from "./modules";
import { SummatiaDatabase } from "./db";
import { SummatiaCommandModule } from "./modules/commands";
import { mkdirSync } from "fs";
import { SummatiaRest } from "./rest";

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

	matrixLog(...things: any[]) {
		console.log("[Matrix]", ...things);
	}

	discordLog(...things: any[]) {
		console.log("[Discord]", ...things);
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
					console.error(err);
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
			console.log(`Initializing ${module.name}...`);
			await (module as unknown as Initialized).init(this);
		}

		this.rest.setup();

		console.log("Finished setup");
	}

	// login and stuff
	async start() {
		this.startTime = Date.now();

		await Promise.all([
			this.useMatrix ? this.matrix.start().then(async () => this.matrixLog(`${await this.matrix!.getUserId()} is ready!`)) : undefined,
			new Promise<void>(res => {
				if (!this.useDiscord) return res();
				this.discord.once(Events.ClientReady, async readyClient => {
					this.discordLog(`${readyClient.user.tag} is ready!`);
					this.setDiscordPresence("online");
					res();
				});
	
				this.discord.login(process.env.DISCORD_TOKEN);
			})
		]);

		for (const module of this.modules[SummatiaListeners.START].values() || []) {
			console.log(`Starting ${module.name}...`);
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
			this.discordLog(`Started refreshing ${commands.length} application (/) commands.`);

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
	
			this.discordLog(`Successfully reloaded ${(data as []).length} application (/) commands.`);
		} catch (error) {
			// And of course, make sure you catch and log any errors!
			console.error(error);
		}
	}

	setDiscordPresence(status: PresenceStatusData) {
		const data: PresenceData = { status };
		if (status == "online") data.activities = [{ name: "Integrelle", type: ActivityType.Playing }];
		this.discord.user.setPresence(data);
		this.discordLog(`${this.discord.user.tag} is ${status}`);
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
}