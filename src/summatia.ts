import { ActivityType, Client, Events, GatewayIntentBits, Partials, PresenceData, PresenceStatusData, REST, Routes, Snowflake } from "discord.js";
import { AutojoinRoomsMixin, AutojoinUpgradedRoomsMixin, MatrixClient, RustSdkCryptoStorageProvider, SimpleFsStorageProvider } from "matrix-bot-sdk";
import { RoomMessageEvent } from "./matrix/types/events";
import { DiscordHandler, MatrixHandler, SummatiaListeners, SummatiaModule } from "./modules";
import { SummatiaDatabase } from "./db";
import { SummatiaCommandModule } from "./modules/commands";
import { mkdirSync } from "fs";

// Summatia handles both Matrix and Discord
export class Summatia {
	matrix: MatrixClient;
	discord: Client<true>;
	useMatrix: boolean;
	useDiscord: boolean;
	modules: Partial<{ -readonly [key in keyof typeof SummatiaListeners]: Map<string, SummatiaModule> }>;
	database: SummatiaDatabase;

	constructor(useMatrix: boolean, useDiscord: boolean) {
		this.useMatrix = useMatrix;
		this.useDiscord = useDiscord;
		this.modules = {};
		this.database = new SummatiaDatabase();

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

	// create non-once event listeners
	setup() {
		this.matrix.on("room.message", async (roomId: string, event: RoomMessageEvent) => {
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
				const command = this.modules[SummatiaListeners.DISCORD_COMMAND_INTERACTION]?.get(interaction.commandName);
				if (!command) return;
				try {
					await (command as SummatiaCommandModule).onDiscordCommandInteraction(this, interaction);
				} catch (err) {
					console.error(err);
					if (interaction.replied || interaction.deferred) await interaction.followUp({ content: "It didn't work :(", ephemeral: true });
					else await interaction.reply({ content: "It didn't work :(", ephemeral: true });
				}
			}
		});
	}

	// login and stuff
	start() {
		if (this.useMatrix)
			this.matrix.start()
				.then(async () => this.matrixLog(`${await this.matrix!.getUserId()} is ready!`));
		
		if (this.useDiscord) {
			this.discord.once(Events.ClientReady, async readyClient => {
				this.discordLog(`${readyClient.user.tag} is ready!`);
				this.setDiscordPresence("online")
			});

			this.discord.login(process.env.DISCORD_TOKEN);
		}
	}

	async refreshDiscordCommands() {
		// application command registration
		const commands = Array.from(this.modules[SummatiaListeners.DISCORD_COMMAND_INTERACTION]?.values() || []).map(cmd => (cmd as SummatiaCommandModule).getSlashCommandBuilder().toJSON());
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
		let data: PresenceData = { status };
		if (status == "online") data.activities = [{ name: "Integrelle", type: ActivityType.Playing }];
		this.discord.user.setPresence(data);
		this.discordLog(`${this.discord.user.tag} is ${status}`);
	}

	async getRoomParents(roomId: string) {
		if (!this.useMatrix) return [];
		const states = await this.matrix.getRoomState(roomId);
		let names: string[] = [];
		let name = states.filter(state => state.type == "m.room.name").pop()?.content.name || "";
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
			const mxid = await this.database.getChannelRoom(channelId);
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
			const dcid = await this.database.getRoomChannel(roomId);
			if (!dcid) return false;
			const mxUser = "@discord_" + this.getDiscordId() + ":matrix.northwestw.in";
			const members = await this.matrix.getRoomMembers(roomId);
			return members.some(member => member.stateKey == mxUser);
		} catch (err) {
			return false;
		}
	}
}