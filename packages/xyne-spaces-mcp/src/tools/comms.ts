/**
 * Notifications, email, calls, drafts and canvases.
 *
 * Read-mostly surfaces around the edge of the product. Each has one paginated
 * catalog query behind it; several of those demand a `limit` and an explicitly
 * null `start`, which the arg builders here supply.
 */

import {
	asRows,
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
	requiredString,
	timeLine,
	toIST,
} from "../render.js";
import type { ToolDef } from "./shared.js";
import { users } from "./shared.js";

function first<T>(value: T | T[] | null | undefined): T | undefined {
	return Array.isArray(value) ? value[0] : (value ?? undefined);
}

// ── spaces_notifications_list ───────────────────────────────────────────────

interface ActivityRow {
	id?: string;
	actorAction?: string;
	actorId?: string;
	classification?: string;
	isRead?: boolean;
	isThreadActivity?: boolean;
	channelId?: string | null;
	conversationId?: string | null;
	messageId?: string | null;
	ticketId?: string | null;
	canvasId?: string | null;
	callId?: string | null;
	createdAt?: number;
	updatedAt?: number;
	message?: { content?: string; conversation?: { channelId?: string } } | Array<Record<string, unknown>> | null;
	ticket?: { xyneId?: string; title?: string } | Array<{ xyneId?: string; title?: string }> | null;
	canvas?: { title?: string } | Array<{ title?: string }> | null;
	call?: { title?: string } | Array<{ title?: string }> | null;
}

const notificationsList: ToolDef = {
	name: "spaces_notifications_list",
	description:
		"List your Xyne Spaces notifications, newest first — mentions, replies, reactions, ticket changes, canvas " +
		"mentions and call invites. Use it to answer 'what needs my attention' or 'what did I miss'. Filter to " +
		"unread_only for a catch-up, or to classification ACTIONABLE for the ones Spaces judged to need a response. " +
		"Each entry names the source and carries the ids to follow it — conversation id for a mention, ticket id for " +
		"a ticket change — so you can go straight to spaces_messages_list or spaces_ticket_get. Mark one done with " +
		"spaces_notifications_mark_read.",
	inputSchema: {
		type: "object",
		properties: {
			unread_only: { type: "boolean", description: "Only unread notifications." },
			classification: {
				type: "array",
				items: { type: "string", enum: ["ACTIONABLE", "FYI", "SKIP", "PENDING", "PROCESSING", "ERROR"] },
				description: "Keep only these Spaces-assigned classifications. ACTIONABLE is the one worth acting on.",
			},
			types: {
				type: "array",
				items: { type: "string" },
				description:
					"Restrict to these action types, e.g. 'mentioned_user', 'group_mention', 'replied', 'added', 'created'.",
			},
			limit: { type: "number", minimum: 1, maximum: 200, default: 30, description: "Max notifications (default 30, max 200)." },
		},
		additionalProperties: false,
	},
	// `start` is `.nullable()` rather than `.optional()`, and `types` is a
	// required array where empty means "no filter" — both must be sent.
	catalog: [{ name: "userActivitiesPaginatedV2", sends: ["limit", "start", "types", "classification", "isRead"] }],
	async handler(args, client) {
		await users.prime(client);
		const limit = boundedLimit(args, 30, 200);
		const unreadOnly = optionalBoolean(args, "unread_only");
		const classification = optionalStringArray(args, "classification");

		const rows = asRows<ActivityRow>(
			await client.catalogQuery("userActivitiesPaginatedV2", {
				limit,
				start: null,
				types: optionalStringArray(args, "types") ?? [],
				...(classification ? { classification } : {}),
				...(unreadOnly === true ? { isRead: false } : {}),
			}),
		);

		const rendered = rows.map((row, i) => {
			const ticket = first(row.ticket);
			const canvas = first(row.canvas);
			const call = first(row.call);
			const message = first(row.message) as { content?: string } | undefined;

			const actor = users.name(row.actorId) ?? users.label(row.actorId);
			const title = `${actor} — ${row.actorAction ?? "activity"}${row.isRead ? "" : " [unread]"}`;
			const lines: string[] = [];

			if (message?.content) lines.push(indented(cleanText(message.content)));
			if (ticket?.xyneId || ticket?.title) lines.push(`  Ticket: [${ticket.xyneId ?? "?"}] ${ticket.title ?? ""}`.trimEnd());
			if (canvas?.title) lines.push(`  Canvas: ${canvas.title}`);
			if (call?.title) lines.push(`  Call: ${call.title}`);

			const detail = [
				row.classification ? `classification: ${row.classification}` : "",
				row.isThreadActivity ? "in a thread" : "",
			].filter(Boolean);
			if (detail.length > 0) lines.push(`  ${detail.join(" · ")}`);

			const times = timeLine([
				["Created", row.createdAt],
				["Updated", row.updatedAt],
			]);
			if (times) lines.push(`  ${times}`);

			if (row.conversationId) lines.push(`  Conversation ID: ${row.conversationId}`);
			if (row.channelId) lines.push(`  Channel ID: ${row.channelId}`);
			if (row.messageId) lines.push(`  Message ID: ${row.messageId}`);
			if (row.ticketId) lines.push(`  Ticket ID: ${row.ticketId}`);
			if (row.canvasId) lines.push(`  Canvas ID: ${row.canvasId}`);
			if (row.callId) lines.push(`  Call ID: ${row.callId}`);
			lines.push(`  Notification ID: ${row.id ?? "(none)"}`);

			return record(i + 1, title, lines);
		});

		return list("notification(s)", rendered, { returned: rendered.length, limit, offset: 0 });
	},
};

