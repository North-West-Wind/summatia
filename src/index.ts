import "dotenv/config";
import { Summatia } from "./summatia";
import AiModule from "./modules/ai";
import LargeMediaModule from "./modules/large-media";
import ListenCommand from "./modules/commands/listen";
import UnlistenCommand from "./modules/commands/unlisten";
import { LinkModerationModule } from "./modules/moderation/link";
import { HelpCommand } from "./modules/commands/help";
import { RssCommand } from "./modules/commands/rss";
import { JitsiCommand } from "./modules/commands/jitsi";
import { BridgeCommand } from "./modules/commands/bridge";
import { Splatoon3Command } from "./modules/commands/splatoon3";
import { InviteModerationModule } from "./modules/moderation/invite";
import { EmojiCommand } from "./modules/commands/emoji";

(async () => {
	const summatia = new Summatia(":> ", !process.env.MATRIX_DISABLED, !process.env.DISCORD_DISABLED);
	
	// add modules
	//summatia.addModule(new AiModule());
	summatia.addModule(new LargeMediaModule());
	// command modules
	summatia.addModule(new BridgeCommand());
	summatia.addModule(new EmojiCommand());
	summatia.addModule(new HelpCommand());
	summatia.addModule(new JitsiCommand());
	//summatia.addModule(new ListenCommand());
	summatia.addModule(new RssCommand());
	summatia.addModule(new Splatoon3Command());
	//summatia.addModule(new UnlistenCommand());
	// moderation modules
	summatia.addModule(new InviteModerationModule());
	summatia.addModule(new LinkModerationModule());
	
	await summatia.refreshDiscordCommands();
	await summatia.waitDatabase();
	
	await summatia.setup();
	await summatia.start();
})();