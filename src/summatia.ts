import { ActivityType, Client, Events, GatewayIntentBits, Partials, PresenceData, PresenceStatusData, Snowflake } from "discord.js";
import * as fs from "fs";
import { AutojoinRoomsMixin, AutojoinUpgradedRoomsMixin, MatrixClient, RustSdkCryptoStorageProvider, SimpleFsStorageProvider } from "matrix-bot-sdk";
import { RoomMessageEvent } from "./matrix/types/events";
import { LISTEN_MODULES, SummatiaListeners, SummatiaModule } from "./modules";

// Summatia handles both Matrix and Discord
export class Summatia {
	matrix: MatrixClient;
	discord: Client<true>;
	useMatrix: boolean;
	useDiscord: boolean;
	modules: Map<string, SummatiaModule>;

	constructor(useMatrix: boolean, useDiscord: boolean) {
		this.useMatrix = useMatrix;
		this.useDiscord = useDiscord;
		this.modules = new Map();

		// matrix client init
		if (!process.env.MATRIX_HOMESERVER) throw new Error("homeserver not set");
		if (!process.env.MATRIX_TOKEN) throw new Error("bot token not set");

		if (!fs.existsSync("runtime") || !fs.statSync("runtime").isDirectory()) fs.mkdirSync("runtime");
		if (!fs.existsSync("runtime/crypto") || !fs.statSync("runtime/crypto").isDirectory()) fs.mkdirSync("runtime/crypto");

		const storage = new SimpleFsStorageProvider("runtime/matrix.json");
		const cryptoStorage = new RustSdkCryptoStorageProvider("runtime/crypto");
		
		this.matrix = new MatrixClient(process.env.MATRIX_HOMESERVER!, process.env.MATRIX_TOKEN!, storage, cryptoStorage);
		AutojoinRoomsMixin.setupOnClient(this.matrix);
		AutojoinUpgradedRoomsMixin.setupOnClient(this.matrix);

		// discord client init
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

	matrixLog(...things: string[]) {
		console.log("[Matrix]", ...things);
	}

	discordLog(...things: string[]) {
		console.log("[Discord]", ...things);
	}

	addModule(module: SummatiaModule) {
		this.modules.set(module.name, module);
	}

	// create non-once event listeners
	setup() {
		this.matrix.on("room.message", (roomId: string, event: RoomMessageEvent) => {
			LISTEN_MODULES[SummatiaListeners.MESSAGE]?.forEach(module => module.onMessage(this.matrix, roomId, event));
		});

		this.discord.on(Events.MessageCreate, async message => {
			// don't listen to self, other bots or webhooks
			if (message.author.id == message.client.user.id || message.author.bot && !message.webhookId) return;
		});
		
		this.discord.on(Events.InteractionCreate, async interaction => {
			if (!interaction.isChatInputCommand()) return;
			const command = getCommands().get(interaction.commandName);
			if (command) {
				try {
					await command.execute(interaction);
				} catch(err) {
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

	setDiscordPresence(status: PresenceStatusData) {
		let data: PresenceData = { status };
		if (status == "online") data.activities = [{ name: "Integrelle", type: ActivityType.Playing }];
		this.discord.user.setPresence(data);
		this.discordLog(`${this.discord.user.tag} is ${status}`);
	}

	isChannelBridged(channelId: Snowflake) {
		if (!this.useMatrix) return false;
		
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
}