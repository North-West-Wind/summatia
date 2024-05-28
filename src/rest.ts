import { REST, Routes } from "discord.js";
import "dotenv/config";
import { getCommands } from "./types/command";

if (!process.env.CLIENT_ID) throw new Error("client id not set");
if (!process.env.TOKEN) throw new Error("bot token not set");

// application command registration
const rest = new REST().setToken(process.env.TOKEN);

(async () => {
	const commands = getCommands().map(cmd => cmd.data.toJSON());
	try {
		console.log(`Started refreshing ${commands.length} application (/) commands.`);

		let data: unknown;
		if (process.env.GUILD_ID)
			data = await rest.put(
				Routes.applicationGuildCommands(process.env.CLIENT_ID!, process.env.GUILD_ID),
				{ body: commands },
			);
		else
			data = await rest.put(
				Routes.applicationCommands(process.env.CLIENT_ID!),
				{ body: commands },
			);

		console.log(`Successfully reloaded ${(data as []).length} application (/) commands.`);
	} catch (error) {
		// And of course, make sure you catch and log any errors!
		console.error(error);
	}
})();