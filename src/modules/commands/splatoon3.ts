import { SlashCommandBuilder, ChatInputCommandInteraction, SlashCommandSubcommandBuilder, SlashCommandStringOption } from "discord.js";
import { Client } from "splatoon3api";
import { ChallengeTimePeriod, FestRotation, SplatRotation } from "splatoon3api/dist/types";
import { RoomMessageEvent } from "../../matrix/types/events";
import { Summatia } from "../../summatia";
import { SummatiaCommandHelpModule } from "../commands";
import { name, version } from "../../../package.json";
import moment from "moment";

const Splatoon3 = new Client();
Splatoon3.options.userAgent = `${name}/${version}`;
Splatoon3.options.cache = { enabled: true, ttl: 60 };

export class Splatoon3Command extends SummatiaCommandHelpModule {
	lobbies = ["turf", "anarchy", "x", "salmon", "challenge"];

	description() {
		return "Displays information of current rotations and schedules of Splatoon 3, or subscribe to be notified for events.";
	}

	examples() {
		return [
			"splatoon3 [turf|anarchy|x|salmon|challenge]",
			"splatoon3 <subscribe|unsubscribe> [multi-entry sep. by ',': festSoon|festStart|bigRunStart|challengeStart|challengeHappen]"
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

		data.addSubcommand(new SlashCommandSubcommandBuilder()
		.setName("unsubscribe")
		.setDescription("Unsubscribe from being notified for an event.")
		.addStringOption(new SlashCommandStringOption()
			.setName("events")
			.setDescription("The events to stop listening for.")));

		return data;
	}

	onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction) {
		const subcommand = interaction.options.getSubcommand();
		if (!subcommand) {
			const lobby = interaction.options.getString("lobby");

		}
	}
	
	onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {
		throw new Error("Method not implemented.");
	}
	
	private async showSchedule(lobby?: string) {
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
				description += `  \nSalmon Run: ${coopData.regularSchedules[0].stage} | ${coopData.regularSchedules[0].boss}`;
				description += `  \n${coopData.regularSchedules[0].weapons.map(w => w.name).join(" / ")}`;
			}
			if (coopData.bigRunSchedules.length && coopData.bigRunSchedules[0]) description += `  \nBig Run: ${coopData.bigRunSchedules[0].stage} | ${coopData.bigRunSchedules[0].boss}`;
			
			const challengeData = await Splatoon3.getChallenges();
			if (challengeData.length) {
				const nextTime = challengeData[0].timePeriods[this.getNextPeriodIndex(challengeData[0].timePeriods)];
				const name = challengeData[0].name;
				description += `\n\n**${name}** `;
				if (this.isNowBetweenIsos(nextTime.startTime, nextTime.endTime)) description += "is happening **right now!**";
				else description += `will happen on **${moment(nextTime.startTime).format("MM/DD HH:mm")}** (UTC+0)`;
			}
		}
	}

	private stageStr(rot: SplatRotation | FestRotation) {
		return `${rot.stage1} | ${rot.stage2}`;
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
}