const notificationsMarkRead: ToolDef = {
	name: "spaces_notifications_mark_read",
	description:
		"Mark one Xyne Spaces notification as read, by the Notification ID that spaces_notifications_list returns. " +
		"You can only mark your own notifications; the server refuses anyone else's.",
	inputSchema: {
		type: "object",
		properties: {
			notification_id: { type: "string", description: "Notification id, from spaces_notifications_list." },
		},
		required: ["notification_id"],
		additionalProperties: false,
	},
	catalog: [{ name: "activities.markAsRead", sends: ["activityId"] }],
	write: true,
	async handler(args, client) {
		const activityId = requiredString(args, "notification_id");
		await client.catalogMutate("activities.markAsRead", { activityId });
		return ok(`Marked notification ${activityId} as read.`);
	},
};

// ── spaces_emails_list ──────────────────────────────────────────────────────

interface EmailRow {
	id?: string;
	type?: string;
	subject?: string;
	body?: string;
	from?: string;
	to?: string[];
	cc?: string[];
	bcc?: string[];
	conversationId?: string;
	channelId?: string;
	externalThreadId?: string;
	sentByUserId?: string | null;
	createdAt?: number;
}

const emailsList: ToolDef = {
	name: "spaces_emails_list",
	description:
		"Read the emails in an email-backed Xyne Spaces channel — a support desk or shared inbox. Give it a channel " +
		"id and it finds that channel's recent threads and returns the messages in them, with subject, sender, " +
		"recipients, full body and timestamps. Email channels are hidden from spaces_channels_list by default, so " +
		"pass include_email_channels there first to find the channel id.",
	inputSchema: {
		type: "object",
		properties: {
			channel_id: {
				type: "string",
				description: "Email channel id, from spaces_channels_list with include_email_channels set.",
			},
			conversation_ids: {
				type: "array",
				items: { type: "string" },
				description: "Read specific threads instead of the channel's most recent ones.",
			},
			limit: { type: "number", minimum: 1, maximum: 100, default: 20, description: "Max emails (default 20, max 100)." },
			offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset." },
		},
		required: ["channel_id"],
		additionalProperties: false,
	},
	// Two calls: the thread ids first, then their emails. `getEmailsForConversationsV2`
	// takes ids rather than a channel, so a caller with only a channel id would
	// otherwise have to make the first call themselves.
	catalog: [
		{ name: "channelLatestMultipleConversationsV3", sends: ["channelId", "isMember", "limit"] },
		{ name: "getEmailsForConversationsV2", sends: ["conversationIds", "channelId", "isMember"] },
	],
	async handler(args, client) {
		await users.prime(client);
		const channelId = requiredString(args, "channel_id");
		const limit = boundedLimit(args, 20, 100);
		const offset = offsetOf(args);

		let conversationIds = optionalStringArray(args, "conversation_ids");
		if (!conversationIds) {
			const threads = asRows<{ conversationId?: string }>(
				await client.catalogQuery("channelLatestMultipleConversationsV3", {
					channelId,
					isMember: true,
					limit: limit + offset,
				}),
			);
			conversationIds = threads.map((t) => t.conversationId).filter((v): v is string => !!v);
		}

		if (conversationIds.length === 0) return ok(`No email threads found in channel ${channelId}.`);

		const rows = asRows<EmailRow>(
			await client.catalogQuery("getEmailsForConversationsV2", { conversationIds, channelId, isMember: true }),
		);
		rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

		const rendered = rows.slice(offset, offset + limit).map((row, i) => {
			const lines: string[] = [];
			if (row.from) lines.push(`  From: ${row.from}`);
			if (row.to && row.to.length > 0) lines.push(`  To: ${row.to.join(", ")}`);
			if (row.cc && row.cc.length > 0) lines.push(`  Cc: ${row.cc.join(", ")}`);
			if (row.bcc && row.bcc.length > 0) lines.push(`  Bcc: ${row.bcc.join(", ")}`);
			if (row.type) lines.push(`  Type: ${row.type}`);
			if (row.sentByUserId) lines.push(`  Sent by: ${users.label(row.sentByUserId)}`);
			if (row.createdAt) lines.push(`  ${toIST(row.createdAt)} IST`);
			if (row.body) {
				lines.push("  Body:");
				lines.push(indented(cleanText(row.body), "    "));
			}
			if (row.externalThreadId) lines.push(`  External thread ID: ${row.externalThreadId}`);
			if (row.conversationId) lines.push(`  Conversation ID: ${row.conversationId}`);
			if (row.channelId) lines.push(`  Channel ID: ${row.channelId}`);
			lines.push(`  Email ID: ${row.id ?? "(none)"}`);
			return record(offset + i + 1, row.subject || "(no subject)", lines);
		});

		return list("email(s)", rendered, { returned: rendered.length, limit, offset, total: rows.length });
	},
};

