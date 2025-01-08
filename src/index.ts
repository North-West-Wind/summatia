import "dotenv/config";
import { Summatia } from "./summatia";

const summatia = new Summatia(process.env.MATRIX_ENABLED == "1", process.env.DISCORD_ENABLED == "1");

summatia.setup();
summatia.start();