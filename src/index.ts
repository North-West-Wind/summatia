import { ActivityType, Client, Events, GatewayIntentBits, Partials, REST, Routes } from "discord.js";
import "dotenv/config";
import fetch from "node-fetch";
import { getCommands } from "./types/command";
import { shouldListen } from "./db";
import { chat } from "./bot";

if (!process.env.OLLAMA_MEMORY_HOST) throw new Error("ollama-memory host not set");
if (!process.env.TOKEN) throw new Error("bot token not set");

let online = true;
function setPresence(client: Client<true>) {
	if (client.user.presence.status == "online" && online || client.user.presence.status != "online" && !online) return;
	if (online) client.user.setPresence({ status: "online", activities: [{ name: "Integrelle", type: ActivityType.Playing }] });
	else client.user.setPresence({ status: "invisible" });
	console.log(`${client.user.tag} is ${online ? "on" : "off"}line`);
}

const client = new Client({
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

client.once(Events.ClientReady, async readyClient => {
	console.log(`${readyClient.user.tag} is ready!`);
	try {
		const res = await fetch(process.env.OLLAMA_MEMORY_HOST! + "/check");
		if (!res.ok) online = false;
	} catch (err) {
		online = false;
	}
	setPresence(readyClient);
});

client.on(Events.MessageCreate, async message => {
	if (message.author.id == message.client.user.id) return;
	let res: boolean | string | undefined;
	try {
		if (message.channel.isDMBased()) res = await chat(message.author.displayName, "Discord Direct Message", message.content, false);
		else if (message.mentions.has(message.client.user.id) || message.content.toLowerCase().includes("summatia")) res = await chat(message.author.displayName, `Discord channel "${message.channel.name}" in server "${message.guild?.name}"`, message.content, false);
		else {
			const chance = await shouldListen(message.channelId);
			if (chance >= 0) res = await chat(message.author.displayName, `Discord channel "${message.channel.name}" in server "${message.guild?.name}"`, message.content, Math.random() * 100 > chance);
		}

		if (res !== undefined) {
			if (!res) online = false;
			else {
				if (typeof res === "string") await message.channel.send(res);
				online = true;
			}
		}
	} catch (err) {
		console.error(err);
		online = false;
	}
	if (res !== undefined) setPresence(message.client);
});

client.on(Events.InteractionCreate, async interaction => {
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

client.login(process.env.TOKEN);