import chalk from "chalk";

const colorLogs = {
	black: chalk.black,
	blue: chalk.blue,
	cyan: chalk.cyan,
	gray: chalk.gray,
	green: chalk.green,
	magenta: chalk.magenta,
	red: chalk.red,
	white: chalk.white,
	yellow: chalk.yellow
};

type BgColor = keyof typeof colorLogs;

export default class Logger {
	static system = new Logger();
	static module = new Logger("Module", "green");
	static discord = new Logger("Discord", "cyan");
	static matrix = new Logger("Matrix", "cyan");
	static db = new Logger("DB", "green");

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
		const pre = this.prefix ? colorLogs[this.color](`[${this.prefix}]`) : "";
		console.log(`${space}${pre} ${message}`, ...args);
	}

	error(message?: string, error?: any) {
		const space = Array(Logger.maxLength - (this.prefix?.length || -2) + 2).fill(" ").join("");
		const pre = this.prefix ? colorLogs[this.color](`[${this.prefix}]`) : "";
		if (message) console.error(`${space}${pre} ${chalk.red(message)}`);
		if (error) console.error(error);
	}
}