import { SlashCommandBuilder, ChatInputCommandInteraction, SlashCommandSubcommandBuilder, SlashCommandStringOption, ModalBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Snowflake } from "discord.js";
import { Client } from "splatoon3api";
import { ChallengeTimePeriod, FestMatchSetting, FestRotation, RankedModes, SalmonSchedule, SplatChallenge, SplatRotation, SplatStage } from "splatoon3api/dist/types";
import { RoomMessageEvent } from "../../matrix/types/events";
import { Summatia } from "../../summatia";
import { SummatiaCommandHelpModule } from "../commands";
import { name, version } from "../../../package.json";
import moment from "moment";
import { Initialized, SummatiaListeners } from "..";
import { BitflagManipulator } from "../../database-providers/splatoon3";
import { renderMarkdown } from "../../helpers/strings";

const Splatoon3 = new Client();
Splatoon3.options.userAgent = `${name}/${version}`;
Splatoon3.options.cache = { enabled: true, ttl: 60 };

type DoubleRotation = {
	mode1: (SplatRotation | FestRotation | null)[];
	mode2: (SplatRotation | FestRotation | null)[];
}

export class Splatoon3Command extends SummatiaCommandHelpModule implements Initialized {
	lobbies = ["turf", "anarchy", "x", "fest", "salmon", "challenge"];
	singleLobby = ["turf", "x"];
	events = {
		festSoon: "Splatfest Sneak Peek Starts",
		festStart: "Splatfest Starts",
		bigRunStart: "Big Run Starts",
		challengeStart: "Challenge Starts",
		challengeHappen: "Challenge Happens"
	};

	subscriptions: Map<string, Set<string | Snowflake>>;

	constructor() {
		super("splatoon3", { listen: [SummatiaListeners.INIT] });
		this.subscriptions = new Map();
		for (const key of Object.keys(this.events))
			this.subscriptions.set(key, new Set());
	}

	async init(summatia: Summatia) {
		const sets = Array.from(Object.keys(this.events)).map(key => this.subscriptions.get(key)!);
		const subs = await summatia.database.providers.splatoon3.getAllSubscriptions();
		subs.forEach((v, k) => {
			sets.forEach((set, ii) => {
				if (v.get(ii)) set.add(k);
			});
		});
	}

	description() {
		return "Displays information of current rotations and schedules of Splatoon 3, or subscribe to be notified for events.";
	}

	examples() {
		return [
			"splatoon3 [turf|anarchy|x|salmon|challenge]",
			`splatoon3 subscribe [multi-entry sep. by ',': ${Array.from(Object.keys(this.events)).join("|")}]`
		];
	}

	getSlashCommandBuilder() {
		const data = new SlashCommandBuilder().setName(this.name).setDescription(this.description());

		data.addStringOption(new SlashCommandStringOption()
			.setName("lobby")
			.setDescription("The lobby to get schedule for. Omit for current rotation of everything.")
			.setChoices(this.lobbies.map(v => ({ value: v, name: v }))));

		data.addSubcommand(new SlashCommandSubcommandBuilder()
			.setName("subscribe")
			.setDescription("Subscribe to be notified for an event.")
			.addStringOption(new SlashCommandStringOption()
				.setName("events")
				.setDescription("The events to listen for.")));

		return data;
	}

