import { EncryptedFile } from "matrix-bot-sdk";

export function imageMessageContent(mxc: string, name: string, info: { w?: number, h?: number, mimetype?: string, size?: number } = {}, encryptedFile?: Omit<EncryptedFile, "url">) {
	return {
		msgtype: "m.image",
		body: name,
		info,
		file: {
			url: mxc,
			...encryptedFile
		}
	}
}