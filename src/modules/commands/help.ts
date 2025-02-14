import { SlashCommandBuilder, ChatInputCommandInteraction, SlashCommandStringOption } from "discord.js";
import { Helpful, MatrixHandler, SummatiaListeners } from "..";
import { RoomMessageEvent } from "../../types/events";
import { Summatia } from "../../summatia";
import { SummatiaCommandHelpModule } from "../commands";
import { renderMarkdown } from "../../helpers/strings";

export class HelpCommand extends SummatiaCommandHelpModule implements MatrixHandler {

	constructor() {
		super("help", { listen: [SummatiaListeners.MATRIX_MESSAGE] });
	}

	description() {
		return "Prints information for various things Summatia can do.";
	}

	examples() {
		return [
			"help",
			"help listen"
		];
	}

	getSlashCommandBuilder(summatia: Summatia) {
		const data = new SlashCommandBuilder()
			.setName(this.name)
			.setDescription(this.description());

		const choices = new Set(summatia.modules[SummatiaListeners.HELP].keys());
		for (const exclusion of summatia.modules[SummatiaListeners.HELP_MATRIX].keys())
			choices.delete(exclusion);

		data.addStringOption(new SlashCommandStringOption()
			.setName("feature")
			.setDescription("Feature to print information for.")
			.setRequired(false)
			.setChoices(Array.from(choices).map(name => ({ name, value: name }))));
		return data;
	}

	async onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction) {
		const feature = interaction.options.getString("feature");
		if (!feature) {
			await interaction.reply("Hi! I'm Summatia :>\n" +
				"I do a lot of stuff. You can check them out by `/help <feature>`.\n" + 
				"Current features: " + this.getDiscordModules(summatia).map(name => `\`${name}\``).join(", "));
		} else {
			if (!this.getDiscordModules(summatia).includes(feature)) return await interaction.reply(`I don't know what ${feature} is :<`);
			const module = summatia.modules[SummatiaListeners.HELP].get(feature) as unknown as Helpful;
			let tbSent = `# /${feature}\n${module.description()}`;
			for (const example of module.examples()) tbSent += `\n- ${example}`;
			await interaction.reply(tbSent);
		}
	}

	async onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {
		if (event.content.msgtype != "m.text" || !event.content.body.startsWith(summatia.prefix + this.name)) return;
		const feature = event.content.body.slice(summatia.prefix.length).split(/\s+/)[1];
		if (!feature) {
			const html = renderMarkdown("Hi! I'm Summatia :>  \n" +
				`I do a lot of stuff. You can check them out by \`${summatia.prefix}help <feature>\`.  \n` + 
				"Current features: " + this.getMatrixModules(summatia).map(name => `\`${name}\``).join(", "));
			await summatia.matrix.replyHtmlText(roomId, event, html);
		} else {
			if (!this.getMatrixModules(summatia).includes(feature)) return await summatia.matrix.replyText(roomId, event, `I don't know what ${feature} is :<`);
			const module = summatia.modules[SummatiaListeners.HELP].get(feature) as unknown as Helpful;
			let tbSent = `# ${summatia.prefix}${feature}\n${module.description()}`;
			for (const example of module.examples()) tbSent += `\n- ${example}`;
			await summatia.matrix.replyHtmlText(roomId, event, renderMarkdown(tbSent));
		}
	}

	private getDiscordModules(summatia: Summatia): string[] {
		const modules = new Set(summatia.modules[SummatiaListeners.HELP].keys());
		for (const module of summatia.modules[SummatiaListeners.HELP_MATRIX].keys())
			modules.delete(module);
		return Array.from(modules);
	}

	private getMatrixModules(summatia: Summatia): string[] {
		const modules = new Set(summatia.modules[SummatiaListeners.HELP].keys());
		for (const module of summatia.modules[SummatiaListeners.HELP_DISCORD].keys())
			modules.delete(module);
		return Array.from(modules);
	}
}