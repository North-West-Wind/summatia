import "dotenv/config";

import { BridgeCommand } from "./modules/commands/bridge";
import { HelpCommand } from "./modules/commands/help";
import { JitsiCommand } from "./modules/commands/jitsi";
import { RssCommand } from "./modules/commands/rss";
import { Splatoon3Command } from "./modules/commands/splatoon3";
import LargeMediaModule from "./modules/large-media";
import { InviteModerationModule } from "./modules/moderation/invite";
import { LinkModerationModule } from "./modules/moderation/link";
import { Summatia } from "./summatia";
import { RandomCommand } from "./modules/commands/random";
import { ScamModerationModule } from "./modules/moderation/scam";

(async () => {
	const summatia = new Summatia(":> ", !process.env.MATRIX_DISABLED, !process.env.DISCORD_DISABLED);
	
	// add modules
	//summatia.addModule(new AiModule());
	summatia.addModule(new LargeMediaModule());
	// command modules
	summatia.addModule(new BridgeCommand());
	summatia.addModule(new HelpCommand());
	summatia.addModule(new JitsiCommand());
	//summatia.addModule(new ListenCommand());
	summatia.addModule(new RandomCommand());
	summatia.addModule(new RssCommand());
	summatia.addModule(new Splatoon3Command());
	//summatia.addModule(new UnlistenCommand());
	// moderation modules
	summatia.addModule(new InviteModerationModule());
	summatia.addModule(new LinkModerationModule());
	summatia.addModule(new ScamModerationModule());
	
	await summatia.refreshDiscordCommands();
	await summatia.waitDatabase();
	
	await summatia.setup();
	await summatia.start();
})();