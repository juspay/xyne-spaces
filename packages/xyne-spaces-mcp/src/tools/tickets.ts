/**
 * Tickets: the richest rows in Spaces, and the ones an agent most often has to
 * both read and change.
 */

import {
	boundedLimit,
	cleanText,
	indented,
	list,
	ok,
	offsetOf,
	optionalBoolean,
	optionalNumber,
	optionalString,
	optionalStringArray,
	record,
	requiredString,
	timeLine,
	toIST,
} from "../render.js";
import {
	MAX_LIMIT,
	type Ticket,
	type TicketPriority,
	type TicketStatusV2,
	type TicketViewMode,
} from "@xyne/spaces-sdk";
import type { Related } from "../render.js";
import { first } from "../render.js";
import type { ToolDef } from "./shared.js";
import { users } from "./shared.js";

const STATUSES = ["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/**
 * `ticketDetailsByIdV2` pulls in seven `.related()` collections that the SDK's
 * `Ticket` does not declare — it types columns only. Intersecting keeps every
 * column checked against the real Zero schema and hand-declares only the joins.
 */
type TicketRow = Ticket & {
	project?: Related<{ name?: string; code?: string }>;
	tagMappings?: Array<{ tagId?: string; name?: string }> | null;
	assignments?: Array<{ userId?: string; role?: Related<{ name?: string }> }> | null;
	referencesOut?: Array<{ targetTicket?: Related<{ xyneId?: string }> }> | null;
	referencesIn?: Array<{ sourceTicket?: Related<{ xyneId?: string }> }> | null;
	stageEtaEntries?: Array<{ stageName?: string; eta?: number }> | null;
	ticketStageRequests?: Array<{ status?: string; toStageName?: string }> | null;
	rcas?: Array<{ id?: string; summary?: string }> | null;
};

/**
 * Render one ticket, emitting every field that is set.
 *
 * The description is not truncated. A ticket body is usually the reason the
 * caller asked for the ticket, and cutting it silently drops the part that
 * mattered — narrow with `limit` instead.
 */
function renderTicket(row: TicketRow, index: number): string {
	const title = `[${row.xyneId ?? "?"}] ${row.title ?? "(untitled)"}${row.isArchived ? " [archived]" : ""}`;
	const lines: string[] = [];

	const state = [
		`Status: ${row.statusV2 ?? "?"}`,
		`Priority: ${row.priority ?? "?"}`,
		row.stageName ? `Stage: ${row.stageName}` : "",
		row.ticketType ? `Type: ${row.ticketType}` : "",
	].filter(Boolean);
	lines.push(`  ${state.join(" · ")}`);

	if (row.assignedTo) lines.push(`  Assigned: ${users.label(row.assignedTo)}`);
	else lines.push("  Assigned: nobody");
	if (row.createdBy) lines.push(`  Created by: ${users.label(row.createdBy)}`);
	if (row.updatedBy && row.updatedBy !== row.createdBy) lines.push(`  Last edited by: ${users.label(row.updatedBy)}`);

	const project = first(row.project);
	const placement = [
		project?.name ? `Project: ${project.name}${project.code ? ` [${project.code}]` : ""}` : "",
		row.userGroupId ? `User group ID: ${row.userGroupId}` : "",
	].filter(Boolean);
	if (placement.length > 0) lines.push(`  ${placement.join(" · ")}`);

	const tags = (row.tagMappings ?? []).map((t) => t.name ?? t.tagId).filter(Boolean);
	if (tags.length > 0) lines.push(`  Tags: ${tags.join(", ")}`);

	for (const assignment of row.assignments ?? []) {
		const role = first(assignment.role)?.name;
		if (assignment.userId) lines.push(`  ${role ?? "Participant"}: ${users.label(assignment.userId)}`);
	}

	const related = [
		...(row.referencesOut ?? []).map((r) => first(r.targetTicket)?.xyneId),
		...(row.referencesIn ?? []).map((r) => first(r.sourceTicket)?.xyneId),
	].filter((v): v is string => !!v);
	if (related.length > 0) lines.push(`  Related tickets: ${[...new Set(related)].join(", ")}`);

	if (row.eta) lines.push(`  Due (ETA): ${toIST(row.eta)} IST`);
	for (const entry of row.stageEtaEntries ?? []) {
		if (entry.stageName && entry.eta) lines.push(`  Stage ETA — ${entry.stageName}: ${toIST(entry.eta)} IST`);
	}

	for (const request of row.ticketStageRequests ?? []) {
		if (request.status) lines.push(`  Stage request: ${request.status}${request.toStageName ? ` → ${request.toStageName}` : ""}`);
	}

	const rca = (row.rcas ?? [])[0];
	if (rca) lines.push(`  RCA: ${rca.summary ? cleanText(rca.summary) : `(id: ${rca.id ?? "?"})`}`);

	if (row.description && row.description.trim().length > 0) {
		lines.push("  Description:");
		lines.push(indented(cleanText(row.description), "    "));
	}

	const times = timeLine([
		["Created", row.createdAt],
		["Updated", row.updatedAt],
		["Status changed", row.statusUpdatedAt],
	]);
	if (times) lines.push(`  ${times}`);
	if (row.closedAt || row.closedBy) {
		lines.push(`  Closed: ${row.closedAt ? `${toIST(row.closedAt)} IST` : "(time n/a)"}${row.closedBy ? ` by ${users.label(row.closedBy)}` : ""}`);
	}

	if (row.boardId) lines.push(`  Board ID: ${row.boardId}`);
	if (row.projectId) lines.push(`  Project ID: ${row.projectId}`);
	if (row.channelId) lines.push(`  Channel ID: ${row.channelId}`);
	if (row.conversationId) lines.push(`  Conversation ID: ${row.conversationId}`);
	lines.push(`  Ticket ID: ${row.id ?? "(none)"}`);

	return record(index, title, lines);
}

// ── spaces_tickets_list ─────────────────────────────────────────────────────

const ticketsList: ToolDef = {
	name: "spaces_tickets_list",
	description:
		"List Xyne Spaces tickets for one scope, newest first, with full detail per ticket: status, priority, stage, " +
		"assignee, creator, tags, related tickets, due date, description, and the board / project / channel / " +
		"conversation ids. Prefer this over spaces_search for ticket questions — it reads the database rather than a " +
		"relevance index, so the answer is exact. " +
		"view_mode decides the scope and which other argument is needed: 'my-tickets' takes none and returns tickets " +
		"you are assigned or created; 'project' needs project_id; 'board' needs board_id; 'user-tickets' needs " +
		"user_id; 'group-tickets' needs group_id. This returns EVERY matching ticket before paging, so scope it to a " +
		"board or project rather than asking for a whole workspace, and use spaces_tickets_search when you only want " +
		"to find one by name.",
	inputSchema: {
		type: "object",
		properties: {
			view_mode: {
				type: "string",
				enum: ["my-tickets", "project", "board", "user-tickets", "group-tickets"],
				default: "my-tickets",
				description:
					"Scope. Each mode needs its own companion argument: project→project_id, board→board_id, " +
					"user-tickets→user_id, group-tickets→group_id. 'my-tickets' needs none.",
			},
			project_id: { type: "string", description: "Required when view_mode is 'project'. From spaces_projects_list." },
			board_id: { type: "string", description: "Required when view_mode is 'board'. From spaces_board_stages." },
			user_id: {
				type: "string",
				description: "Required when view_mode is 'user-tickets'. A user id or an email address, which is resolved for you.",
			},
			group_id: { type: "string", description: "Required when view_mode is 'group-tickets'." },
			status: {
				type: "array",
				items: { type: "string", enum: [...STATUSES] },
				description: "Keep only tickets in these statuses (matches any).",
			},
			priority: {
				type: "array",
				items: { type: "string", enum: [...PRIORITIES] },
				description: "Keep only tickets at these priorities (matches any).",
			},
			stage_name: { type: "string", description: "Keep only tickets in this stage. Exact name, from spaces_board_stages." },
			assigned_to: { type: "string", description: "Keep only tickets assigned to this person — user id or email." },
			unassigned_only: { type: "boolean", description: "Keep only tickets with no assignee." },
			include_archived: { type: "boolean", default: false, description: "Include archived tickets. Off by default." },
			limit: { type: "number", minimum: 1, maximum: 200, default: 25, description: "Max tickets rendered (default 25, max 200)." },
			offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset." },
		},
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		await users.prime(sdk);
		const viewMode = optionalString(args, "view_mode") ?? "my-tickets";
		const limit = boundedLimit(args, 25, 200);
		const offset = offsetOf(args);

		const projectId = optionalString(args, "project_id");
		const boardId = optionalString(args, "board_id");
		const groupId = optionalString(args, "group_id");
		const userId = await users.toUserId(sdk, optionalString(args, "user_id"));

		// The query silently drops the filter when a view mode's companion
		// argument is absent, so 'user-tickets' with no user returns the whole
		// scope and reads as though that person owns all of it. Refuse instead.
		const needs: Record<string, string | undefined> = {
			project: projectId && "project_id",
			board: boardId && "board_id",
			"user-tickets": userId && "user_id",
			"group-tickets": groupId && "group_id",
		};
		const expected: Record<string, string> = {
			project: "project_id",
			board: "board_id",
			"user-tickets": "user_id",
			"group-tickets": "group_id",
		};
		if (viewMode in expected && !needs[viewMode]) {
			throw new Error(
				`view_mode '${viewMode}' needs ${expected[viewMode]}. Without it the filter is dropped and you would get ` +
					`every ticket in scope rather than the ones you asked for.`,
			);
		}

		const rows = (await sdk.tickets.list({
			viewMode: viewMode as TicketViewMode,
			...(projectId ? { projectId } : {}),
			...(boardId ? { boardId } : {}),
			...(userId ? { userId } : {}),
			...(groupId ? { groupId } : {}),
		})) as TicketRow[];

		const statuses = optionalStringArray(args, "status");
		const priorities = optionalStringArray(args, "priority");
		const stageName = optionalString(args, "stage_name");
		const assignedTo = await users.toUserId(sdk, optionalString(args, "assigned_to"));
		const unassignedOnly = optionalBoolean(args, "unassigned_only") === true;
		const includeArchived = optionalBoolean(args, "include_archived") === true;

		const matched = rows.filter((row) => {
			if (!includeArchived && row.isArchived) return false;
			if (statuses && !statuses.includes(row.statusV2 ?? "")) return false;
			if (priorities && !priorities.includes(row.priority ?? "")) return false;
			if (stageName && row.stageName !== stageName) return false;
			if (unassignedOnly && row.assignedTo) return false;
			if (assignedTo && row.assignedTo !== assignedTo) return false;
			return true;
		});

		const rendered = matched.slice(offset, offset + limit).map((row, i) => renderTicket(row, offset + i + 1));
		return list("ticket(s)", rendered, { returned: rendered.length, limit, offset, total: matched.length });
	},
};

// ── spaces_tickets_search ───────────────────────────────────────────────────

const ticketsSearch: ToolDef = {
	name: "spaces_tickets_search",
	description:
		"Find Xyne Spaces tickets by ticket key or title. Matches a substring of the human key (e.g. 'PLAT-12') or of " +
		"the title, across every project you can see. This is the quickest way to turn 'the refund timeout ticket' or " +
		"'PLAT-1234' into a ticket id. It matches titles and keys only — to search ticket bodies and comments use " +
		"spaces_search with type ['tickets'], and to list a board or a person's queue use spaces_tickets_list.",
	inputSchema: {
		type: "object",
		properties: {
			query: { type: "string", description: "Substring of the ticket key or title. Omit to get the most recent tickets." },
			limit: { type: "number", minimum: 1, maximum: 100, default: 20, description: "Max tickets (default 20, max 100)." },
		},
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		await users.prime(sdk);
		const limit = boundedLimit(args, 20, 100);
		const rows = (await sdk.tickets.search({
			...(optionalString(args, "query") ? { search: optionalString(args, "query")! } : {}),
			limit,
		})) as TicketRow[];
		const rendered = rows.map((row, i) => renderTicket(row, i + 1));
		return list("ticket(s)", rendered, { returned: rendered.length, limit, offset: 0 });
	},
};

// ── spaces_ticket_get ───────────────────────────────────────────────────────

const ticketGet: ToolDef = {
	name: "spaces_ticket_get",
	description:
		"Read one Xyne Spaces ticket in full by its ticket id, including everything the list view shows plus its " +
		"project, tags, role assignments (PR reviewer, QA), related and duplicate tickets, per-stage due dates, open " +
		"stage-approval requests, and the latest RCA. Takes the internal ticket id — the 'Ticket ID' line in other " +
		"tools' output — not the human key like PLAT-1234; use spaces_tickets_search to turn a key into an id.",
	inputSchema: {
		type: "object",
		properties: {
			ticket_id: { type: "string", description: "Internal ticket id, from spaces_tickets_search or spaces_tickets_list." },
		},
		required: ["ticket_id"],
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		await users.prime(sdk);
		const ticketId = requiredString(args, "ticket_id");
		const row = (await sdk.tickets.getDetails(ticketId)) as TicketRow | null;
		if (!row) {
			return ok(
				`No ticket found with id ${ticketId}. If you have a key like PLAT-1234, look it up with ` +
					`spaces_tickets_search first — this tool takes the internal id.`,
			);
		}
		return ok(renderTicket(row, 1));
	},
};

// ── spaces_ticket_activities ────────────────────────────────────────────────

interface ActivityRow {
	id?: string;
	ticketId?: string;
	updatedBy?: string;
	timestamp?: number | string;
	activityType?: string;
	value?: unknown;
}

const ticketActivities: ToolDef = {
	name: "spaces_ticket_activities",
	description:
		"Read the change history of one Xyne Spaces ticket, newest first: who changed what and when — status moves, " +
		"stage transitions, reassignments, priority and field edits. Use it to answer 'why is this stuck', 'who moved " +
		"this', or 'when did it go to QA'. Each entry's recorded value is included as-is, since the shape differs by " +
		"change type.",
	inputSchema: {
		type: "object",
		properties: {
			ticket_id: { type: "string", description: "Internal ticket id." },
			limit: { type: "number", minimum: 1, maximum: 200, default: 50, description: "Max entries (default 50, max 200)." },
			offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset." },
		},
		required: ["ticket_id"],
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		await users.prime(sdk);
		const ticketId = requiredString(args, "ticket_id");
		const limit = boundedLimit(args, 50, 200);
		const offset = offsetOf(args);

		const activities = await sdk.tickets.listActivities(ticketId, { limit, offset });
		const rows = activities.items as ActivityRow[];
		const rendered = rows.slice(offset, offset + limit).map((row, i) => {
			const lines: string[] = [];
			if (row.value !== undefined && row.value !== null) {
				const text = typeof row.value === "string" ? row.value : JSON.stringify(row.value);
				lines.push(indented(text));
			}
			if (row.activityType) lines.push(`  Type: ${row.activityType}`);
			if (row.id) lines.push(`  Activity ID: ${row.id}`);
			const who = users.name(row.updatedBy) ?? users.label(row.updatedBy);
			return record(offset + i + 1, `${who} · ${toIST(row.timestamp)} IST`, lines);
		});

		return list("activity entr(ies)", rendered, { returned: rendered.length, limit, offset, total: rows.length });
	},
};

// ── spaces_ticket_create ────────────────────────────────────────────────────

const ticketCreate: ToolDef = {
	name: "spaces_ticket_create",
	description:
		"Create a Xyne Spaces ticket. Four ids are required and none can be guessed: title and description you " +
		"supply, project_id comes from spaces_projects_list, board_id from spaces_board_stages, and channel_id from " +
		"spaces_channels_list — the ticket gets a thread in that channel. The server allocates the human key " +
		"(PLAT-1234) from the project's sequence, so do not invent one. Returns the new ticket id and key. " +
		"If stage_name is given it must match a stage on that board exactly.",
	inputSchema: {
		type: "object",
		properties: {
			title: { type: "string", description: "Ticket title, one line." },
			description: {
				type: "string",
				description: "Ticket body. Plain text or simple HTML — <p>, <strong> and <ul><li> render as written.",
			},
			project_id: { type: "string", description: "Project id, from spaces_projects_list." },
			board_id: { type: "string", description: "Board id, from spaces_board_stages. Required except on support channels." },
			channel_id: { type: "string", description: "Channel the ticket's thread is created in, from spaces_channels_list." },
			assigned_to: { type: "string", description: "Assignee — user id or email address." },
			priority: { type: "string", enum: [...PRIORITIES], default: "MEDIUM", description: "Ticket priority." },
			status: { type: "string", enum: [...STATUSES], default: "TODO", description: "Starting status." },
			stage_name: { type: "string", description: "Starting stage. Must exactly match a stage on the board." },
			ticket_type: { type: "string", description: "Ticket type label, e.g. 'Bug' or 'Feature'." },
			tags: { type: "array", items: { type: "string" }, description: "Tag names to apply." },
			eta: { type: "string", description: "Due date as an ISO 8601 timestamp, e.g. '2026-09-01T00:00:00Z'." },
			user_group_id: { type: "string", description: "Owning user group id." },
			parent_ticket_id: { type: "string", description: "Create this as a sub-ticket of that ticket." },
			draft_attachment_ids: {
				type: "array",
				items: { type: "string" },
				description: "Ids of already-uploaded draft attachments to attach.",
			},
		},
		required: ["title", "description", "project_id", "channel_id"],
		additionalProperties: false,
	},
	write: true,
	async handler(args, { sdk }) {
		const title = requiredString(args, "title");
		const description = requiredString(args, "description");
		const projectId = requiredString(args, "project_id");
		const channelId = requiredString(args, "channel_id");

		const requestedAssignee = optionalString(args, "assigned_to");
		const assignedTo = await users.toUserId(sdk, requestedAssignee);
		if (requestedAssignee && !assignedTo) throw new Error(`No Spaces user matches "${requestedAssignee}".`);

		const eta = optionalString(args, "eta");
		// `CreateTicketResponse` declares { id, conversationId, xyneId }, but the
		// controller returns the full detail — stage and status included — so
		// the two extra fields are read through a widened local type rather
		// than dropped from the output.
		const created = (await sdk.tickets.create({
			title,
			description,
			projectId,
			channelId,
			...(optionalString(args, "board_id") ? { boardId: optionalString(args, "board_id")! } : {}),
			...(assignedTo ? { assignedTo } : {}),
			priority: (optionalString(args, "priority") ?? "MEDIUM") as TicketPriority,
			statusV2: (optionalString(args, "status") ?? "TODO") as TicketStatusV2,
			...(optionalString(args, "stage_name") ? { stageName: optionalString(args, "stage_name")! } : {}),
			...(optionalString(args, "ticket_type") ? { ticketType: optionalString(args, "ticket_type")! } : {}),
			...(optionalStringArray(args, "tags") ? { tags: optionalStringArray(args, "tags")! } : {}),
			// `CreateTicketInput.eta` is `Date | string`, where the raw route took
			// epoch ms. The column is a DateTime, so passing the ISO string
			// through is the more correct of the two.
			...(eta ? { eta } : {}),
			...(optionalString(args, "user_group_id") ? { userGroupId: optionalString(args, "user_group_id")! } : {}),
			...(optionalString(args, "parent_ticket_id") ? { parentTicketId: optionalString(args, "parent_ticket_id")! } : {}),
			...(optionalStringArray(args, "draft_attachment_ids")
				? { draftAttachmentIds: optionalStringArray(args, "draft_attachment_ids")! }
				: {}),
		})) as { id?: string; xyneId?: string; conversationId?: string; stageName?: string; status?: string };

		return ok(
			[
				`Created ${created.xyneId ?? "(no key)"}: ${title}`,
				`  Ticket ID: ${created.id ?? "(none)"}`,
				`  Stage: ${created.stageName ?? "(none)"} · Status: ${created.status ?? "?"}`,
				`  Conversation ID: ${created.conversationId ?? "(none)"}`,
			].join("\n"),
		);
	},
};

// ── spaces_ticket_update ────────────────────────────────────────────────────

const ticketUpdate: ToolDef = {
	name: "spaces_ticket_update",
	description:
		"Change fields on an existing Xyne Spaces ticket: title, description, status, priority, assignee, type, due " +
		"date, board, owning group, or archived flag. Only the fields you pass are changed. Reassigning is done here — " +
		"pass assigned_to as a user id or an email. " +
		"To MOVE a ticket between workflow stages, prefer spaces_ticket_transition — it picks the right path for " +
		"the board. Setting stage_name here works on linear boards but skips the form gates and approvals that " +
		"NON_LINEAR boards enforce.",
	inputSchema: {
		type: "object",
		properties: {
			ticket_id: { type: "string", description: "Internal ticket id, from spaces_tickets_search or spaces_tickets_list." },
			title: { type: "string", description: "New title." },
			description: { type: "string", description: "New body. Replaces the description entirely." },
			status: { type: "string", enum: [...STATUSES], description: "New status." },
			priority: { type: "string", enum: [...PRIORITIES], description: "New priority." },
			assigned_to: { type: "string", description: "New assignee — user id or email address." },
			stage_name: {
				type: "string",
				description: "Change the stage. Prefer spaces_ticket_transition, which handles NON_LINEAR boards too.",
			},
			ticket_type: { type: "string", description: "New ticket type label." },
			user_group_id: { type: "string", description: "New owning user group id." },
			board_id: { type: "string", description: "Move the ticket to a different board." },
			eta: { type: "string", description: "New due date as an ISO 8601 timestamp." },
			is_archived: { type: "boolean", description: "Archive or unarchive the ticket." },
		},
		required: ["ticket_id"],
		additionalProperties: false,
	},
	// `updatedAt` is required: the client supplies it so the optimistic and
	// server runs of the mutator persist the same timestamp.
	write: true,
	async handler(args, { sdk }) {
		const id = requiredString(args, "ticket_id");

		const requestedAssignee = optionalString(args, "assigned_to");
		const assignedTo = await users.toUserId(sdk, requestedAssignee);
		if (requestedAssignee && !assignedTo) throw new Error(`No Spaces user matches "${requestedAssignee}".`);

		const eta = optionalString(args, "eta");
		const isArchived = optionalBoolean(args, "is_archived");
		const changes: Record<string, unknown> = {
			...(optionalString(args, "title") ? { title: optionalString(args, "title")! } : {}),
			...(optionalString(args, "description") ? { description: optionalString(args, "description")! } : {}),
			...(optionalString(args, "status") ? { statusV2: optionalString(args, "status") as TicketStatusV2 } : {}),
			...(optionalString(args, "priority") ? { priority: optionalString(args, "priority") as TicketPriority } : {}),
			...(assignedTo ? { assignedTo } : {}),
			...(optionalString(args, "stage_name") ? { stageName: optionalString(args, "stage_name")! } : {}),
			...(optionalString(args, "ticket_type") ? { ticketType: optionalString(args, "ticket_type")! } : {}),
			...(optionalString(args, "user_group_id") ? { userGroupId: optionalString(args, "user_group_id")! } : {}),
			...(optionalString(args, "board_id") ? { boardId: optionalString(args, "board_id")! } : {}),
			// Epoch ms here, unlike `create` — this path is a Zero mutator writing
			// the column directly rather than a controller parsing a date.
			...(eta ? { eta: Date.parse(eta) } : {}),
			...(isArchived !== undefined ? { isArchived } : {}),
		};

		if (Object.keys(changes).length === 0) {
			throw new Error("Nothing to change — pass at least one field besides ticket_id.");
		}

		// The SDK stamps `updatedAt`.
		await sdk.tickets.update(id, changes);
		return ok(`Updated ticket ${id}.\n  Changed: ${Object.keys(changes).join(", ")}`);
	},
};

// ── spaces_ticket_transition ────────────────────────────────────────────────

const ticketTransition: ToolDef = {
	name: "spaces_ticket_transition",
	description:
		"Move a Xyne Spaces ticket to another workflow stage. This is what 'move PLAT-1234 to QA' means, and it is " +
		"the right tool for any stage change — it picks the correct path for the ticket's board on its own, so you " +
		"do not have to know whether that board is linear. The status implied by the target stage is applied either " +
		"way. The stage name must exactly match a stage on the ticket's board, so read the names from " +
		"spaces_board_stages first. If the board is NON_LINEAR and the target stage has a form attached, pass its " +
		"answers as form_values; on other boards form_values is ignored.",
	inputSchema: {
		type: "object",
		properties: {
			ticket_id: { type: "string", description: "Internal ticket id." },
			to_stage_name: {
				type: "string",
				description: "Exact name of the destination stage, from spaces_board_stages for the ticket's board.",
			},
			form_values: {
				type: "object",
				description: "Answers for the destination stage's form, if it has one, as field name to value.",
				additionalProperties: true,
			},
		},
		required: ["ticket_id", "to_stage_name"],
		additionalProperties: false,
	},
	// Two paths, because the catalog has two. `nonLinear.transition` implements
	// form gates, approvals and visit versioning, and refuses anything that is
	// not a NON_LINEAR board — its own comment says DEFAULT and RELEASE boards
	// must use the standard stage-update path instead. `ticket.update` is that
	// path: it resolves the target stage on the board and reconciles statusV2
	// against the stage's default. Picking wrong fails with a 400,
	// so the board type is read first rather than guessed.
	//
	// `now` and `updatedAt` are caller-supplied timestamps, and `formValuesJson`
	// is an encoded string rather than an object — the mutator argument type
	// cannot carry arbitrary nested JSON.
	write: true,
	async handler(args, { sdk }) {
		const ticketId = requiredString(args, "ticket_id");
		const toStageName = requiredString(args, "to_stage_name");
		const formValues = args["form_values"];

		const ticket = await sdk.tickets.getRow(ticketId);
		if (!ticket) throw new Error(`No ticket found with id ${ticketId}.`);
		if (!ticket.boardId) throw new Error(`Ticket ${ticketId} is not on a board, so it has no stages.`);

		const board = await sdk.boards.get(ticket.boardId);

		if (board?.boardType === "NON_LINEAR") {
			// The SDK supplies `now`.
			await sdk.tickets.transitionStage(
				ticketId,
				toStageName,
				formValues && typeof formValues === "object" ? { formValuesJson: JSON.stringify(formValues) } : {},
			);
		} else {
			// `nonLinear.transition` applies the target stage's `defaultTicketStatusV2`
			// as part of the move. `ticket.update` does not derive it, so it is
			// resolved and passed explicitly — otherwise moving a ticket to Done
			// would leave its status on TODO, and the two paths would disagree.
			const stages = await sdk.boards.listStages(ticket.boardId);
			const target = stages.find((stage) => stage.name === toStageName);
			if (!target) {
				const names = stages.map((stage) => stage.name).filter(Boolean);
				throw new Error(
					`"${toStageName}" is not a stage on this ticket's board. Stages are: ${names.join(", ") || "(none)"}.`,
				);
			}
			await sdk.tickets.update(ticketId, {
				stageName: toStageName,
				...(target.defaultTicketStatusV2 ? { statusV2: target.defaultTicketStatusV2 } : {}),
			});
		}

		const from = ticket.stageName ? `"${ticket.stageName}" → ` : "";
		return ok(`Moved ticket ${ticketId} ${from}"${toStageName}" (${board?.boardType ?? "unknown"} board).`);
	},
};

export const ticketTools: ToolDef[] = [
	ticketsList,
	ticketsSearch,
	ticketGet,
	ticketActivities,
	ticketCreate,
	ticketUpdate,
	ticketTransition,
];
