import { SlashCommandBuilder, ChatInputCommandInteraction, SlashCommandNumberOption, SlashCommandBooleanOption, SlashCommandStringOption, MessageFlags } from "discord.js";
import { Summatia } from "../../summatia";
import { RoomMessageEvent } from "../../types/events";
import { SummatiaCommandHelpModule } from "../commands";

export class RandomCommand extends SummatiaCommandHelpModule {
	constructor() {
		super("random");
	}

	description() {
		return "Get a random number between range, or make a choice.";
	}

	examples() {
		return [
			"random",
			"random 1 10",
			"random 1 10 float",
			"random summatia integrelle aria clex"
		];
	}

	getSlashCommandBuilder(summatia: Summatia) {
		const data = new SlashCommandBuilder()
			.setName(this.name)
			.setDescription(this.description());

		data
			.addNumberOption(new SlashCommandNumberOption().setName("min").setDescription("Minimum range of the random number (inclusive)."))
			.addNumberOption(new SlashCommandNumberOption().setName("max").setDescription("Maximum range of the random number (inclusive)."))
			.addBooleanOption(new SlashCommandBooleanOption().setName("float").setDescription("Generate a decimal number instead of integer."))
			.addStringOption(new SlashCommandStringOption().setName("choices").setDescription("Choices separated by space."));

		return data;
	}

	async onDiscordCommandInteraction(_summatia: Summatia, interaction: ChatInputCommandInteraction) {
		const min = interaction.options.getNumber("min");
		const max = interaction.options.getNumber("max");
		const float = interaction.options.getBoolean("float");
		const choices = interaction.options.getString("choices");
		
		if ((min === null || max === null) && !choices) {
			if (float) await interaction.reply(`${Math.random()}`);
			else await interaction.reply(Math.random() > 0.5 ? "yes <:yay:1338734869341274112>" : "no <:scared:1340218336163790858>");
		} else if (min !== null && max !== null) {
			const res = Math.random() * (max - min) + min;
			if (float) await interaction.reply(`${res}`);
			else await interaction.reply(`${Math.round(res)}`);
		} else if (choices) {
			const choiche = choices.split(/\s+/g); // Not typo. It's a Mario Maker joke :>
			if (!choiche) await interaction.reply({ content: "Choiche not found?? <a:annoyed:1338734979559063584>", flags: MessageFlags.Ephemeral });
			else if (float) {
				const index = Math.floor(Math.random() * (choiche.length - 1));
				await interaction.reply(`Uhhh... Somewhere between **${choiche[index]}** and **${choiche[index + 1]}** <:pog:1340213745850253402>`);
			} else await interaction.reply(choiche[Math.floor(Math.random() * choiche.length)]);
		} else
			await interaction.reply({ content: "Eh? The handbook doesn't say what to do here! <a:annoyed:1338734979559063584>", flags: MessageFlags.Ephemeral });
	}

	async onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {
		if (event.content.msgtype != "m.text" || !event.content.body.startsWith(summatia.prefix + this.name)) return;
		let min: number | null = null;
		let max: number | null = null;
		let float = false;
		let choices: string[] = [];

		const args = event.content.body.slice(summatia.prefix.length + this.name.length).trim().split(/\s+/g);
		args.forEach(arg => {
			const parsed = parseFloat(arg);
			if (!isNaN(parsed)) {
				if (min === null) min = parsed;
				else if (max === null) max = parsed;
			} else if (arg.toLowerCase() == "float" && !float) float = true;
			else if (arg.trim().length) choices.push(arg);
		});

		if ((min === null || max === null) && !choices.length) {
			if (float) await summatia.matrix.sendText(roomId, `${Math.random()}`);
			else await summatia.matrix.sendHtmlText(roomId, Math.random() > 0.5 ? `yes ${await summatia.getCustomEmojiHTML("yay")}` : `no ${await summatia.getCustomEmojiHTML("scared")}`);
		} else if (min !== null && max !== null) {
			const res = Math.random() * (max - min) + min;
			if (float) await summatia.matrix.sendText(roomId, `${res}`);
			else await summatia.matrix.sendText(roomId, `${Math.round(res)}`);
		} else if (choices.length) {
			if (float) {
				const index = Math.floor(Math.random() * (choices.length - 1));
				await summatia.matrix.sendHtmlText(roomId, `Uhhh... Somewhere between <strong data-md="**">${choices[index]}</strong> and <strong data-md="**">${choices[index + 1]}</strong> ${await summatia.getCustomEmojiHTML("pog")}`);
			} else await summatia.matrix.sendText(roomId, choices[Math.floor(Math.random() * choices.length)]);
		} else
			await summatia.matrix.sendHtmlText(roomId, `Eh? The handbook doesn't say what to do here! ${await summatia.getCustomEmojiHTML("annoyed")}`);
	}
}