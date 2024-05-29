import { MatrixClient } from "matrix-bot-sdk";

export async function getRoomParents(client: MatrixClient, roomId: string) {
	const states = await client.getRoomState(roomId);
	let names: string[] = [];
	let name = states.filter(state => state.type == "m.room.name").pop()?.content.name || "";
	const parentState = states.filter(state => state.type == "m.space.parent").pop();
	if (parentState) names = await getRoomParents(client, parentState.state_key);
	names.unshift(name);
	return names;
}