// ── spaces_calls_list ───────────────────────────────────────────────────────

interface CallRow {
	id?: string;
	externalId?: string;
	title?: string | null;
	description?: string | null;
	createdByUserId?: string;
	organizerId?: string | null;
	channelId?: string | null;
	callType?: string;
	callOrigin?: string;
	status?: string;
	roomLink?: string | null;
	startsAt?: number | null;
	endsAt?: number | null;
	startedAt?: number;
	endedAt?: number | null;
	isRecurring?: boolean;
	recordingUrl?: string | null;
	aiSummary?: string | null;
	transcript?: string | null;
}

const callsList: ToolDef = {
	name: "spaces_calls_list",
	description:
		"List Xyne Spaces calls and meetings. Choose the scope: 'scheduled' for upcoming meetings, 'active' for calls " +
		"happening right now, or 'history' for past ones. Returns title, organiser, type, times, channel, and — for " +
		"finished calls — whether a recording, transcript or AI summary exists. Use it for 'what meetings do I have', " +
		"'is anyone on a call', or to find a call id before reading its notes.",
	inputSchema: {
		type: "object",
		properties: {
			scope: {
				type: "string",
				enum: ["scheduled", "active", "history"],
				default: "scheduled",
				description: "Which calls to list: upcoming, in progress, or finished.",
			},
			limit: { type: "number", minimum: 1, maximum: 100, default: 25, description: "Max calls (default 25, max 100)." },
			offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset." },
		},
		additionalProperties: false,
	},
	// Three near-identical result shapes behind one tool, because "list my
	// meetings" is one question whose answer depends only on when they are.
	catalog: [
		{ name: "userScheduledCallsV2", sends: [] },
		{ name: "userActiveCalls", sends: [] },
		{ name: "userCallHistoryV2", sends: ["limit", "start"] },
	],
	async handler(args, client) {
		await users.prime(client);
		const scope = optionalString(args, "scope") ?? "scheduled";
		const limit = boundedLimit(args, 25, 100);
		const offset = offsetOf(args);

		const rows =
			scope === "history"
				? asRows<CallRow>(await client.catalogQuery("userCallHistoryV2", { limit: limit + offset, start: null }))
				: scope === "active"
					? asRows<CallRow>(await client.catalogQuery("userActiveCalls"))
					: asRows<CallRow>(await client.catalogQuery("userScheduledCallsV2"));

		const rendered = rows.slice(offset, offset + limit).map((row, i) => {
			const lines: string[] = [];
			if (row.description) lines.push(indented(cleanText(row.description)));
			const detail = [
				row.status ? `status: ${row.status}` : "",
				row.callType ? `type: ${row.callType}` : "",
				row.callOrigin ? `origin: ${row.callOrigin}` : "",
				row.isRecurring ? "recurring" : "",
			].filter(Boolean);
			if (detail.length > 0) lines.push(`  ${detail.join(" · ")}`);

			if (row.organizerId) lines.push(`  Organiser: ${users.label(row.organizerId)}`);
			else if (row.createdByUserId) lines.push(`  Created by: ${users.label(row.createdByUserId)}`);

			const times = timeLine([
				["Starts", row.startsAt],
				["Ends", row.endsAt],
				["Started", row.startedAt],
				["Ended", row.endedAt],
			]);
			if (times) lines.push(`  ${times}`);

			const artefacts = [
				row.recordingUrl ? "recording" : "",
				row.transcript ? "transcript" : "",
				row.aiSummary ? "AI summary" : "",
			].filter(Boolean);
			if (artefacts.length > 0) lines.push(`  Available: ${artefacts.join(", ")}`);
			if (row.aiSummary) {
				lines.push("  Summary:");
				lines.push(indented(cleanText(row.aiSummary), "    "));
			}

			if (row.roomLink) lines.push(`  Room: ${row.roomLink}`);
			if (row.channelId) lines.push(`  Channel ID: ${row.channelId}`);
			if (row.externalId) lines.push(`  External ID: ${row.externalId}`);
			lines.push(`  Call ID: ${row.id ?? "(none)"}`);

			return record(offset + i + 1, row.title || "(untitled call)", lines);
		});

		return list(`${scope} call(s)`, rendered, { returned: rendered.length, limit, offset, total: rows.length });
	},
};

