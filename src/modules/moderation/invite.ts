import { GuildMember, Snowflake } from "discord.js";
import { Summatia } from "../../summatia";
import { DiscordGuildMemberHandler, Startup, SummatiaListeners, SummatiaModule } from "..";

const TRACK_WINDOW = 12 * 60 * 60 * 1000; // 12 hours in ms
const FACTOR = 0.1;

export class InviteModerationModule extends SummatiaModule implements DiscordGuildMemberHandler {
	tracking: Map<Snowflake, number>;

	constructor() {
		super("invite-mod");
		this.tracking = new Map();
	}

	async onGuildMemberAdd(_summatia: Summatia, member: GuildMember) {
		const trackedUses = this.tracking.get(member.guild.id) || 0;
		this.tracking.set(member.guild.id, trackedUses + 1);
		setTimeout(() => this.tracking.set(member.guild.id, (this.tracking.get(member.guild.id) || 1) - 1), TRACK_WINDOW);

		if (trackedUses >= member.guild.memberCount * FACTOR) {
			await member.guild.disableInvites();
			const invites = await member.guild.invites.fetch();
			for (const invite of invites.values())
				await invite.inviter?.send(`Detected a potential raid for ${member.guild.name}. I've disabled invites for now.`);
		}
	}
	onGuildMemberRemove() { }
	onGuildMemberUpdate() { }
}