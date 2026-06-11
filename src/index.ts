import "dotenv/config";

import { BridgeCommand } from "./modules/commands/bridge";
import { HelpCommand } from "./modules/commands/help";
import { JitsiCommand } from "./modules/commands/jitsi";
import { RssCommand } from "./modules/commands/rss";
import { Splatoon3Command } from "./modules/commands/splatoon3";
import LargeMediaModule from "./modules/large-media";
import { InviteModerationModule } from "./modules/moderation/invite";
import { SpamModerationModule } from "./modules/moderation/spam";
import { Summatia } from "./summatia";
import { RandomCommand } from "./modules/commands/random";
import { ScamModerationModule } from "./modules/moderation/scam";
import { NoticeModule } from "./modules/notice";
import { RemoveMessageCommand } from "./modules/commands/rm";

(async () => {
	const summatia = new Summatia(":> ", !process.env.MATRIX_DISABLED, !process.env.DISCORD_DISABLED);
	
	// add modules
	//summatia.addModule(new AiModule());
	summatia.addModule(new LargeMediaModule());
	summatia.addModule(new NoticeModule());
	// command modules
	summatia.addModule(new BridgeCommand());
	summatia.addModule(new HelpCommand());
	summatia.addModule(new JitsiCommand());
	//summatia.addModule(new ListenCommand());
	summatia.addModule(new RandomCommand());
	summatia.addModule(new RemoveMessageCommand());
	summatia.addModule(new RssCommand());
	summatia.addModule(new Splatoon3Command());
	//summatia.addModule(new UnlistenCommand());
	// moderation modules
	summatia.addModule(new InviteModerationModule());
	summatia.addModule(new ScamModerationModule());
	summatia.addModule(new SpamModerationModule());
	
	await summatia.refreshDiscordCommands();
	await summatia.waitDatabase();
	
	await summatia.setup();
	await summatia.start();
})();