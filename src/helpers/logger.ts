export default class Logger {
	static system = new Logger();
	static module = new Logger("Module");
	static discord = new Logger("Discord");
	static matrix = new Logger("Matrix");
	static db = new Logger("DB");
	static rest = new Logger("REST");

	private readonly prefix?: string;

	constructor(prefix?: string) {
		this.prefix = prefix;
	}

	log(message: string, ...args: any[]) {
		if (this.prefix) console.log(`[${this.prefix}] ${message}`, ...args);
		else console.log(message, ...args);
	}

	error(message?: string, error?: any) {
		if (message) {
			if (this.prefix) console.error(`[${this.prefix}] ${message}`);
			else console.error(message);
		}
		if (error) console.error(error);
	}
}