import { ActivityType, Client, Events, GatewayIntentBits, MessageType, Partials, REST, Routes } from "discord.js";
import * as fs from "fs";
import fetch from "node-fetch";
import { getCommands } from "./types/command";
import { shouldListen } from "./db";
import { chatDiscord, isOnline } from "../api";

if (!process.env.OLLAMA_MEMORY_HOST) throw new Error("ollama-memory host not set");
if (!process.env.DISCORD_TOKEN) throw new Error("bot token not set");

if (!fs.existsSync("runtime") || !fs.statSync("runtime").isDirectory()) fs.mkdirSync("runtime");

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
	if (message.author.id == message.client.user.id || message.author.bot && !message.webhookId) return;
	if (!(await isOnline())) {
		online = false;
		setPresence(message.client);
		return;
	}
	const interval = setInterval(() => message.channel.sendTyping().catch(() => {}), 10000);
	let res: boolean | string | undefined;
	try {
		if (message.channel.isDMBased()) res = await chatDiscord(message.author.displayName, "Discord Direct Message", message, false);
		else if (message.mentions.has(message.client.user.id) ||
			message.content.toLowerCase().includes("summatia") ||
			message.type == MessageType.Reply && (await message.channel.messages.fetch(message.reference?.messageId!)).author.id == message.client.user.id) res = await chatDiscord(message.author.displayName, `Discord channel "${message.channel.name}" in server "${message.guild?.name}"`, message, false);
		else {
			const chance = await shouldListen(message.channelId);
			if (chance >= 0) res = await chatDiscord(message.author.displayName, `Discord channel "${message.channel.name}" in server "${message.guild?.name}"`, message, Math.random() * 100 > chance);
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
	clearInterval(interval);
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

client.login(process.env.DISCORD_TOKEN);