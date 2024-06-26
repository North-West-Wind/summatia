import { Message } from "discord.js";
import fetch from "node-fetch";

export async function isOnline() {
	const res = await fetch(process.env.OLLAMA_MEMORY_HOST! + "/check");
	return res.ok;
}

export async function chatDiscord(name: string, platform: string, message: Message, noResponse: boolean) {
	let msg: string | undefined, reply: string | undefined;
	let imgs: string[] | undefined;
	if (message.content) msg = message.cleanContent;
	if (message.reference) {
		const ref = await message.fetchReference();
		if (ref.content) reply = ref.cleanContent;
	}
	if (message.attachments.size) {
		const images: string[] = [];
		for (const attachment of message.attachments.values()) {
			if (!attachment.contentType?.startsWith("image/")) continue;
			try {
				const res = await fetch(attachment.proxyURL);
				if (res.ok) images.push((await res.buffer()).toString("base64"));
			} catch (err) { }
		}
		imgs = images;
	}
	return await chat(name, platform, { message: msg!, images: imgs!, reply }, noResponse);
}

export async function chat(name: string, platform: string, content: ({ message: string, images?: string[] } | { message?: string, images: string[] }) & { reply?: string }, noResponse: boolean) {
	let sendObj: { name: string, platform: string, noResponse: boolean, message?: string, reply?: string, images?: string[] } = {
		name,
		platform,
		noResponse
	};
	if (content.message) sendObj.message = content.message;
	if (content.images) sendObj.images = content.images;
	try {
		const res = await fetch(process.env.OLLAMA_MEMORY_HOST! + "/chat/summatia", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(sendObj),
			signal: AbortSignal.timeout(1800_000) // 30 minute timeout
		});
		const json = await res.json();
		if (json.error) return false;
		else return noResponse ? true : json.message.content;
	} catch (err) {
		return false;
	}
}