import { SlashCommandBuilder, ChatInputCommandInteraction, SlashCommandSubcommandBuilder, SlashCommandStringOption, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Snowflake, TextChannel, AttachmentBuilder } from "discord.js";
import { Client } from "splatoon3api";
import { ChallengeTimePeriod, FestRegion, FestRotation, SalmonSchedule, SplatChallenge, SplatRotation, SplatStage } from "splatoon3api/dist/types";
import { RoomMessageEvent } from "../../types/events";
import { Summatia } from "../../summatia";
import { SummatiaCommandHelpModule } from "../commands";
import moment, { MomentInput } from "moment";
import { Initialized, SummatiaListeners } from "..";
import { BitflagManipulator } from "../../database-providers/splatoon3";
import { renderMarkdown } from "../../helpers/strings";
import { schedule } from "node-cron";
import fetch from "node-fetch";
import { imageMeta } from "image-meta";
import { imageMessageContent } from "../../helpers/matrix/sender";
import mimeLite from "mime-lite";
import { Splatoon3ExtraClient } from "../../helpers/splatoon3ink";

const Splatoon3 = new Client();
Splatoon3.options.userAgent = `summatia/1.0.0`;
Splatoon3.options.cache = { enabled: true, ttl: 60 };

const Splatoon3Extra = new Splatoon3ExtraClient(Splatoon3.options.userAgent, Splatoon3.options.cache.enabled ? Splatoon3.options.cache.ttl! : 0);

type DoubleRotation = {
	mode1: (SplatRotation | FestRotation | null)[];
	mode2: (SplatRotation | FestRotation | null)[];
}

export class Splatoon3Command extends SummatiaCommandHelpModule implements Initialized {
	lobbies = ["turf", "anarchy", "x", "fest", "salmon", "challenge"];
	singleLobby = ["turf", "x"];
	// DO NOT change this order!
	events = {
		festSoon: "Splatfest Sneak Peek Starts",
		festStart: "Splatfest Starts",
		bigRunStart: "Big Run Starts",
		challengeStart: "Challenge Starts",
		challengeHappen: "Challenge Happens",
		eggstraWorkStart: "Eggstra Work Starts",
	};

