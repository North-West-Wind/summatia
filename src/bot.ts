export async function chat(name: string, platform: string, message: string, noResponse: boolean) {
	const res = await fetch(process.env.OLLAMA_MEMORY_HOST! + "/chat/summatia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
		name,
		platform,
		message,
		noResponse
	}) });
	const json = await res.json();
	if (json.error) return false;
	else return noResponse ? true : json.message.content;
}