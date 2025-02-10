// Helper for getting data from Splatoon3.ink. The splatoon3api package is too incomplete

import { FestRegion } from "splatoon3api/dist/types";
import { EggstraWorkSchedule, FestRecord } from "../matrix/types/splatoon3";
import { schedule } from "node-cron";

type CachedData = {
	data: any;
	time: number;
}

export class Splatoon3ExtraClient {
	userAgent: string;
	ttl: number;

	festData?: CachedData;
	coopData?: CachedData;

	constructor(userAgent: string, ttl: number) {
		this.userAgent = userAgent;
		this.ttl = ttl;

		// invalidate on rotation update
		schedule("0 */2 * * *", this.clearCaches.bind(this));
	}

	async getFullSplatfests() {
		let fest: { [key in FestRegion]: { data: { festRecords: { nodes: FestRecord[] } } } };
		if (this.shouldUseCache(this.festData)) fest = this.festData!.data;
		else {
			const res = await fetch("https://splatoon3.ink/data/festivals.json");
			fest = (await res.json()) as ({ [key in FestRegion]: { data: { festRecords: { nodes: FestRecord[] } } } });
			this.festData = { data: fest, time: Date.now() };
		}
		const flattened: Partial<{ [key in FestRegion]: FestRecord[] }> = {};
		for (const key in fest)
			flattened[key as FestRegion] = fest[key as FestRegion].data.festRecords.nodes;
		return flattened as { [key in FestRegion]: FestRecord[] };
	}

	async getEggstraWork() {
		let coop: EggstraWorkSchedule[];
		if (this.shouldUseCache(this.coopData)) coop = this.coopData!.data;
		else {
			const res = await fetch("https://splatoon3.ink/data/schedules.json");
			coop = (await res.json()); // this is not quite right yet
			coop = coop.map(s => {
				s.setting.coopStage.image = (s.setting.coopStage.image as any).url;
				s.setting.weapons = s.setting.weapons.map(w => {
					w.image = (w.image as any).url;
					return w;
				});
				return s;
			});
			this.coopData = { data: coop, time: Date.now() };
		}
		return coop;
	}

	private shouldUseCache(cached?: CachedData) {
		if (!cached?.data || !cached.time) return false;
		return Date.now() - cached.time < this.ttl;
	}

	private clearCaches() {
		this.festData = undefined;
		this.coopData = undefined;
	}
}