import { MatrixClient } from "matrix-bot-sdk";
import { Helpful, MatrixHandler, SummatiaListeners, SummatiaModule } from ".";
import { MediaEventContent } from "matrix-js-sdk/lib/types";
import { RoomMessageEvent } from "../types/events";
import { Summatia } from "../summatia";

if (!process.env.MATRIX_BRIDGE_BOT) throw new Error("bridge bot id not set");

export default class LargeMediaModule extends SummatiaModule implements MatrixHandler, Helpful {
	lastMxc: { [roomId: string]: { sender: string, url: string } };

	constructor() {
		super("large-media", { listen: [SummatiaListeners.MATRIX_MESSAGE, SummatiaListeners.HELP, SummatiaListeners.HELP_MATRIX] });
		this.lastMxc = {};
	}

	description() {
		return "Automatically attach links for files too large for Discord but not Matrix."
	}

	examples() {
		return [];
	}

	async onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {
		if (event.content?.msgtype === 'm.notice' && event.sender === process.env.MATRIX_BRIDGE_BOT && event.content.body.includes("Attachment is too large") && this.lastMxc[roomId]) {
			let rest = ` sent an attachment too large for Discord!\n${process.env.MATRIX_HOMESERVER}/_matrix/media/r0/download/${this.lastMxc[roomId].url.slice(6)}`;
			await summatia.matrix.sendEvent(roomId, "m.room.message", {
				body: this.lastMxc[roomId].sender + rest,
				msgtype: "m.text",
				format: "org.matrix.custom.html",
				formatted_body: (await this.mentionUser(summatia.matrix, this.lastMxc[roomId].sender)) + rest
			});
			delete this.lastMxc[roomId];
		} else if (event.content?.msgtype !== 'm.text' && (event.content as MediaEventContent).url)
			this.lastMxc[roomId] = {
				sender: event.sender,
				url: (event.content as MediaEventContent).url!
			}
	}

	private async mentionUser(client: MatrixClient, userId: string) {
		try {
			if (userId) {
				const profile = await client.getUserProfile(userId);
				if (profile)
					return `<a href="https://matrix.to/#/${encodeURIComponent(userId)}">@${profile.displayname}</a>`;
			}
		} catch (err) {
			console.error(err);
		}
		return "Somebody";
	}
}