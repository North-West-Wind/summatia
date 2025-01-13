import "dotenv/config";
import { Summatia } from "./summatia";
import AiModule from "./modules/ai";
import LargeMediaModule from "./modules/large-media";
import ListenCommand from "./modules/commands/listen";
import UnlistenCommand from "./modules/commands/unlisten";
import { LinkModerationModule } from "./modules/moderation/link";

(async () => {
	const summatia = new Summatia(process.env.MATRIX_DISABLED == "1", process.env.DISCORD_DISABLED == "1");
	
	// add modules
	//summatia.addModule(new AiModule());
	summatia.addModule(new LargeMediaModule());
	// command modules
	//summatia.addModule(new ListenCommand());
	//summatia.addModule(new UnlistenCommand());
	// moderation modules
	summatia.addModule(new LinkModerationModule());
	
	await summatia.refreshDiscordCommands();
	await summatia.waitDatabase();
	
	summatia.setup();
	summatia.start();
})();