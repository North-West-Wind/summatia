import "dotenv/config";
import { Summatia } from "./summatia";
import AiModule from "./modules/ai";
import LargeMediaModule from "./modules/large-media";
import ListenCommand from "./modules/commands/listen";
import UnlistenCommand from "./modules/commands/unlisten";

const summatia = new Summatia(process.env.MATRIX_ENABLED == "1", process.env.DISCORD_ENABLED == "1");

// add modules
summatia.addModule(new AiModule());
summatia.addModule(new LargeMediaModule());
summatia.addModule(new ListenCommand());
summatia.addModule(new UnlistenCommand());

summatia.setup();
summatia.start();