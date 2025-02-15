import "dotenv/config";

import { MatrixAuth } from "matrix-bot-sdk";

import Logger from "../logger";

if (!process.env.MATRIX_HOMESERVER) throw new Error("homeserver not set");
if (!process.env.MATRIX_USERNAME) throw new Error("username not set");
if (!process.env.MATRIX_PASSWORD) throw new Error("password not set");

const auth = new MatrixAuth(process.env.MATRIX_HOMESERVER);
(async () => {
	const client = await auth.passwordLogin(process.env.MATRIX_USERNAME!, process.env.MATRIX_PASSWORD!, process.env.MATRIX_DEVICE || "summatia-bot");
	Logger.matrix.log(client.accessToken);
})();