// ── spaces_drafts_list ──────────────────────────────────────────────────────

interface DraftRow {
	id?: string;
	channelId?: string;
	conversationId?: string | null;
	messageId?: string | null;
	content?: string;
	hasAttachment?: boolean;
	origin?: string | null;
	createdAt?: number;
	updatedAt?: number;
}

const draftsList: ToolDef = {
	name: "spaces_drafts_list",
	description:
		"List your unsent Xyne Spaces message drafts, with their full text and the channel or thread each belongs to. " +
		"Useful for 'what did I leave half-written'. A draft with a conversation id is a reply you started in a " +
		"thread; one with only a channel id is an unstarted thread. To finish a draft, read it here and post it with " +
		"spaces_message_send or spaces_thread_create — sending does not clear the draft.",
	inputSchema: {
		type: "object",
		properties: {
			channel_id: { type: "string", description: "Only drafts in this channel." },
			limit: { type: "number", minimum: 1, maximum: 100, default: 25, description: "Max drafts (default 25, max 100)." },
		},
		additionalProperties: false,
	},
	catalog: [{ name: "userDrafts", sends: [] }],
	async handler(args, client) {
		const limit = boundedLimit(args, 25, 100);
		const rows = asRows<DraftRow>(await client.catalogQuery("userDrafts"));
		const channelId = optionalString(args, "channel_id");
		const matched = channelId ? rows.filter((r) => r.channelId === channelId) : rows;
		matched.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

		const rendered = matched.slice(0, limit).map((row, i) => {
			const lines: string[] = [];
			if (row.content) lines.push(indented(cleanText(row.content)));
			const detail = [
				row.hasAttachment ? "has attachments" : "",
				row.origin ? `origin: ${row.origin}` : "",
				row.messageId ? "editing an existing message" : "",
			].filter(Boolean);
			if (detail.length > 0) lines.push(`  ${detail.join(" · ")}`);
			const times = timeLine([
				["Created", row.createdAt],
				["Updated", row.updatedAt],
			]);
			if (times) lines.push(`  ${times}`);
			if (row.conversationId) lines.push(`  Conversation ID: ${row.conversationId}`);
			if (row.channelId) lines.push(`  Channel ID: ${row.channelId}`);
			if (row.messageId) lines.push(`  Message ID: ${row.messageId}`);
			lines.push(`  Draft ID: ${row.id ?? "(none)"}`);
			return record(i + 1, row.conversationId ? "Reply draft" : "New-thread draft", lines);
		});

		return list("draft(s)", rendered, { returned: rendered.length, limit, offset: 0, total: matched.length });
	},
};

