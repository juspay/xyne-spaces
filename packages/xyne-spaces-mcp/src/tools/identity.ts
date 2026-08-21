/**
 * Who the key acts as, and the search that finds everything else.
 */

import {
	boundedLimit,
	cleanText,
	formatBytes,
	offsetOf,
	ok,
	optionalBoolean,
	optionalString,
	optionalStringArray,
	paginationFooter,
	record,
	toIST,
} from "../render.js";
import type { ToolDef } from "./shared.js";

/**
 * Result types the server accepts, mirroring `TYPES` in the contract's
 * `searchQuerySchema`. These are validated strictly — an unrecognised value is
 * rejected outright rather than ignored, and the plural form is not optional.
 * A result comes back typed `message`; feeding that straight back in fails.
 */
export const SEARCH_TYPES = [
	"messages",
	"attachments",
	"calls",
	"channels",
	"tickets",
	"users",
	"files",
	"canvas",
	"transcript",
	"rca",
	"people",
	"emails",
] as const;

/** Apps the server accepts, mirroring `APPS` in the contract. */
export const SEARCH_APPS = ["chat", "ticket", "user", "file", "collection", "mail", "xyneapp", "call"] as const;

// ── spaces_whoami ───────────────────────────────────────────────────────────

const whoami: ToolDef = {
	name: "spaces_whoami",
	description:
		"Identify the Xyne Spaces user this API key acts as. Returns the user id, email, name, workspace id, org id, " +
		"role, and when the key expires. Call this FIRST in any session that will filter or write by user — every other " +
		"tool that takes a user takes the id returned here, and an API key is opaque so there is no way to read it " +
		"locally. Also the quickest way to confirm the server is configured and the key is live.",
	inputSchema: { type: "object", properties: {}, additionalProperties: false },
	direct: [{ method: "get", path: "/me" }],
	async handler(_args, client) {
		const me = await client.direct<Record<string, unknown>>("GET", "/me");
		const lines = [
			`  User ID: ${String(me["id"] ?? "(unknown)")}`,
			`  Email: ${String(me["email"] ?? "(unknown)")}`,
			`  Name: ${String(me["displayName"] || me["name"] || "(unknown)")}`,
			`  Workspace ID: ${String(me["workspaceId"] ?? "(unknown)")}`,
		];
		if (me["orgId"]) lines.push(`  Org ID: ${String(me["orgId"])}`);
		if (me["memberId"]) lines.push(`  Org member ID: ${String(me["memberId"])}`);
		const roles = [me["role"] ? `role: ${String(me["role"])}` : "", me["orgRole"] ? `org role: ${String(me["orgRole"])}` : ""]
			.filter(Boolean)
			.join(" · ");
		if (roles) lines.push(`  ${roles}`);
		if (me["keyExpiresAt"]) lines.push(`  Key expires: ${toIST(String(me["keyExpiresAt"]))} IST`);
		lines.push("");
		lines.push(
			"  Pass the User ID above wherever a tool asks for a user — assignee on spaces_ticket_update, " +
				"user_id on spaces_tickets_list. Tools that take a person also accept an email address.",
		);
		return ok(`Signed in to Xyne Spaces at ${client.baseUrl}:\n${lines.join("\n")}`);
	},
};

// ── spaces_search ───────────────────────────────────────────────────────────

interface SearchRow {
	id?: string;
	type?: string;
	title?: string;
	subtitle?: string;
	context?: string;
	relevanceScore?: number;
	metadata?: Record<string, unknown>;
	searchContext?: Record<string, unknown>;
}

interface SearchPayload {
	grouped?: boolean;
	results?: SearchRow[];
	groups?: Array<{ groupValue?: string; count?: number; results?: SearchRow[] }>;
	totalCount?: number;
	offset?: number;
	limit?: number;
}

function push(lines: string[], label: string, value: unknown): void {
	if (value === undefined || value === null || value === "") return;
	lines.push(`  ${label}: ${String(value)}`);
}

/**
 * Render one hit.
 *
 * The ids in `searchContext` are the point of this tool: search finds the thing,
 * and the ids are what let the next call act on it. Everything set is emitted.
 */
