import { GuildMember, Snowflake } from "discord.js";
import { Summatia } from "../../summatia";
import { DiscordGuildMemberHandler, Startup, SummatiaListeners, SummatiaModule } from "..";

const TRACK_WINDOW = 12 * 60 * 60 * 1000; // 12 hours in ms
const FACTOR = 0.1;

export class InviteModerationModule extends SummatiaModule implements DiscordGuildMemberHandler, Startup {
	invites: Map<Snowflake, number>;
	tracking: Map<Snowflake, number>;

	constructor() {
		super("invite-mod", { listen: [SummatiaListeners.START] });
		this.invites = new Map();
		this.tracking = new Map();
	}

	async start(summatia: Summatia) {
		for (const guild of (await summatia.discord.guilds.fetch()).values()) {
			const invites = await (await guild.fetch()).invites.fetch();
			const uses = invites.map(invite => invite.uses || 0).reduce((a, b) => a + b);
			this.invites.set(guild.id, uses);
		}
	}

	async onGuildMemberAdd(summatia: Summatia, member: GuildMember) {
		const trackedUses = (this.tracking.get(member.guild.id) || 0) + 1;
		this.tracking.set(member.guild.id, trackedUses);
		setTimeout(() => this.tracking.set(member.guild.id, (this.tracking.get(member.guild.id) || 1) - 1), TRACK_WINDOW);
		const totalUses = this.invites.get(member.guild.id) || 0;

		if (trackedUses >= totalUses * FACTOR) {
			await member.guild.disableInvites();
			const invites = await member.guild.invites.fetch();
			for (const invite of invites.values())
				await invite.inviter?.send(`Detected a potential raid for ${member.guild.name}. I've disabled invites for now.`);
		}

		this.invites.set(member.guild.id, totalUses + 1);

	}
	onGuildMemberRemove() { }
	onGuildMemberUpdate() { }
}