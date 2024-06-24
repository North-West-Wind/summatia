import { MatrixClient } from "matrix-bot-sdk";
import { SummatiaListeners, SummatiaModule } from ".";
import { MediaEventContent } from "matrix-js-sdk/lib/types";
import { RoomMessageEvent } from "../types/events";

if (!process.env.MATRIX_BRIDGE_BOT) throw new Error("bridge bot id not set");

export default class LargeMediaModule extends SummatiaModule {
	lastMxc: { [roomId: string]: { sender: string, url: string } };

	constructor() {
		super({ listen: [SummatiaListeners.MESSAGE] });
		this.lastMxc = {};
	}

	async onMessage(client: MatrixClient, roomId: string, event: RoomMessageEvent) {
		if (event.content?.msgtype === 'm.notice' && event.content.body.includes("Attachment is too large")) console.log("bridge bot say too large", roomId);
		if (event.content?.msgtype === 'm.notice' && event.sender === process.env.MATRIX_BRIDGE_BOT && event.content.body.includes("Attachment is too large") && this.lastMxc[roomId]) {
			
			const msg = `${this.lastMxc[roomId].sender} sent an attachment too large for Discord!\n${process.env.MATRIX_HOMESERVER}/_matrix/media/r0/download/${this.lastMxc[roomId].url.slice(6)}`;
			await client.sendText(roomId, msg);
			delete this.lastMxc[roomId];
		} else if (event.content?.msgtype !== 'm.text' && (event.content as MediaEventContent).url) {
			console.log("received non-text in room", roomId);
			this.lastMxc[roomId] = {
				sender: event.sender,
				url: (event.content as MediaEventContent).url!
			}
		}
	}
}