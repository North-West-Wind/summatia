import "dotenv/config";

if (process.env.DISCORD_ENABLED == "1") import("./discord");
if (process.env.MATRIX_ENABLED == "1") import("./matrix");

const internal = {
	discordId: ""
};
export function discordId(id?: string) {
	if (id !== undefined) internal.discordId = id;
	return internal.discordId;
}