	subscriptions: Map<string, Set<string | Snowflake>>;
	pastFests!: Set<string>;
	summatia!: Summatia;

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
		this.pastFests = new Set(await summatia.database.providers.splatoon3.getPastFests());
		this.summatia = summatia;
		schedule("0 */2 * * *", this.rotationUpdate.bind(this));
	}

	description() {
		return "Displays rotations and schedules of Splatoon 3, or subscribe to be notified for events.";
	}

	examples() {
		return [
			"splatoon3 [schedule] [turf|anarchy|x|salmon|challenge]",
			`splatoon3 subscribe [multi-entry sep. by ',': ${Array.from(Object.keys(this.events)).join("|")}]`,
			"splatoon3 subscriptions"
		];
	}

	getSlashCommandBuilder() {
		const data = new SlashCommandBuilder().setName(this.name).setDescription(this.description());

		data.addSubcommand(new SlashCommandSubcommandBuilder()
			.setName("schedule")
			.setDescription("Get rotations or schedules for lobbies.")
			.addStringOption(new SlashCommandStringOption()
				.setName("lobby")
				.setDescription("The lobby to get schedule for. Omit for current rotation of everything.")
				.setChoices(this.lobbies.map(v => ({ value: v, name: v })))));

		data.addSubcommand(new SlashCommandSubcommandBuilder()
			.setName("subscribe")
			.setDescription("Subscribe to be notified for an event."));

		data.addSubcommand(new SlashCommandSubcommandBuilder()
			.setName("subscriptions")
			.setDescription("List the events you are subscribed to."));

		return data;
	}

	async onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction) {
		const subcommand = interaction.options.getSubcommand();
		if (subcommand == "schedule") {
			await interaction.deferReply();
			const lobby = interaction.options.getString("lobby");
			await interaction.editReply(await this.showSchedule(lobby));
		} else if (subcommand == "subscribe") {
			let selection = new Set<string>(this.getSubscriptionsRaw(interaction.channelId));
			const select = new StringSelectMenuBuilder()
				.setCustomId("subscription")
				.setPlaceholder("Choose what event to be notified for")
				.setMinValues(0)
				.setMaxValues(Array.from(Object.keys(this.events)).length)
				.addOptions(Object.entries(this.events).sort(([k1, _v1], [k2, _v2]) => k1.localeCompare(k2)).map(([k, v]) => new StringSelectMenuOptionBuilder().setLabel(v).setValue(k).setDefault(selection.has(k))));
			const confirm = new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success);
			const cancel = new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger);
			const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
			const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(confirm, cancel);
			const makeContent = () => `This channel is currently notified for ${selection.size ? `**${Array.from(selection.values()).map(sub => this.events[sub as keyof typeof this.events]).join("**, **")}**` : "nothing :<"}`;
			const res = await interaction.reply({ content: makeContent(), components: [row, row2] });
			try {
				const collector = res.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });
				collector.on("collect", async int => {
					if (int.user.id != interaction.user.id) return;
					selection = new Set(int.values);
					await int.update({ content: makeContent() });
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
		} else if (subcommand == "subscriptions")
			await interaction.reply(await this.getSubscriptions(summatia, interaction.channelId));
	}
	
	async onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {
		if (!this.isValidMatrixCommand(summatia, event)) return;
		const args = this.getMatrixArgs(summatia, event.content.body);
		if (!args.length || args[0] == "schedule") await summatia.matrix.replyHtmlText(roomId, event, renderMarkdown(await this.showSchedule(null)));
		else if (this.lobbies.includes(args[0]) || (args[0] == "schedule" && this.lobbies.includes(args[1]))) await summatia.matrix.replyHtmlText(roomId, event, renderMarkdown(await this.showSchedule(args[0])));
		else if (args[0] == "subscribe") {
			args.shift();
			const selection = new Set<string>();
			args.forEach(arg => arg.split(",").filter(a => Array.from(Object.keys(this.events)).includes(a)).forEach(a => selection.add(a)));
			this.setSubscriptions(summatia, roomId, Array.from(selection.values()))
				.then(async () => await summatia.matrix.replyHtmlText(roomId, event, renderMarkdown(`Subscribed to ${selection.size ? Array.from(selection.values()).map(v => `**${(this.events as any)[v]}**`).join(", ") : "nothing :<"}`)))
				.catch(async err => {
					console.error(err);
					await summatia.matrix.replyText(roomId, event, "Ah! Something went wrong! ;▵;");
				});
		} else if (args[0] == "subscriptions") await summatia.matrix.replyHtmlText(roomId, event, renderMarkdown(await this.getSubscriptions(summatia, roomId)));
		else await summatia.matrix.replyText(roomId, event, "Unknown subcommand :<");
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
			if (coopData.regularSchedules.length)	{
				description += `  \nSalmon Run: ${this.salmonStageStr(coopData.regularSchedules[0])}`;
				description += `  \n${this.salmonWeaponStr(coopData.regularSchedules[0])}`;
			}

			const challengeData = await Splatoon3.getChallenges();
			if (challengeData.length) {
				const nextTime = challengeData[0].timePeriods[this.getNextPeriodIndex(challengeData[0].timePeriods)];
				const name = challengeData[0].name;
				description += `\n\n**${name}** `;
				if (this.isNowBetweenIsos(nextTime.startTime, nextTime.endTime)) description += "is happening **right now!**";
				else description += `will happen on **${this.isoStr(nextTime.startTime)}** (UTC+0)`;
			}

			if (coopData.bigRunSchedules.length) {
				const schedule = coopData.bigRunSchedules[0];
				description += `\n\n**Big Run** in **${this.salmonStageStr(schedule)}** `;
				if (this.isNowBetweenIsos(schedule.start_time, schedule.end_time)) description += "is happening **right now!**";
				else description += `will happen on **${this.isoStr(schedule.start_time)}** (UTC+0)`;
			}

			const eggstraData = await Splatoon3Extra.getEggstraWork();
			if (eggstraData.length) {
				const setting = eggstraData[0].setting;
				description += `\n\n**Eggstra Work** in **${setting.coopStage.name}** `;
				if (this.isNowBetweenIsos(eggstraData[0].startTime, eggstraData[0].endTime)) description += "is happening **right now!**";
				else description += `will happen on **${this.isoStr(eggstraData[0].startTime)}** (UTC+0)`;
				description += `  \n${setting.weapons.map(w => w.name).join(" / ")}`
			}

			return description;
		} else if (this.lobbies.indexOf(lobby) <= 3) {
			// turf, anarchy, x or fest
			const data = await Splatoon3.getStages();
			if (this.singleLobby.includes(lobby)) description = this.showSingleLobbySchedule(lobby == "turf" ? data.regular : data.xbattle);
			else if (lobby == "anarchy") description = this.showDoubleLobbySchedule({ mode1: data.ranked.map(r => r?.series || null), mode2: data.ranked.map(r => r?.open || null) });
			else description = this.showDoubleLobbySchedule({ mode1: data.festSchedule.map(r => r?.regular || null), mode2: data.festSchedule.map(r => r?.challenge || null) }, true);
		} else if (lobby == "salmon") {
			// salmon
			const data = await Splatoon3.getSalmonRun();
			description = data.regularSchedules.map((r, ii) =>
				`**${this.isoStr(r.start_time)} - ${this.isoStr(r.end_time)}**${ii == 0 && this.isNowBetweenIsos(r.start_time, r.end_time) ? " **(Now!)**" : ""}  \n${this.salmonStageStr(r)}  \n${this.salmonWeaponStr(r)}`).join("\n\n");

			if (data.bigRunSchedules.length) {
				const schedule = data.bigRunSchedules[0];
				description += `\n\n**Big Run** in **${this.salmonStageStr(schedule)}** `;
				if (this.isNowBetweenIsos(schedule.start_time, schedule.end_time)) description += "is happening **right now!**";
				else description += `will happen on **${this.isoStr(schedule.start_time)}** (UTC+0)`;
			}

			const eggstraData = await Splatoon3Extra.getEggstraWork();
			if (eggstraData.length) {
				const setting = eggstraData[0].setting;
				description += `\n\n**Eggstra Work** in **${setting.coopStage.name}** `;
				if (this.isNowBetweenIsos(eggstraData[0].startTime, eggstraData[0].endTime)) description += "is happening **right now!**";
				else description += `will happen on **${this.isoStr(eggstraData[0].startTime)}** (UTC+0)`;
				description += `  \n${setting.weapons.map(w => w.name).join(" / ")}`
			}
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
					if (ii == 0) description += "\n\nLooks like a Splatfest is going on!";
					else description += "\n\nA Splatfest is gonna happen!";
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

	private showDoubleLobbySchedule(rotations: DoubleRotation, festRotation = false) {
		if (rotations.mode1.length != rotations.mode2.length) return "";
		let hasFest = false;
		let description = "";
		for (let ii = 0; ii < rotations.mode1.length; ii++) {
			const rota1 = rotations.mode1[ii];
			const rota2 = rotations.mode2[ii]
			if (!rota1 || !rota2) {
				if (!hasFest) {
					hasFest = true;
					if (ii == 0) description += `\n\nLooks like ${festRotation ? "there isn't a Splatfest right now" : "a Splatfest is going on"}!`;
					else description += `\n\n${festRotation ? "The Splatfest ends" : "A Splatfest starts"} here!`;
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
			description += challenge.desc.replace(/<br *\/>/g, "  \n") + "\n\n";
			description += challenge.eventRule.replace(/<br *\/>/g, "  \n") + "\n\n";
			description += `**${this.isoStr(challenge.timePeriods[0].startTime)} - ${this.isoStr(challenge.timePeriods[challenge.timePeriods.length - 1].endTime)}**`;
			if (ii == 0 && this.isNowBetweenIsos(challenge.timePeriods[nextTime].startTime, challenge.timePeriods[nextTime].endTime))
				description += " **(Now!)**";
			description += `  \n${this.stagesStr(challenge.stages)} **${challenge.gameRule}**`;
		}
		return description;
	}

	private stageStr(rotation: SplatRotation | FestRotation) {
		return `${rotation.stage1.name} | ${rotation.stage2.name}`;
	}

	private stagesStr(stages: SplatStage[]) {
		return stages.map(s => s.name).join(" | ");
	}

	private salmonStageStr(rotation: SalmonSchedule) {
		return `${rotation.stage.name} | ${rotation.boss}`;
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

	private isNowBetweenIsos(start: MomentInput, end: MomentInput) {
		return moment().isBetween(start, end);
	}

	private isoStr(iso: string) {
		return moment(iso).format("MM/DD HH:mm");
	}

	private async setSubscriptions(summatia: Summatia, channelOrRoom: string, subs: string[]) {
		const other = /^\d+$/.test(channelOrRoom) ? await summatia.database.providers.bridge.getChannelRoom(channelOrRoom) : await summatia.database.providers.bridge.getRoomChannel(channelOrRoom);
		const manipulator = new BitflagManipulator(0);
		const keys = Array.from(Object.keys(this.events));
		const cSubs = keys.filter(s => !subs.includes(s));
		subs.forEach(sub => {
			this.subscriptions.get(sub)?.add(channelOrRoom);
			if (other) this.subscriptions.get(sub)?.add(other);
			const index = keys.indexOf(sub);
			if (index >= 0) manipulator.set(index, true);
		});
		for (const sub of cSubs) {
			this.subscriptions.get(sub)?.delete(channelOrRoom);
			if (other) this.subscriptions.get(sub)?.delete(other);
		}
		await summatia.database.providers.splatoon3.setSubscriptions(channelOrRoom, manipulator);
		if (other) await summatia.database.providers.splatoon3.setSubscriptions(other, manipulator);
	}

	private getSubscriptionsRaw(channelOrRoom: string) {
		const subs: string[] = [];
		for (const sub in this.events)
			if (this.subscriptions.get(sub)?.has(channelOrRoom))
				subs.push(sub);
		return subs;
	}

	private async getSubscriptions(summatia: Summatia, channelOrRoom: string) {
		const subs = this.getSubscriptionsRaw(channelOrRoom).map(sub => this.events[sub as keyof typeof this.events]);
		const isDiscord = /^\d+$/.test(channelOrRoom);
		let message = `This ${isDiscord ? "channel" : "room"} is will be notified for `;
		if (subs.length) message += `**${subs.sort().join("**, **")}**`;
		else message += "nothing :<";

		const other = isDiscord ? await summatia.database.providers.bridge.getChannelRoom(channelOrRoom) : await summatia.database.providers.bridge.getRoomChannel(channelOrRoom);
		if (other) {
			const bridgeSubs = this.getSubscriptionsRaw(other).map(sub => this.events[sub as keyof typeof this.events]);
			message += `  \nBridged ${isDiscord ? "room" : "channel"} is also subscribed to `;
			if (bridgeSubs.length != subs.length || !bridgeSubs.every(s => subs.includes(s)))
				message += `**${subs.sort().join("**, **")}**`;
			else message += `the same events`;
		}
		return message;
	}

	private async rotationUpdate() {
		console.log("Updating Splatoon 3 rotation...");
		const messages = new Map<keyof typeof this.events, { str: string, img?: string }[]>();

		const challenge = (await Splatoon3.getChallenges())[0];
		let challengeStartStr = "";
		if (challenge && this.isNowBetweenIsos(challenge.timePeriods[0].startTime, challenge.timePeriods[0].endTime)) {
			challengeStartStr += `# ${challenge.name}\nis starting its first rotation **right now!**  \n`;
			challengeStartStr += `${challenge.desc}\n\n`;
			challengeStartStr += `${challenge.eventRule.replace(/<br *\/>/g, "  \n")}\n\n`;
			challengeStartStr += `**${this.isoStr(challenge.timePeriods[0].startTime)} - ${this.isoStr(challenge.timePeriods[challenge.timePeriods.length - 1].endTime)}** (UTC+00:00)  \n`;
			challengeStartStr += `${this.stagesStr(challenge.stages)} **${challenge.gameRule}**`;
		}
		if (challengeStartStr) messages.set("challengeStart", [{ str: challengeStartStr }]);

		let challengeHappenStr = "";
		if (challenge && !challengeStartStr) {
			const nextTime = this.getNextPeriodIndex(challenge.timePeriods);
			if (this.isNowBetweenIsos(challenge.timePeriods[nextTime].startTime, challenge.timePeriods[nextTime].endTime)) {
				challengeHappenStr += `# ${challenge.name}\nis happening **right now!**  \n`;
				challengeHappenStr += `${challenge.desc}\n\n`;
				challengeHappenStr += `${challenge.eventRule.replace(/<br *\/>/g, "  \n")}\n\n`;
				challengeHappenStr += `**${this.isoStr(challenge.timePeriods[nextTime].startTime)} - ${this.isoStr(challenge.timePeriods[nextTime].endTime)}** (UTC+00:00)  \n`;
				challengeHappenStr += `${this.stagesStr(challenge.stages)} **${challenge.gameRule}**`;
			}
		}
		if (challengeHappenStr) messages.set("challengeHappen", [{ str: challengeHappenStr }]);

		const salmon = await Splatoon3.getSalmonRun();
		let bigRunStartStr = "";
		if (salmon.bigRunSchedules.length && this.isNowBetweenIsos(salmon.bigRunSchedules[0].start_time, moment(salmon.bigRunSchedules[0].start_time).add(2, "hour"))) {
			const bigRun = salmon.bigRunSchedules[0];
			bigRunStartStr += `# Big Run in ${bigRun.stage}!\n`;
			bigRunStartStr += `It's happening **right now!**  \n`;
			bigRunStartStr += `**${this.isoStr(bigRun.start_time)}** - **${this.isoStr(bigRun.end_time)}** (UTC+00:00)  \n`;
			bigRunStartStr += `${bigRun.boss} | ${bigRun.weapons.map(w => w.name).join(", ")}`;
		}
		if (bigRunStartStr) messages.set("bigRunStart", [{ str: bigRunStartStr }]);

		let festSoon = false;
		let festStart = false;
		for (const record of Array.from(Object.values(await Splatoon3Extra.getFullSplatfests())).map(records => records[0])) {
			if (!this.pastFests.has(record.__splatoon3ink_id) && record.state == "SCHEDULED") {
				this.pastFests.add(record.__splatoon3ink_id);
				this.summatia.database.providers.splatoon3.addPastFest(record.__splatoon3ink_id).catch(console.error);
				if (!festSoon) {
					festSoon = true;
					messages.set("festSoon", [{ str: "Splatfest happening soon! You can vote now!" }]);
				}
				let indFestSoonStr = `# ${record.title}\n`;
				indFestSoonStr += `This Splatfest will happen on **${this.isoStr(record.startTime)}** - **${this.isoStr(record.endTime)}**  \n`;
				indFestSoonStr += `Teams: **${record.teams.map(team => team.teamName).join("**, **")}**`;
				messages.get("festSoon")!.push({ str: indFestSoonStr, img: record.image.url });
			}
			if (this.isNowBetweenIsos(record.startTime, moment(record.startTime).add(2, "hour"))) {
				if (!festStart) {
					festStart = true;
					messages.set("festStart", [{ str: "Splatfest is happening!" }]);
				}
				let indFestStartStr = `# ${record.title}\n`;
				indFestStartStr += `This Splatfest is going from **${this.isoStr(record.startTime)}** to **${this.isoStr(record.endTime)}**  \n`;
				indFestStartStr += `Teams: **${record.teams.map(team => team.teamName).join("**, **")}**`;
				messages.get("festStart")!.push({ str: indFestStartStr, img: record.image.url });
			}
		}

		const eggstra = await Splatoon3Extra.getEggstraWork();
		let eggstraWorkStartStr = "";
		if (eggstra.length && this.isNowBetweenIsos(eggstra[0].startTime, moment(eggstra[0].startTime).add(2, "hour"))) {
			const eggstraWork = eggstra[0];
			eggstraWorkStartStr += `# Eggstra Work in ${eggstraWork.setting.coopStage.name}!\n`;
			eggstraWorkStartStr += `It's happening **right now!**  \n`;
			eggstraWorkStartStr += `**${this.isoStr(eggstraWork.startTime)}** - **${this.isoStr(eggstraWork.endTime)}** (UTC+00:00)  \n`;
			eggstraWorkStartStr += `${eggstraWork.setting.weapons.map(w => w.name).join(", ")}`;
		}
		if (eggstraWorkStartStr) messages.set("eggstraWorkStart", [{ str: eggstraWorkStartStr }]);

		for (const [key, message] of messages.entries()) {
			const bridges = new Set<string>();
			for (const id of this.subscriptions.get(key) || []) {
				if (bridges.has(id)) continue;
				const other = /^\d+$/.test(id) ? await this.summatia.database.providers.bridge.getChannelRoom(id) : await this.summatia.database.providers.bridge.getRoomChannel(id);
				if (other) bridges.add(other);
				await this.sendRotationMessage(id, message);
			}
		}
	}

	private async sendRotationMessage(channelOrRoom: string, message: { str: string, img?: string }[]) {
		if (!this.summatia || !message) return;
		const isDiscord = /^\d+$/.test(channelOrRoom);
		const channel = isDiscord ? await this.summatia.discord.channels.fetch(channelOrRoom) : undefined;
		const send = async (str: string, img?: string) => {
			if (isDiscord) {
				if (img) await (channel as TextChannel).send({ content: str, files: [new AttachmentBuilder(img)] });
				else await (channel as TextChannel).send(str);
			} else {
				await this.summatia?.matrix.sendHtmlText(channelOrRoom, renderMarkdown(str));
				if (img) {
					const res = await fetch(img);
					const buffer = await res.buffer();
					const meta = imageMeta(buffer);
					const info = { w: meta.width, h: meta.height, mimetype: mimeLite.getType(meta.type!)!, size: buffer.byteLength };
					const mxc = await this.summatia?.matrix.uploadContentFromUrl(img);
					if (mxc) {
						if (await this.summatia.matrix.crypto.isRoomEncrypted(channelOrRoom)) {
							const encrypted = await this.summatia?.matrix.crypto.encryptMedia(buffer);
							await this.summatia.matrix.sendMessage(channelOrRoom, imageMessageContent(mxc, "rot.png", info, encrypted?.file));
						} else await this.summatia.matrix.sendMessage(channelOrRoom, imageMessageContent(mxc, "rot.png", info));
					}
				}
			}
		}
		for (const { str, img } of message) {
			if (!str) continue;
			try {
				await send(str, img);
			} catch (err) {
				console.error(err);
			}
		}
	}
}