// ── spaces_canvases_list / spaces_canvas_get ────────────────────────────────

interface CanvasRow {
	id?: string;
	title?: string;
	content?: unknown;
	channelId?: string | null;
	folderId?: string | null;
	projectId?: string | null;
	createdBy?: string;
	visibility?: string;
	isArchived?: boolean;
	isTemplate?: boolean;
	docType?: string;
	lastEditedBy?: string | null;
	lastEditedAt?: number | null;
	createdAt?: number;
	updatedAt?: number;
	viewAccessId?: string | null;
}

/**
 * Flatten a BlockNote document to readable markdown.
 *
 * A canvas stores its body as a nested block array — `{ type, props, content:
 * [{ type: "text", text }], children: [...] }`. Handing that to a model as JSON
 * spends nearly every token on structure, so the block types that carry meaning
 * are mapped to markdown and the rest are flattened to their text.
 */
function blocksToText(value: unknown, depth = 0): string {
	if (!Array.isArray(value)) return "";
	const out: string[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== "object") continue;
		const block = raw as Record<string, unknown>;
		const type = typeof block["type"] === "string" ? block["type"] : "paragraph";
		const props = (block["props"] ?? {}) as Record<string, unknown>;
		const text = inlineText(block["content"]);
		const pad = "  ".repeat(depth);

		if (type === "heading") {
			const level = Number(props["level"] ?? 1);
			out.push(`${"#".repeat(Math.min(Math.max(level, 1), 6))} ${text}`);
		} else if (type === "bulletListItem") {
			out.push(`${pad}- ${text}`);
		} else if (type === "numberedListItem") {
			out.push(`${pad}1. ${text}`);
		} else if (type === "checkListItem") {
			out.push(`${pad}- [${props["checked"] === true ? "x" : " "}] ${text}`);
		} else if (type === "codeBlock") {
			out.push(`\`\`\`${typeof props["language"] === "string" ? props["language"] : ""}\n${text}\n\`\`\``);
		} else if (type === "image" || type === "video" || type === "file") {
			const url = typeof props["url"] === "string" ? props["url"] : "";
			out.push(`[${type}${text ? `: ${text}` : ""}]${url ? ` ${url}` : ""}`);
		} else if (type === "table") {
			out.push(inlineText(block["content"]) || "[table]");
		} else if (text) {
			out.push(`${pad}${text}`);
		}

		const children = blocksToText(block["children"], depth + 1);
		if (children) out.push(children);
	}
	const joined = out.join("\n").replace(/\n{3,}/g, "\n\n");
	// Only the outermost call may trim: trimming a nested result would strip the
	// indent that makes a child list read as a child.
	return depth === 0 ? joined.trim() : joined.replace(/\s+$/, "");
}

/** Concatenate a block's inline runs, keeping links as their text plus target. */
function inlineText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.map((raw) => {
			if (typeof raw === "string") return raw;
			if (!raw || typeof raw !== "object") return "";
			const node = raw as Record<string, unknown>;
			if (typeof node["text"] === "string") return node["text"];
			if (node["type"] === "link") {
				const label = inlineText(node["content"]);
				const href = typeof node["href"] === "string" ? node["href"] : "";
				return href ? `[${label}](${href})` : label;
			}
			if (node["content"]) return inlineText(node["content"]);
			return "";
		})
		.join("");
}

