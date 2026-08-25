/**
 * Projects, boards, stages and people.
 *
 * These exist to feed the ticket and message tools. Creating a ticket needs a
 * project id, a board id, a channel id and often a stage name and an assignee,
 * none of which an agent can invent — so each has a tool that turns a name into
 * an id.
 */

import {
	boundedLimit,
	cleanText,
	indented,
	list,
	ok,
	offsetOf,
	optionalString,
	record,
	requiredString,
	timeLine,
} from "../render.js";
import { MAX_LIMIT, type Board, type Project, type Stage, type User as SdkUser } from "@xyne/spaces-sdk";
import type { Related } from "../render.js";
import type { ToolDef } from "./shared.js";
import { users } from "./shared.js";

// ── spaces_projects_list ────────────────────────────────────────────────────

type ProjectRow = Project;

const projectsList: ToolDef = {
	name: "spaces_projects_list",
	description:
		"List the projects in this Xyne Spaces workspace, with their ids and ticket-key prefixes. A project is the top " +
		"of the hierarchy: projects hold boards, boards hold stages, and tickets live on a board. Start here when you " +
		"need to create a ticket or a channel and do not already have a project id. The `code` is the prefix in ticket " +
		"keys — a project with code PLAT owns PLAT-1234.",
	inputSchema: {
		type: "object",
		properties: {
			name: { type: "string", description: "Case-insensitive partial match on project name or code." },
			limit: { type: "number", minimum: 1, maximum: 200, default: 100, description: "Max projects (default 100, max 200)." },
			offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset." },
		},
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		await users.prime(sdk);
		const limit = boundedLimit(args, 100, 200);
		const offset = offsetOf(args);
		const rows: ProjectRow[] = await sdk.projects.listLite();

		const filter = optionalString(args, "name")?.toLowerCase();
		const matched = filter
			? rows.filter((r) => `${r.name ?? ""} ${r.code ?? ""}`.toLowerCase().includes(filter))
			: rows;

		const rendered = matched.slice(offset, offset + limit).map((row, i) => {
			const lines: string[] = [];
			if (row.description) lines.push(indented(cleanText(row.description)));
			if (row.type) lines.push(`  Type: ${row.type}`);
			if (row.createdBy) lines.push(`  Created by: ${users.label(row.createdBy)}`);
			const times = timeLine([
				["Created", row.createdAt],
				["Updated", row.updatedAt],
			]);
			if (times) lines.push(`  ${times}`);
			lines.push(`  Project ID: ${row.id ?? "(none)"}`);
			return record(offset + i + 1, `${row.name ?? "(unnamed)"}${row.code ? ` [${row.code}]` : ""}`, lines);
		});

		return list("project(s)", rendered, { returned: rendered.length, limit, offset, total: matched.length });
	},
};

// ── spaces_board_stages ─────────────────────────────────────────────────────

/**
 * `boardsByProject` pulls stages through a Zero `.related()`, which the SDK's
 * `Board` does not declare — it types columns only. Intersecting keeps every
 * column checked against the real schema and hand-declares just the join.
 */
type BoardRow = Board & { stages?: Related<Stage> };

