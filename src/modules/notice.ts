import { SynapseUserList } from "matrix-bot-sdk";
import { Startup, SummatiaListeners, SummatiaModule } from ".";
import Logger from "../helpers/logger";
import { Summatia } from "../summatia";

export class NoticeModule extends SummatiaModule implements Startup {
	lastUpdate = Date.now();
	processing = false;

	constructor() {
		super("notice", { listen: [SummatiaListeners.START] });
	}

	async start(summatia: Summatia) {
		if (!summatia.useMatrix) return;
		if (!(await summatia.matrix.adminApis.synapse.isSelfAdmin())) {
			Logger.module.log("Notice module requires admin API access");
			return;
		}

		const qs = {
			deactivated: false,
			dir: "b",
			from: 0,
			guests: false,
			limit: 10,
			locked: false,
			order_by: "creation_ts"
		};

		setInterval(async () => {
			if (this.processing) return;
			this.processing = true;

			qs.from = 0;

			while (this.processing) {
				const { users } = await summatia.matrix.doRequest("GET", "/_synapse/admin/v2/users", qs) as SynapseUserList;
				console.log(users);
				for (const user of users) {
					if ((user as any).creation_ts as number < this.lastUpdate) {
						this.processing = false;
						break;
					}
				}
			}
		}, 10000);
	}

}