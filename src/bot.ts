import { Message } from "discord.js";
import fetch from "node-fetch";

export async function chat(name: string, platform: string, message: Message, noResponse: boolean) {
	let sendObj = {
		name,
		platform,
		noResponse
	};
	if (message.content) sendObj = Object.assign(sendObj, { message: message.content });
	if (message.attachments.size) {
		const images: string[] = [];
		for (const attachment of message.attachments.values()) {
			if (!attachment.contentType?.startsWith("image/")) continue;
			try {
				const res = await fetch(attachment.proxyURL);
				if (res.ok) images.push((await res.buffer()).toString("base64"));
			} catch (err) { }
		}
		sendObj = Object.assign(sendObj, { images });
	}
	const res = await fetch(process.env.OLLAMA_MEMORY_HOST! + "/chat/summatia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sendObj) });
	const json = await res.json();
	if (json.error) return false;
	else return noResponse ? true : json.message.content;
}