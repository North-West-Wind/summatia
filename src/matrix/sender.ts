import { EncryptedFile } from "matrix-bot-sdk";
import { MsgType } from "matrix-js-sdk";

export function imageMessageContent(mxc: string, name: string, info: { w?: number, h?: number, mimetype?: string, size?: number } = {}, encryptedFile?: Omit<EncryptedFile, "url">) {
	return {
		msgtype: MsgType.Image,
		body: name,
		info,
		file: {
			url: mxc,
			...encryptedFile
		}
	}
}