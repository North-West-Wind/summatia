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
		const space = Array(Logger.maxLength - (this.prefix?.length || -2) + 3).fill(" ").join("");
		const log = logger.bgColor(this.color);
		if (this.prefix) log.append(`[${this.prefix}]`);
		log.reset().append(space);
		log.append(message, ...args);
		log.log();
	}

	error(message?: string, error?: any) {
		const space = Array(Logger.maxLength - (this.prefix?.length || -2) + 3).fill(" ").join("");
		const log = logger.bgColor(this.color);
		if (message) {
			if (this.prefix) log.append(`[${this.prefix}]`);
			log.color("red").append(space, message);
			log.log();
		}
		if (error) console.error(error);
	}
}