/**
 * Channels: where conversation happens, and the id every message tool needs.
 */

import {
	boundedLimit,
	cleanText,
	indented,
	list,
	ok,
	offsetOf,
	optionalBoolean,
	optionalString,
	optionalStringArray,
	record,
	timeLine,
	toIST,
} from "../render.js";
import type {
	Channel,
	ChannelParticipant,
	ChannelScopeType,
	ChannelUserStatus,
	ChannelVisibility,
} from "@xyne/spaces-sdk";
import type { Related } from "../render.js";
import { first } from "../render.js";
import type { ToolDef } from "./shared.js";
import { users } from "./shared.js";

/**
 * `userVisibleChannelsV3` joins the channel, and the channel joins
 * `channel_stats`. The SDK types columns only, so the joins are declared here
 * and only the joins — every column stays checked against the Zero schema.
 */
type ChannelRow = Channel & {
	participantCount?: number;
	channelStats?: Related<Record<string, unknown>>;
};

type ChannelStatusRow = ChannelUserStatus & { channel?: Related<ChannelRow> };

function renderChannel(status: ChannelStatusRow, index: number): string | undefined {
	const channel = first(status.channel);
	if (!channel?.id) return undefined;

	const flags = [channel.isArchived ? "archived" : "", status.isStarred ? "starred" : ""].filter(Boolean);
	const title =
		`#${channel.name ?? "(unnamed)"} (id: ${channel.id})` +
		` (${channel.scopeType ?? "?"}, ${channel.visibility ?? "?"}${channel.type && channel.type !== "DEFAULT" ? `, ${channel.type}` : ""})` +
		(flags.length > 0 ? ` [${flags.join(", ")}]` : "");

	const lines: string[] = [];
	if (channel.description) lines.push(indented(cleanText(channel.description)));

	const stat: string[] = [];
	// From `channel_stats`, not `Channel.participantCount` — the scalar on the
	// channel is unmaintained and reads 0 for every row. The stats row is joined
	// by the query already, so this costs nothing.
	const stats = first(channel.channelStats);
	const memberCount = typeof stats?.["participantCount"] === "number" ? (stats["participantCount"] as number) : undefined;
	if (memberCount !== undefined) stat.push(`${memberCount} members`);
	if (typeof status.unreadCount === "number" && status.unreadCount > 0) stat.push(`${status.unreadCount} unread`);
	if (channel.addUserPolicy) stat.push(`add-user policy: ${channel.addUserPolicy}`);
	if (stat.length > 0) lines.push(`  ${stat.join(" · ")}`);

	if (channel.createdBy) lines.push(`  Created by: ${users.label(channel.createdBy)}`);
	if (channel.projectId) lines.push(`  Project ID: ${channel.projectId}`);
	if (status.selectedBoardId) lines.push(`  Selected board ID: ${status.selectedBoardId}`);

	const times = timeLine([
		["Created", channel.createdAt],
		["Updated", channel.updatedAt],
		["Last active", channel.lastActivityAt],
		["Last viewed by you", status.lastViewedAt],
	]);
	if (times) lines.push(`  ${times}`);

	lines.push(`  Channel ID: ${channel.id}`);
	return record(index, title, lines);
}

