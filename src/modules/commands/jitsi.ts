import { RoomMessageEvent } from "../../types/events";
import { Summatia } from "../../summatia";
import { SummatiaMatrixCommandHelpModule } from "../commands";

export class JitsiCommand extends SummatiaMatrixCommandHelpModule {
	constructor() {
		super("jitsi");
	}

	description() {
		return "Jitsi room link!";
	}

	examples() {
		return ["jitsi"];
	}

	async onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {
		if (event.content.msgtype != "m.text" || !event.content.body.startsWith(summatia.prefix + this.name)) return;
		const events = await summatia.matrix.getRoomState(roomId);
		let ev: any;
		for (let ii = events.length - 1; ii >= 0; ii--) {
			const event = events[ii];
			if (event.type == "im.vector.modular.widgets" && event.content.type == "jitsi") {
				ev = event;
				break;
			}
		}
		if (!ev) await summatia.matrix.sendText(roomId, "This room doesn't have Jitsi!");
		else await summatia.matrix.sendText(roomId, `https://${ev.content.data.domain}/${ev.content.data.conferenceId}`);
	}
}