const boardStages: ToolDef = {
	name: "spaces_board_stages",
	description:
		"List a project's boards together with each board's stages, in workflow order. One call gives everything the " +
		"ticket tools need: the board id for spaces_ticket_create, and the exact stage NAMES for its stage_name and " +
		"for spaces_ticket_transition. Stage names must match exactly, so read them here rather than guessing at " +
		"'Done' or 'In Progress'. Each stage also shows the ticket status it puts a ticket into, and whether entering " +
		"it needs approval.",
	inputSchema: {
		type: "object",
		properties: {
			project_id: { type: "string", description: "Project id, from spaces_projects_list." },
			board_name: { type: "string", description: "Case-insensitive partial match to narrow to one board." },
		},
		required: ["project_id"],
		additionalProperties: false,
	},
	// `boardsByProject` already pulls stages through a relation, so boards and
	// their stages arrive together rather than needing a call per board.
	async handler(args, { sdk }) {
		await users.prime(sdk);
		const projectId = requiredString(args, "project_id");
		const rows = (await sdk.boards.listByProject(projectId)) as BoardRow[];

		const filter = optionalString(args, "board_name")?.toLowerCase();
		const matched = filter ? rows.filter((r) => (r.name ?? "").toLowerCase().includes(filter)) : rows;

		const rendered = matched.map((board, i) => {
			const lines: string[] = [];
			if (board.description) lines.push(indented(cleanText(board.description)));
			const detail = [
				board.boardType ? `type: ${board.boardType}` : "",
				board.releaseTrackingMode ? `release tracking: ${board.releaseTrackingMode}` : "",
			].filter(Boolean);
			if (detail.length > 0) lines.push(`  ${detail.join(" · ")}`);
			if (board.createdBy) lines.push(`  Created by: ${users.label(board.createdBy)}`);

			const stages = [...(Array.isArray(board.stages) ? board.stages : board.stages ? [board.stages] : [])].sort(
				(a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0),
			);
			if (stages.length > 0) {
				lines.push(`  Stages (${stages.length}), in order:`);
				for (const stage of stages) {
					const notes = [
						stage.defaultTicketStatusV2 ? `sets status ${stage.defaultTicketStatusV2}` : "",
						stage.requestApprovalOnEntry ? "needs approval to enter" : "",
					].filter(Boolean);
					lines.push(`    ${stage.sequenceNumber ?? "?"}. ${stage.name ?? "(unnamed)"}${notes.length > 0 ? ` — ${notes.join(", ")}` : ""}`);
				}
			} else {
				lines.push("  Stages: none configured");
			}

			const times = timeLine([
				["Created", board.createdAt],
				["Updated", board.updatedAt],
			]);
			if (times) lines.push(`  ${times}`);
			lines.push(`  Board ID: ${board.id ?? "(none)"}`);
			return record(i + 1, board.name ?? "(unnamed board)", lines);
		});

		// No paging: a project has a handful of boards, and splitting a workflow
		// across pages would hide the stage a caller is looking for.
		if (rendered.length === 0) return ok(`No boards found for project ${projectId}.`);
		return ok(`${rendered.length} board(s):\n\n${rendered.join("\n\n")}`);
	},
};

// ── spaces_users_list ───────────────────────────────────────────────────────

/** `title` and `isActive` are real columns the SDK's `User` does not declare. */
type UserRow = SdkUser & { title?: string; isActive?: boolean };

const usersList: ToolDef = {
	name: "spaces_users_list",
	description:
		"Find people in this Xyne Spaces workspace and get their user ids. Use it to turn a name or an email into the " +
		"id that spaces_ticket_update wants for assignee, spaces_tickets_list wants for user_id, and " +
		"spaces_channel_create wants for participants. Search by partial name or email; with no filter it returns the " +
		"whole directory, so pass one. Most tools that take a person also accept an email directly, so this is mainly " +
		"for confirming who you mean when a name is ambiguous.",
	inputSchema: {
		type: "object",
		properties: {
			search: { type: "string", description: "Case-insensitive partial match on name, display name, or email." },
			limit: { type: "number", minimum: 1, maximum: 100, default: 50, description: "Max people (default 50, max 100)." },
			offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset." },
		},
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		const limit = boundedLimit(args, 50, MAX_LIMIT);
		const offset = offsetOf(args);
		// The directory is already paged and cached for the process; reuse it
		// rather than paying for another full walk per call.
		await users.prime(sdk);
		const rows = users.all() as UserRow[];

		const search = optionalString(args, "search")?.toLowerCase();
		const matched = search
			? rows.filter((r) => `${r.name ?? ""} ${r.displayName ?? ""} ${r.email ?? ""}`.toLowerCase().includes(search))
			: rows;

		const rendered = matched.slice(offset, offset + limit).map((row, i) => {
			const lines: string[] = [];
			if (row.title) lines.push(`  ${row.title}`);
			const detail = [
				row.role ? `role: ${row.role}` : "",
				row.status ? `status: ${row.status}` : "",
				row.isActive === false ? "inactive" : "",
			].filter(Boolean);
			if (detail.length > 0) lines.push(`  ${detail.join(" · ")}`);
			lines.push(`  User ID: ${row.id ?? "(none)"}`);
			const name = row.displayName || row.name || "(unnamed)";
			return record(offset + i + 1, `${name}${row.email ? ` <${row.email}>` : ""}`, lines);
		});

		return list("person(s)", rendered, { returned: rendered.length, limit, offset, total: matched.length });
	},
};

export const lookupTools: ToolDef[] = [projectsList, boardStages, usersList];