const channelsList: ToolDef = {
	name: "spaces_channels_list",
	description:
		"List the Xyne Spaces channels you can see, with their ids. This is the AUTHORITATIVE way to turn a channel " +
		"NAME into a channel id — it reads the database directly and so works for private channels, unlike " +
		"spaces_search, which is a fuzzy relevance index. Always resolve a channel here and copy the id verbatim " +
		"before posting or creating anything in it; never re-type an id from memory or from earlier prose. " +
		"Returns per channel: name, scope, visibility, description, live member count, your unread count, creator, project " +
		"id, and created / updated / last-active times. Email, Slack, App and Call channels are excluded by default — " +
		"set include_email_channels to include them.",
	inputSchema: {
		type: "object",
		properties: {
			name: {
				type: "string",
				description: "Case-insensitive partial match on the channel name. Use this to find one specific channel.",
			},
			scope_type: {
				type: "string",
				enum: ["DEFAULT", "DM", "TICKET", "DOCUMENT", "GROUP_DM"],
				description: "Restrict to one scope. Use 'DM' to find direct messages.",
			},
			visibility: { type: "string", enum: ["PUBLIC", "PRIVATE"], description: "Restrict to public or private channels." },
			project_id: { type: "string", description: "Restrict to channels in this project." },
			unread_only: { type: "boolean", description: "Only channels with unread messages." },
			starred_only: { type: "boolean", description: "Only channels you have starred." },
			include_email_channels: {
				type: "boolean",
				description: "Also include Email, Slack, App and Call channels, which are left out by default.",
			},
			limit: { type: "number", minimum: 1, maximum: 200, default: 50, description: "Max channels (default 50, max 200)." },
			offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset." },
		},
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		await users.prime(sdk);
		const limit = boundedLimit(args, 50, 200);
		const offset = offsetOf(args);

		const rows = (await sdk.channels.list()) as ChannelStatusRow[];
		if (optionalBoolean(args, "include_email_channels") === true) {
			rows.push(...((await sdk.channels.listEmail()) as ChannelStatusRow[]));
		}

		const nameFilter = optionalString(args, "name")?.toLowerCase();
		const scopeType = optionalString(args, "scope_type");
		const visibility = optionalString(args, "visibility");
		const projectId = optionalString(args, "project_id");
		const unreadOnly = optionalBoolean(args, "unread_only") === true;
		const starredOnly = optionalBoolean(args, "starred_only") === true;

		const matched = rows.filter((row) => {
			const channel = first(row.channel);
			if (!channel?.id) return false;
			if (nameFilter && !(channel.name ?? "").toLowerCase().includes(nameFilter)) return false;
			if (scopeType && channel.scopeType !== scopeType) return false;
			if (visibility && channel.visibility !== visibility) return false;
			if (projectId && channel.projectId !== projectId) return false;
			if (unreadOnly && !(row.unreadCount && row.unreadCount > 0)) return false;
			if (starredOnly && row.isStarred !== true) return false;
			return true;
		});

		// Most recently active first: an agent asking "what channels are there"
		// almost always wants the live ones at the top.
		matched.sort((a, b) => (first(b.channel)?.lastActivityAt ?? 0) - (first(a.channel)?.lastActivityAt ?? 0));

		const page = matched.slice(offset, offset + limit);
		const rendered = page.map((row, i) => renderChannel(row, offset + i + 1)).filter((v): v is string => v !== undefined);
		return list("channel(s)", rendered, { returned: rendered.length, limit, offset, total: matched.length });
	},
};

// ── spaces_channel_participants ─────────────────────────────────────────────

type ParticipantRow = ChannelParticipant;

const channelParticipants: ToolDef = {
	name: "spaces_channel_participants",
	description:
		"List the members of one Xyne Spaces channel, with each person's user id, name, email, channel role " +
		"(ADMIN or MEMBER) and when they joined. Use it to find out who to mention or assign work to, or to check " +
		"whether someone is in a channel before posting there. A busy channel can have hundreds of members, so page " +
		"with limit and offset.",
	inputSchema: {
		type: "object",
		properties: {
			channel_id: { type: "string", description: "Channel id, from spaces_channels_list or spaces_search." },
			role: { type: "string", enum: ["ADMIN", "MEMBER"], description: "Restrict to one channel role." },
			name: { type: "string", description: "Case-insensitive partial match on member name or email." },
			limit: { type: "number", minimum: 1, maximum: 500, default: 100, description: "Max members (default 100, max 500)." },
			offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset." },
		},
		required: ["channel_id"],
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		await users.prime(sdk);
		const channelId = String(args["channel_id"] ?? "").trim();
		if (!channelId) throw new Error("Missing required parameter: channel_id");
		const limit = boundedLimit(args, 100, 500);
		const offset = offsetOf(args);

		const rows: ParticipantRow[] = await sdk.channels.listParticipants(channelId);
		const role = optionalString(args, "role");
		const nameFilter = optionalString(args, "name")?.toLowerCase();

		const matched = rows.filter((row) => {
			if (role && row.role !== role) return false;
			if (nameFilter) {
				const label = users.label(row.userId).toLowerCase();
				if (!label.includes(nameFilter)) return false;
			}
			return true;
		});

		const rendered = matched.slice(offset, offset + limit).map((row, i) => {
			const lines: string[] = [];
			if (row.joinedAt) lines.push(`  Joined: ${toIST(row.joinedAt)} IST`);
			if (row.id) lines.push(`  Participant row ID: ${row.id}`);
			return record(offset + i + 1, `${users.label(row.userId)} — ${row.role ?? "MEMBER"}`, lines);
		});

		return list("member(s)", rendered, { returned: rendered.length, limit, offset, total: matched.length });
	},
};