function renderHit(row: SearchRow, index: number): string {
	const ctx = row.searchContext ?? {};
	const meta = row.metadata ?? {};
	const subApp = typeof ctx["subApp"] === "string" ? ctx["subApp"].toUpperCase() : undefined;
	const kind =
		row.type === "transcript" || subApp === "TRANSCRIPT"
			? "call"
			: row.type === "canvas" || subApp === "CANVAS"
				? "canvas"
				: (row.type ?? "result");

	const title = `[${kind}] ${row.title ?? "(untitled)"}${row.subtitle ? ` — ${row.subtitle}` : ""}`;
	const lines: string[] = [];

	if (row.context) lines.push(`  ${cleanText(row.context)}`);

	const detail: string[] = [];
	if (meta["timestamp"]) detail.push(`${toIST(meta["timestamp"] as string)} IST`);
	if (meta["channelName"]) detail.push(`#${String(meta["channelName"])}`);
	if (meta["status"]) detail.push(`status: ${String(meta["status"])}`);
	if (ctx["priority"]) detail.push(`priority: ${String(ctx["priority"])}`);
	if (ctx["stageName"]) detail.push(`stage: ${String(ctx["stageName"])}`);
	if (typeof ctx["memberCount"] === "number") detail.push(`${ctx["memberCount"]} members`);
	if (typeof row.relevanceScore === "number") detail.push(`score: ${row.relevanceScore.toFixed(3)}`);
	if (detail.length > 0) lines.push(`  ${detail.join(" · ")}`);

	if (ctx["senderName"] || ctx["senderEmail"] || ctx["senderId"]) {
		const parts = [
			ctx["senderName"] ? String(ctx["senderName"]) : "",
			ctx["senderEmail"] ? `<${String(ctx["senderEmail"])}>` : "",
			ctx["senderId"] ? `(id: ${String(ctx["senderId"])})` : "",
		].filter(Boolean);
		lines.push(`  From: ${parts.join(" ")}`);
	}
	if (ctx["creatorName"] && ctx["creatorName"] !== "Unknown Creator") {
		lines.push(`  Created by: ${String(ctx["creatorName"])}${ctx["createdBy"] ? ` (id: ${String(ctx["createdBy"])})` : ""}`);
	} else {
		push(lines, "createdBy", ctx["createdBy"]);
	}
	if (ctx["assigneeName"]) {
		lines.push(`  Assigned to: ${String(ctx["assigneeName"])}${ctx["assignedTo"] ? ` (id: ${String(ctx["assignedTo"])})` : ""}`);
	} else {
		push(lines, "assignedTo", ctx["assignedTo"]);
	}
	push(lines, "Closed by", ctx["closedByName"]);

	const placement = [
		ctx["boardName"] ? `Board: ${String(ctx["boardName"])}` : "",
		ctx["projectName"] ? `Project: ${String(ctx["projectName"])}` : "",
	].filter(Boolean);
	if (placement.length > 0) lines.push(`  ${placement.join(" · ")}`);

	if (Array.isArray(ctx["tags"]) && ctx["tags"].length > 0) lines.push(`  Tags: ${(ctx["tags"] as unknown[]).join(", ")}`);
	if (typeof ctx["replyCount"] === "number") {
		lines.push(`  ${ctx["replyCount"]} repl${ctx["replyCount"] === 1 ? "y" : "ies"}`);
	}

	const file = [
		ctx["fileName"] ? String(ctx["fileName"]) : "",
		ctx["mimeType"] ? String(ctx["mimeType"]) : "",
		formatBytes(ctx["fileSize"]),
	].filter(Boolean);
	if (file.length > 0) lines.push(`  File: ${file.join(" · ")}`);

	if (Array.isArray(ctx["participantNames"]) && ctx["participantNames"].length > 0) {
		lines.push(`  Participants: ${(ctx["participantNames"] as unknown[]).join(", ")}`);
	}

	// Ids last and always labelled — this is what the next tool call consumes.
	push(lines, "xyneId", ctx["xyneId"]);
	push(lines, "ticketId", ctx["ticketId"]);
	push(lines, "userId", ctx["userId"]);
	push(lines, "messageId", ctx["messageId"]);
	push(lines, "conversationId", ctx["conversationId"] ?? meta["conversationId"]);
	push(lines, "channelId", ctx["channelId"] ?? meta["channelId"]);
	push(lines, "callId", ctx["callId"]);
	push(lines, "canvasId", ctx["docId"]);
	if (row.id) lines.push(`  Result ID: ${row.id}`);

	return record(index, title, lines);
}

