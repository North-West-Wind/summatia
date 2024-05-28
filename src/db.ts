import { Snowflake } from "discord.js";
import { verbose } from "sqlite3";

let ready = false;

const sqlite3 = verbose();
const db = new sqlite3.Database("listen.db");
db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='listen'", (err, row) => {
	if (err) console.error(err);
	if (!row) db.run("CREATE TABLE listen (channel varchar(32) NOT NULL PRIMARY KEY, chance INTEGER NOT NULL)", (err) => {
		if (err) console.error(err);
		else ready = true;
	});
	else ready = true;
});

export function addListen(channel: Snowflake, chance: number) {
	return new Promise<void>((res, rej) => {
		db.get("SELECT channel FROM listen WHERE channel = ?", [channel], (err, row?: { channel: string }) => {
			if (err) return rej(err);
			if (!row)	db.run("INSERT INTO listen VALUES (?, ?)", [channel, chance], err => {
				if (err) rej(err);
				else res();
			});
			else db.run("UPDATE listen SET chance = ? WHERE channel = ?", [chance, channel], err => {
				if (err) rej(err);
				else res();
			});
		});
	});
}

export function removeListen(channel: Snowflake) {
	return new Promise<void>((res, rej) => {
		db.run("DELETE FROM listen WHERE channel = ?", [channel], err => {
			if (err) rej(err);
			else res();
		});
	});
}

export function shouldListen(channel: Snowflake) {
	return new Promise<number>((res, rej) => {
		db.get("SELECT chance FROM listen WHERE channel = ?", [channel], (err, row?: { chance: number }) => {
			if (err) return rej(err);
			if (!row)	res(-1);
			else res(row.chance);
		});
	});
}