// ── spaces_channel_create ───────────────────────────────────────────────────

const channelCreate: ToolDef = {
	name: "spaces_channel_create",
	description:
		"Create a Xyne Spaces channel. Needs a project id — get one from spaces_projects_list. Creating a channel " +
		"allocates several server-owned rows (stats, your own membership, the default section placement), so this goes " +
		"through the product's own create path rather than a raw insert. Returns the new channel id, which you can pass " +
		"straight to spaces_thread_create. Check the name is free first with spaces_channels_list. " +
		"To open a direct message with one person, set scope_type to 'DM' and dm_user to their email or user id; " +
		"name is not required for a DM. Look first — spaces_channels_list with scope_type='DM' will show a DM that " +
		"already exists, and opening a second one is not what you want.",
	inputSchema: {
		type: "object",
		properties: {
			name: { type: "string", description: "Channel name, without a leading '#'. Required unless scope_type is 'DM'." },
			project_id: { type: "string", description: "Project the channel belongs to, from spaces_projects_list." },
			description: { type: "string", description: "Channel description or topic." },
			visibility: {
				type: "string",
				enum: ["PUBLIC", "PRIVATE"],
				default: "PUBLIC",
				description: "PUBLIC channels are discoverable by anyone in the workspace; PRIVATE ones are invite-only.",
			},
			scope_type: {
				type: "string",
				enum: ["DEFAULT", "DM", "TICKET", "DOCUMENT", "GROUP_DM"],
				default: "DEFAULT",
				description: "Almost always DEFAULT. 'DM' opens a direct message and needs dm_user. The rest back specific product surfaces.",
			},
			dm_user: {
				type: "string",
				description: "Only for scope_type 'DM': the other person, as an email address or user id.",
			},
			participants: {
				type: "array",
				items: { type: "string" },
				description: "User ids or email addresses to add as members. Emails are resolved to user ids.",
			},
		},
		required: ["project_id"],
		additionalProperties: false,
	},
	write: true,
	async handler(args, { sdk }) {
		const projectId = String(args["project_id"] ?? "").trim();
		if (!projectId) throw new Error("Missing required parameter: project_id");
		const scopeType = optionalString(args, "scope_type") ?? "DEFAULT";
		const name = optionalString(args, "name");
		if (scopeType !== "DM" && !name) throw new Error("Missing required parameter: name (required unless scope_type is 'DM')");

		// `scopeId` is not a new row id. For a DM it is the *other participant's*
		// user id, which is how the server pairs the two people; it is not stored
		// on the channel. Sending a generated value would create a DM anchored to
		// nobody, so it is only ever sent for a DM.
		let scopeId: string | undefined;
		if (scopeType === "DM") {
			const requested = optionalString(args, "dm_user");
			if (!requested) throw new Error("scope_type 'DM' needs dm_user — the other person's email or user id.");
			scopeId = await users.toUserId(sdk, requested);
			if (!scopeId) throw new Error(`No Spaces user matches "${requested}".`);
		}

		const requested = optionalStringArray(args, "participants") ?? [];
		const participants: string[] = [];
		const unresolved: string[] = [];
		for (const value of requested) {
			const id = await users.toUserId(sdk, value);
			if (id) participants.push(id);
			else unresolved.push(value);
		}

		// The registry already normalises `channelId ?? id` in its mapResult.
		const created = await sdk.channels.create({
			projectId,
			scopeType: scopeType as ChannelScopeType,
			...(name ? { name } : {}),
			...(scopeId ? { scopeId } : {}),
			visibility: (optionalString(args, "visibility") ?? "PUBLIC") as ChannelVisibility,
			...(optionalString(args, "description") ? { description: optionalString(args, "description")! } : {}),
			...(participants.length > 0 ? { participants } : {}),
		});

		const channelId = created.id;
		const note = unresolved.length > 0 ? `\n\nNot added — no user matched: ${unresolved.join(", ")}` : "";
		const label = name ? `#${name}` : "the direct message";
		return ok(`Created ${label}.\n  Channel ID: ${channelId}\n  Members added: ${participants.length}${note}`);
	},
};

export const channelTools: ToolDef[] = [channelsList, channelParticipants, channelCreate];