const canvasesList: ToolDef = {
	name: "spaces_canvases_list",
	description:
		"List Xyne Spaces canvases — the collaborative documents used for design notes, RFCs and meeting notes. " +
		"Returns title, owner, visibility, last editor and timestamps, but not the body; read one with " +
		"spaces_canvas_get. Pass channel_id to list a channel's canvases instead of your own.",
	inputSchema: {
		type: "object",
		properties: {
			channel_id: { type: "string", description: "List canvases belonging to this channel instead of your own." },
			include_archived: { type: "boolean", default: false, description: "Include archived canvases." },
			limit: { type: "number", minimum: 1, maximum: 100, default: 25, description: "Max canvases (default 25, max 100)." },
		},
		additionalProperties: false,
	},
	catalog: [
		{ name: "userCanvasesPaginated", sends: ["limit", "start"] },
		{ name: "channelCanvasesPaginated", sends: ["channelId", "limit", "start"] },
	],
	async handler(args, client) {
		await users.prime(client);
		const limit = boundedLimit(args, 25, 100);
		const channelId = optionalString(args, "channel_id");
		const includeArchived = optionalBoolean(args, "include_archived") === true;

		const rows = channelId
			? asRows<CanvasRow>(
					await client.catalogQuery("channelCanvasesPaginated", { channelId, limit, start: null, includeArchived }),
				)
			: asRows<CanvasRow>(await client.catalogQuery("userCanvasesPaginated", { limit, start: null, includeArchived }));

		const rendered = rows.map((row, i) => {
			const lines: string[] = [];
			const detail = [
				row.docType && row.docType !== "Canvas" ? row.docType : "",
				row.visibility ? row.visibility.toLowerCase() : "",
				row.isTemplate ? "template" : "",
				row.isArchived ? "archived" : "",
			].filter(Boolean);
			if (detail.length > 0) lines.push(`  ${detail.join(" · ")}`);
			if (row.createdBy) lines.push(`  Created by: ${users.label(row.createdBy)}`);
			if (row.lastEditedBy) lines.push(`  Last edited by: ${users.label(row.lastEditedBy)}`);
			const times = timeLine([
				["Created", row.createdAt],
				["Updated", row.updatedAt],
				["Last edited", row.lastEditedAt],
			]);
			if (times) lines.push(`  ${times}`);
			if (row.channelId) lines.push(`  Channel ID: ${row.channelId}`);
			if (row.projectId) lines.push(`  Project ID: ${row.projectId}`);
			lines.push(`  Canvas ID: ${row.id ?? "(none)"}`);
			return record(i + 1, row.title || "(untitled canvas)", lines);
		});

		return list("canvas(es)", rendered, { returned: rendered.length, limit, offset: 0 });
	},
};

const canvasGet: ToolDef = {
	name: "spaces_canvas_get",
	description:
		"Read one Xyne Spaces canvas in full, with its body converted from the stored block format to markdown — " +
		"headings, lists, checklists, code blocks and links all survive. Take the canvas id from " +
		"spaces_canvases_list or from a spaces_search hit with type ['canvas'].",
	inputSchema: {
		type: "object",
		properties: {
			canvas_id: { type: "string", description: "Canvas id, from spaces_canvases_list or spaces_search." },
		},
		required: ["canvas_id"],
		additionalProperties: false,
	},
	catalog: [{ name: "getCanvas", sends: ["canvasId"] }],
	async handler(args, client) {
		await users.prime(client);
		const canvasId = requiredString(args, "canvas_id");
		const rows = asRows<CanvasRow>(await client.catalogQuery("getCanvas", { canvasId }));
		const row = rows[0];
		if (!row) return ok(`No canvas found with id ${canvasId}.`);

		const lines: string[] = [];
		const detail = [
			row.docType && row.docType !== "Canvas" ? row.docType : "",
			row.visibility ? row.visibility.toLowerCase() : "",
			row.isArchived ? "archived" : "",
		].filter(Boolean);
		if (detail.length > 0) lines.push(`  ${detail.join(" · ")}`);
		if (row.createdBy) lines.push(`  Created by: ${users.label(row.createdBy)}`);
		if (row.lastEditedBy) lines.push(`  Last edited by: ${users.label(row.lastEditedBy)}`);
		const times = timeLine([
			["Created", row.createdAt],
			["Updated", row.updatedAt],
			["Last edited", row.lastEditedAt],
		]);
		if (times) lines.push(`  ${times}`);
		if (row.channelId) lines.push(`  Channel ID: ${row.channelId}`);
		lines.push(`  Canvas ID: ${row.id ?? canvasId}`);

		const body = blocksToText(row.content);
		lines.push("");
		lines.push(body || "  (empty)");

		return ok(record(1, row.title || "(untitled canvas)", lines));
	},
};

export const commsTools: ToolDef[] = [
	notificationsList,
	notificationsMarkRead,
	emailsList,
	callsList,
	draftsList,
	canvasesList,
	canvasGet,
];
