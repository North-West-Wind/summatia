import { SlashCommandBuilder, ChatInputCommandInteraction, ChannelType, GuildChannel } from "discord.js";
import { RoomMessageEvent } from "../../matrix/types/events";
import { Summatia } from "../../summatia";
import { SummatiaCommandHelpModule } from "../commands";

export class BridgeCommand extends SummatiaCommandHelpModule {
	constructor() {
		super("bridge");
	}

	description() {
		return "Matrix-Discord bridge information."
	}

	examples() {
		return ["bridge"];
	}

	getSlashCommandBuilder() {
		return new SlashCommandBuilder().setName(this.name).setDescription(this.description());
	}

	async onDiscordCommandInteraction(summatia: Summatia, interaction: ChatInputCommandInteraction) {
		const roomId = await summatia.database.providers.bridge.getChannelRoom(interaction.channelId);
		if (roomId === undefined) await interaction.reply("No bridge information available.");
		else if (!roomId) await interaction.reply("This channel is not bridged.");
		else {
			let channelPart = interaction.channelId;
			if (interaction.channel instanceof GuildChannel) channelPart += ` (${interaction.channel.name})`;
			let roomPart = roomId;
			try {
				const events = await summatia.matrix.getRoomState(roomId);
				for (let ii = events.length - 1; ii >= 0; ii--)
					if (events[ii].type === "m.room.name") roomPart += ` (${events[ii].content.name})`;
			} catch (err) { }
			await interaction.reply(`${channelPart} <-> ${roomPart}`);
		}
	}

	async onMatrixMessage(summatia: Summatia, roomId: string, event: RoomMessageEvent) {
		if (event.content.msgtype != "m.text" || !event.content.body.startsWith(summatia.prefix + this.name)) return;
		const channelId = await summatia.database.providers.bridge.getRoomChannel(roomId);
		if (channelId === undefined) await summatia.matrix.replyText(roomId, event.event_id, "No bridge information available.");
		else if (!channelId) await summatia.matrix.replyText(roomId, event.event_id, "This room is not bridged.");
		else {
			let roomPart = roomId;
			const events = await summatia.matrix.getRoomState(roomId);
			for (let ii = events.length - 1; ii >= 0; ii--)
				if (events[ii].type === "m.room.name") roomPart += ` (${events[ii].content.name})`;
			let channelPart = channelId;
			try {
				const channel = await summatia.discord.channels.fetch(channelId);
				if (channel instanceof GuildChannel) channelPart += ` (${channel.name})`;
			} catch (err) { }
			await summatia.matrix.replyText(roomId, event.event_id, `${roomPart} <-> ${channelPart}`);
		}
	}
	
}