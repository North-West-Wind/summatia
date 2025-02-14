import { SalmonRunWeapon, SplatStage } from "splatoon3api/dist/types";

export type FestRecord = {
	__splatoon3ink_id: string;
	id: string;
	state: "SCHEDULED" | "FIRST_HALF" | "CLOSED";
	startTime: string;
	endTime: string;
	title: string;
	lang: "USen" | "EUen" | "JPja";
	image: { url: string };
	teams: [FestTeam, FestTeam, FestTeam];
	__typename: "Fest";
	isVotable: boolean;
}

type FestTeam = {
	result: any; // too much to map and not important
	id: string;
	teamName: string;
	color: { a: number, r: number, g: number, b: number };
	image: { url: string };
}

export type EggstraWorkSchedule = {
	startTime: string;
	endTime: string;
	setting: EggstraWorkSetting;
}

type EggstraWorkSetting = {
	rule: "TEAM_CONTEST";
	coopStage: SplatStage;
	weapons: SalmonRunWeapon[];
}