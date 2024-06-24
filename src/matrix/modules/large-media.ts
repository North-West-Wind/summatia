import { MatrixClient } from "matrix-bot-sdk";
import { SummatiaListeners, SummatiaModule } from ".";
import { MediaEventContent } from "matrix-js-sdk/lib/types";
import { RoomMessageEvent } from "../types/events";

export default class LargeMediaModule extends SummatiaModule {
	lastMxc: { [roomId: string]: { sender: string, url: string } };

	constructor() {
		super({ listen: [SummatiaListeners.MESSAGE] });
		this.lastMxc = {};
	}

	async onMessage(client: MatrixClient, roomId: string, event: RoomMessageEvent) {
		if (event.content?.msgtype === 'm.notice' && event.sender === await client.getUserId() && event.content.body.includes("Attachment is too large") && this.lastMxc[roomId]) {
			const msg = `${this.lastMxc[roomId].sender} sent an attachment too large for Discord!\n${process.env.MATRIX_HOMESERVER}/_matrix/media/r0/download/${this.lastMxc[roomId].url.slice(6)}`;
			await client.sendText(roomId, msg);
			delete this.lastMxc[roomId];
		} else if (event.content?.msgtype !== 'm.text' && (event.content as MediaEventContent).url) this.lastMxc[roomId] = {
			sender: event.sender,
			url: (event.content as MediaEventContent).url!
		}
	}
}