	async onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction) {
		const subcommand = interaction.options.getSubcommand();
		if (!subcommand) {
			const lobby = interaction.options.getString("lobby");
			await interaction.reply(await this.showSchedule(lobby));
		} else if (subcommand == "subscribe") {
			let selection = new Set<string>();
			const select = new StringSelectMenuBuilder()
				.setCustomId("subscription")
				.setPlaceholder("Choose what event to be notified for")
				.setMinValues(0)
				.setMaxValues(Array.from(Object.keys(this.events)).length)
				.addOptions(Array.from(Object.entries(this.events)).map(([k, v]) => new StringSelectMenuOptionBuilder().setLabel(v).setValue(k).setDefault(selection.has(k))));
			const confirm = new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success);
			const cancel = new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger);
			const row = new ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>().addComponents(select, confirm, cancel);
			const res = await interaction.reply({ content: "Select or deselect events", components: [row] });
			try {
				const collector = res.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });
				collector.on("collect", int => {
					if (int.user.id != interaction.user.id) return;
					selection = new Set(int.values);
				});
				const button = await res.awaitMessageComponent({ filter: int => int.componentType == ComponentType.Button && int.user.id === interaction.user.id, time: 60000 });
				if (button.customId == "confirm") {
					this.setSubscriptions(summatia, interaction.channelId, Array.from(selection.values()))
						.then(async () => await interaction.editReply({ content: `Subscribed to ${selection.size ? Array.from(selection.values()).map(v => `**${(this.events as any)[v]}**`).join(", ") : "nothing :<"}`, components: [] }))
						.catch(async err => {
							console.error(err);
							await interaction.editReply({ content: "Ah! Something went wrong! ;▵;", components: [] });
						});
				} else await interaction.editReply({ content: "Cancelled :<", components: [] });
			} catch (err) {
				await interaction.editReply({ content: "Waited too long. I got bored :<", components: [] });
			}
		}
	}
	
	async onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {
		if (!this.isValidMatrixCommand(summatia, event)) return;
		const args = this.getMatrixArgs(summatia, event.content.body);
		if (!args.length) await summatia.matrix.replyHtmlText(roomId, event, renderMarkdown(await this.showSchedule(null)));
		else if (this.lobbies.includes(args[0])) await summatia.matrix.replyHtmlText(roomId, event, renderMarkdown(await this.showSchedule(args[0])));
		else if (args[0] == "subscribe") {
			args.shift();
			const selection = new Set<string>();
			args.forEach(arg => arg.split(",").filter(a => Array.from(Object.keys(this.events)).includes(a)).forEach(a => selection.add(a)));
			this.setSubscriptions(summatia, roomId, Array.from(selection.values()))
				.then(async () => await summatia.matrix.replyText(roomId, event, renderMarkdown(`Subscribed to ${selection.size ? Array.from(selection.values()).map(v => `**${(this.events as any)[v]}**`).join(", ") : "nothing :<"}`)))
				.catch(async err => {
					console.error(err);
					await summatia.matrix.replyText(roomId, event, "Ah! Something went wrong! ;▵;");
				});
		} else await summatia.matrix.replyText(roomId, event, "Unknown subcommand :<");
	}
	
	private async showSchedule(lobby?: string | null) {
		let description = "";
		if (!lobby) {
			description = "**Current rotation:**";
			const data = await Splatoon3.getCurrentStages();
			if (data.regular) description += `  \nTurf War: ${this.stageStr(data.regular)}`;
			if (data.ranked) {
				description += `  \n${data.ranked.series.rules} (Series): ${this.stageStr(data.ranked.series)}`;
				description += `  \n${data.ranked.open.rules} (Open): ${this.stageStr(data.ranked.open)}`;
			}
			if (data.xbattle) description += `  \n${data.xbattle.rules} (X): ${this.stageStr(data.xbattle)}`;
			if (data.festSchedule) {
				if (data.festSchedule.regular) description += `  \nSplatfest (Open): ${this.stageStr(data.festSchedule.regular)}`;
				if (data.festSchedule.challenge) description += `  \nSplatfest (Pro): ${this.stageStr(data.festSchedule.challenge)}`;
			}
			if (data.triColorStage) description += `  \nTricolor: ${data.triColorStage.name}`;

			description += "\n"
			const coopData = await Splatoon3.getSalmonRun();
			if (coopData.regularSchedules.length && coopData.regularSchedules[0])	{
				description += `  \nSalmon Run: ${this.salmonStageStr(coopData.regularSchedules[0])}`;
				description += `  \n${this.salmonWeaponStr(coopData.regularSchedules[0])}`;
			}
			if (coopData.bigRunSchedules.length && coopData.bigRunSchedules[0]) description += `  \nBig Run: ${this.salmonStageStr(coopData.bigRunSchedules[0])}`;
			
			const challengeData = await Splatoon3.getChallenges();
			if (challengeData.length) {
				const nextTime = challengeData[0].timePeriods[this.getNextPeriodIndex(challengeData[0].timePeriods)];
				const name = challengeData[0].name;
				description += `\n\n**${name}** `;
				if (this.isNowBetweenIsos(nextTime.startTime, nextTime.endTime)) description += "is happening **right now!**";
				else description += `will happen on **${this.isoStr(nextTime.startTime)}** (UTC+0)`;
			}

			return description;
		} else if (this.lobbies.indexOf(lobby) <= 3) {
			// turf, anarchy, x or fest
			const data = await Splatoon3.getStages();
			if (this.singleLobby.includes(lobby)) description = this.showSingleLobbySchedule(lobby == "turf" ? data.regular : data.xbattle);
			else if (lobby == "anarchy") description = this.showDoubleLobbySchedule({ mode1: data.ranked.map(r => r?.series || null), mode2: data.ranked.map(r => r?.open || null) });
			else description = this.showDoubleLobbySchedule({ mode1: data.festSchedule.map(r => r?.regular || null), mode2: data.festSchedule.map(r => r?.challenge || null) });
		} else if (lobby == "salmon") {
			// salmon
			const data = await Splatoon3.getSalmonRun();
			description = data.regularSchedules.map((r, ii) =>
				`**${this.isoStr(r.start_time)} - ${this.isoStr(r.end_time)}**${ii == 0 && this.isNowBetweenIsos(r.start_time, r.end_time) ? " **(Now!)**" : ""}  \n${this.salmonStageStr(r)}  \n${this.salmonWeaponStr(r)}`).join("\n\n");
		} else {
			// challenge
			const data = await Splatoon3.getChallenges();
			description += this.showChallengeLobbySchedule(data);
		}
		return description;
	}

	private showSingleLobbySchedule(rotations: (SplatRotation | null)[]) {
		let hasFest = false;
		let description = "";
		for (let ii = 0; ii < rotations.length; ii++) {
			const rota = rotations[ii];
			if (!rota) {
				if (!hasFest) {
					hasFest = true;
					description += "  \nLooks like a Splatfest is going on!";
				}
				continue;
			}
			description += "\n\n";
			if (ii == 0) description += "**Now**";
			else description += `**${this.isoStr(rota.start_time)}**`;
			description += `  \n${this.stageStr(rota)}`;
		}
		return description;
	}

	private showDoubleLobbySchedule(rotations: DoubleRotation) {
		if (rotations.mode1.length != rotations.mode2.length) return "";
		let hasFest = false;
		let description = "";
		for (let ii = 0; ii < rotations.mode1.length; ii++) {
			const rota1 = rotations.mode1[ii];
			const rota2 = rotations.mode2[ii]
			if (!rota1 || !rota2) {
				if (!hasFest) {
					hasFest = true;
					description += "  \nLooks like a Splatfest is going on!";
				}
				continue;
			}
			description += "\n\n";
			if (ii == 0) description += "**Now**";
			else description += `**${this.isoStr(rota1.start_time)}**`;
			description += `  \n${this.stageStr(rota1)}`;
			description += ` **${rota1.rules}**`;
			description += `  \n${this.stageStr(rota2)}`;
			description += ` **${rota2.rules}**`;
		}
		return description;
	}

	private showChallengeLobbySchedule(challenges: SplatChallenge[]) {
		let description = "";
		for (let ii = 0; ii < challenges.length; ii++) {
			const challenge = challenges[ii];
			if (challenge.timePeriods.length <= 0) continue;
			const nextTime = this.getNextPeriodIndex(challenge.timePeriods);
			description += `\n# ${challenge.name}\n`;
			description += challenge.desc + "\n\n";
			description += challenge.eventRule;
			description += `**${this.isoStr(challenge.timePeriods[0].startTime)} - ${this.isoStr(challenge.timePeriods[challenge.timePeriods.length - 1].endTime)}**`;
			if (ii == 0 && this.isNowBetweenIsos(challenge.timePeriods[nextTime].startTime, challenge.timePeriods[nextTime].endTime))
				description += " **(Now!)**";
			description += `  \n${this.stagesStr(challenge.stages)} **${challenge.gameRule}**`;
		}
		return description;
	}

	private stageStr(rotation: SplatRotation | FestRotation) {
		return `${rotation.stage1} | ${rotation.stage2}`;
	}

	private stagesStr(stages: SplatStage[]) {
		return stages.map(s => s.name).join(" | ");
	}

	private salmonStageStr(rotation: SalmonSchedule) {
		return `${rotation.stage} | ${rotation.boss}`;
	}

	private salmonWeaponStr(rotation: SalmonSchedule) {
		return rotation.weapons.map(w => w.name).join(" / ");
	}

	private getNextPeriodIndex(timePeriods: ChallengeTimePeriod[]) {
		for (let ii = 0; ii < timePeriods.length - 1; ii++) {
			if (this.isNowBetweenIsos(timePeriods[ii].startTime, timePeriods[ii].endTime))
				return ii;
			if (this.isNowBetweenIsos(timePeriods[ii].endTime, timePeriods[ii+1].endTime))
				return ii+1;
		}
		return 0;
	}

	private isNowBetweenIsos(start: string, end: string) {
		return moment().isBetween(moment(start), moment(end));
	}

	private isoStr(iso: string) {
		return moment(iso).format("MM/DD HH:mm");
	}

	private async setSubscriptions(summatia: Summatia, channelOrRoom: string, subs: string[]) {
		const manipulator = new BitflagManipulator(0);
		const cSubs = Array.from(Object.keys(this.events)).filter(s => !subs.includes(s));
		subs.forEach((sub, ii) => {
			this.subscriptions.get(sub)?.add(channelOrRoom);
			manipulator.set(ii, true);
		});
		for (const sub of cSubs)
			this.subscriptions.get(sub)?.delete(channelOrRoom);
		await summatia.database.providers.splatoon3.setSubscriptions(channelOrRoom, manipulator);
	}
}