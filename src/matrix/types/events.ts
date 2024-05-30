import { RoomMessageEventContent } from "matrix-js-sdk/lib/types";

export type ClientEvent = {
	content: object;
	event_id: string;
	origin_server_ts: number;
	room_id: string;
	sender: string;
	state_key?: string;
	type: string;
	unsigned?: UnsignedData;
}

export type UnsignedData = {
	age: number;
	prev_content: object;
	redacted_because: ClientEvent;
	transaction_id: string;
}

export type StrippedStateEvent = {
	content: object;
	sender: string;
	state_key: string;
	type: string;
}

export type RoomMessageEvent = ClientEvent & {
	content: RoomMessageEventContent;
}