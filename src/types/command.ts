import { ChatInputCommandInteraction, Collection, SlashCommandBuilder } from "discord.js";
import ListenCommand from "../commands/listen";
import UnlistenCommand from "../commands/unlisten";

export default interface Command {
	name: string;
	data: SlashCommandBuilder;
	execute(interaction: ChatInputCommandInteraction): void | Promise<void>;
}

const commands = new Collection<string, Command>();

export function getCommands() {
	return commands;
}

function addCommand(command: Command) {
	commands.set(command.name, command);
}

addCommand(new ListenCommand());
addCommand(new UnlistenCommand());