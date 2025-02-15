import logger from "node-color-log";

const func = logger.bgColor;

type BgColor = Parameters<typeof logger.bgColor>[0];

export default class Logger {
	static system = new Logger();
	static module = new Logger("Module", "green");
	static discord = new Logger("Discord", "cyan");
	static matrix = new Logger("Matrix", "cyan");
	static db = new Logger("DB", "green");
	static rest = new Logger("REST", "green");

	private static maxLength = 0;
	private readonly prefix?: string;
	private readonly color: BgColor;

	constructor(prefix?: string, color: BgColor = "blue") {
		this.prefix = prefix;
		this.color = color;
		Logger.maxLength = Math.max(prefix?.length || 0, Logger.maxLength);
	}

	log(message: string, ...args: any[]) {
		const space = Array(Logger.maxLength - (this.prefix?.length || -2) + 2).fill(" ").join("");
		const log = logger.append(space).color(this.color);
		if (this.prefix) log.append(`[${this.prefix}]`);
		log.reset().append(" ");
		log.append(message, ...args);
		log.setLevel("info");
		log.log();
	}

	error(message?: string, error?: any) {
		const space = Array(Logger.maxLength - (this.prefix?.length || -2) + 2).fill(" ").join("");
		const log = logger.append(space).color(this.color);
		if (message) {
			if (this.prefix) log.append(`[${this.prefix}]`);
			log.color("red").append(" ", message);
			log.setLevel("error");
			log.log();
		}
		if (error) console.error(error);
	}
}