const search: ToolDef = {
	name: "spaces_search",
	description:
		"Full-text search across Xyne Spaces — messages, tickets, channels, files, calls, emails, canvases, and people. " +
		"This is the DISCOVERY tool: use it when you know what something is about but not where it lives. It is a " +
		"relevance-ranked index, so it is fuzzy; for an exact channel name use spaces_channels_list, and for structured " +
		"ticket filtering (by status, board, assignee) use spaces_tickets_list, which returns richer and more accurate " +
		"data. Every hit carries the ids needed to act on it — channelId, conversationId, messageId, ticketId, xyneId, " +
		"userId — so a search followed by a read or a write needs no lookup in between. " +
		"`type` and `apps` are validated strictly: use the PLURAL forms listed here. A result labelled [message] " +
		"corresponds to type 'messages'. Omit `query` to search by filters alone.",
	inputSchema: {
		type: "object",
		properties: {
			query: {
				type: "string",
				maxLength: 500,
				description: "Free-text search. Omit to search by filters alone (e.g. every ticket assigned to someone).",
			},
			type: {
				type: "array",
				items: { type: "string", enum: [...SEARCH_TYPES] },
				description:
					"Restrict to these result types (matches any). PLURAL forms only — 'messages', not 'message'. " +
					"An unrecognised value is rejected, not ignored.",
			},
			apps: {
				type: "array",
				items: { type: "string", enum: [...SEARCH_APPS] },
				description: "Restrict to these source apps (matches any).",
			},
			in: {
				type: "array",
				items: { type: "string" },
				description: "Restrict to these channels — channel ids or names.",
			},
			from: {
				type: "array",
				items: { type: "string" },
				description: "Restrict to content authored by these people — user ids or names.",
			},
			with_user: {
				type: "array",
				items: { type: "string" },
				description: "Restrict to conversations involving these people — user ids.",
			},
			mentions: {
				type: "array",
				items: { type: "string" },
				description: "Restrict to content mentioning these users — user ids.",
			},
			project_id: { type: "array", items: { type: "string" }, description: "Restrict to these projects." },
			status: { type: "array", items: { type: "string" }, description: "Ticket status filter, e.g. TODO, COMPLETED." },
			priority: { type: "string", description: "Ticket priority filter, e.g. HIGH." },
			board: { type: "string", description: "Board name or id." },
			stage: { type: "string", description: "Ticket stage name." },
			assignee: { type: "string", description: "Assigned user name." },
			tags: { type: "string", description: "Comma-separated tag names." },
			after: { type: "string", description: "Only content created at or after this date." },
			before: { type: "string", description: "Only content created strictly before this date." },
			on: { type: "string", description: "Only content created on this date." },
			range: {
				type: "string",
				description: "Natural time window instead of explicit cutoffs, e.g. 'today', 'yesterday', 'last 7 days'.",
			},
			order_by: {
				type: "string",
				enum: ["relevance", "newest", "oldest"],
				default: "relevance",
				description: "Ranking. 'newest'/'oldest' sort by time and force a flat list.",
			},
			only_my_channels: {
				type: "boolean",
				description: "Restrict to channels you are a member of, excluding public channels you have not joined.",
			},
			include_bot_messages: { type: "boolean", description: "Include messages posted by bots. Default false." },
			group_by_type: {
				type: "boolean",
				default: false,
				description:
					"Bucket results by document type instead of returning one ranked list. Default false — a flat " +
					"ranked list is almost always what you want.",
			},
			limit: { type: "number", minimum: 1, maximum: 200, default: 20, description: "Max results (default 20, max 200)." },
			offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset." },
		},
		additionalProperties: false,
	},
	direct: [{ method: "get", path: "/search" }],
	async handler(args, client) {
		const limit = boundedLimit(args, 20, 200);
		const offset = offsetOf(args);

		const payload = await client.direct<SearchPayload>("GET", "/search", {
			query: {
				q: optionalString(args, "query") ?? "",
				type: optionalStringArray(args, "type"),
				apps: optionalStringArray(args, "apps"),
				in: optionalStringArray(args, "in"),
				from: optionalStringArray(args, "from"),
				withUser: optionalStringArray(args, "with_user"),
				mentions: optionalStringArray(args, "mentions"),
				projectId: optionalStringArray(args, "project_id"),
				status: optionalStringArray(args, "status"),
				priority: optionalString(args, "priority"),
				board: optionalString(args, "board"),
				stage: optionalString(args, "stage"),
				assignee: optionalString(args, "assignee"),
				tags: optionalString(args, "tags"),
				after: optionalString(args, "after"),
				before: optionalString(args, "before"),
				on: optionalString(args, "on"),
				range: optionalString(args, "range"),
				orderBy: optionalString(args, "order_by"),
				onlyMyChannels: optionalBoolean(args, "only_my_channels"),
				includeBotMessages: optionalBoolean(args, "include_bot_messages"),
				// An empty string is what asks the server for a flat ranked list.
				// Sent explicitly because the server's own default groups by type.
				groupBy: optionalBoolean(args, "group_by_type") === true ? undefined : "",
				limit,
				offset,
			},
		});

		if (payload.grouped && Array.isArray(payload.groups)) {
			const blocks: string[] = [];
			let index = 0;
			for (const group of payload.groups) {
				const rows = group.results ?? [];
				if (rows.length === 0) continue;
				blocks.push(`## ${group.groupValue ?? "results"}${typeof group.count === "number" ? ` (${group.count})` : ""}`);
				for (const row of rows) {
					index += 1;
					blocks.push(renderHit(row, index));
				}
			}
			if (index === 0) return ok("No results found.");
			return ok(
				`${index} result(s) across ${payload.groups.length} group(s):\n\n${blocks.join("\n\n")}` +
					paginationFooter({ returned: index, limit, offset, ...(typeof payload.totalCount === "number" ? { total: payload.totalCount } : {}) }),
			);
		}

		const rows = payload.results ?? [];
		if (rows.length === 0) return ok("No results found.");
		const rendered = rows.map((row, i) => renderHit(row, i + 1));
		return ok(
			`${rows.length} result(s):\n\n${rendered.join("\n\n")}` +
				paginationFooter({ returned: rows.length, limit, offset, ...(typeof payload.totalCount === "number" ? { total: payload.totalCount } : {}) }),
		);
	},
};

export const identityTools: ToolDef[] = [whoami, search];
