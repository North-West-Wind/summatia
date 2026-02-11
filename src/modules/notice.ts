import { SynapseUserList } from "matrix-bot-sdk";
import { Startup, SummatiaListeners, SummatiaModule } from ".";
import Logger from "../helpers/logger";
import { Summatia } from "../summatia";

export class NoticeModule extends SummatiaModule implements Startup {
	readonly message: string;
	lastUpdate = Date.now();
	processing = false;

	constructor() {
		super("notice", { listen: [SummatiaListeners.START] });

		let message = "Hello there! Welcome to NorthWestWind's Matrix instance!\n";
		message += "I'm Summatia :> This is an automated account and I'm here to deliver you a notice.\n\n";

		message += "You are on `matrix.northwestw.in`. Hopefully you are aware of that. ";
		message += "This is an instance run by NorthWestWind (@northwestwind:matrix.northwestw.in). ";
		message += "Message him to say hi! And tell him you saw this message!\n\n";

		message += "Please be aware that this instance is not the stablest of all. ";
		message += "Sometimes NorthWestWind may mess around with stuff on the server and crash it accidentally. ";
		message += "Storage is limited so use it sparingly. ";
		message += "There isn't a hard limit set, but old files may be purged if we run out of space. ";
		message += "There is also no backup of files. ";
		message += "The point is, don't store anything important here.\n\n";

		message += "Keep that in mind. I hope you have a great time here! :>";

		this.message = message;
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
				for (const user of users) {
					if ((user as any).creation_ts as number < this.lastUpdate) {
						this.processing = false;
						break;
					} else {
						Logger.module.log(`New user ${user.name} joined the instance!`);
						const roomId = await summatia.matrix.createRoom({ invite: [user.name], is_direct: true, name: "Welcome!" });
						await summatia.matrix.sendText(roomId, this.message);
					}
				}
			}
			this.lastUpdate = Date.now();
		}, 60000);
	}

}