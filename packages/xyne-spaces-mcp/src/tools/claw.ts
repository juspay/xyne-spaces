/**
 * Xyne Claw agents, reached through Spaces.
 *
 * Spaces forwards these calls to Claw as the signed-in user, so they take the
 * same session as every other tool here and Claw's own permissions decide each
 * one, exactly as in the Claw dashboard. There is no separate Claw login.
 *
 * Shaped around what an agent wants to do rather than around Claw's routes:
 * one read tool returns the whole picture of a thing, and one write tool takes
 * a batch of changes, so a task is a call or two rather than a chain of them.
 * Reads and writes stay in separate tools, because writes are listed only
 * while the user has turned them on. Secrets (provider keys), connector
 * sign-in and admin screens are deliberately not here.
 */

import { NotFoundError } from "@xyne/spaces-sdk";
import type {
	ClawAgentDetail,
	ClawChatMessage,
	ClawConversation,
	ClawRecord,
	ClawRunRecord,
	ClawScheduledJob,
	ClawSkill,
	ClawSubagent,
	ClawTool,
	SpacesClient,
} from "@xyne/spaces-sdk";
import {
	boundedLimit,
	cleanText,
	indented,
	list,
	offsetOf,
	ok,
	optionalBoolean,
	optionalNumber,
	optionalString,
	optionalStringArray,
	record,
	requiredString,
	timeLine,
} from "../render.js";
import { users, type ToolDef } from "./shared.js";

const TERMINAL = new Set(["completed", "failed", "cancelled", "canceled", "error"]);

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A string field of a loosely typed Claw record. */
function str(row: ClawRecord | undefined, key: string): string | undefined {
	const value = row?.[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The first line of a long text, for list rows. */
function snippet(text: string | undefined, max = 160): string | undefined {
	if (!text) return undefined;
	const line = cleanText(text).split("\n").find((l) => l.trim().length > 0) ?? "";
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Case-insensitive match of `query` against any of the given fields. */
function matches(query: string | undefined, ...fields: Array<string | undefined>): boolean {
	if (!query) return true;
	const q = query.toLowerCase();
	return fields.some((f) => f?.toLowerCase().includes(q));
}

/** What went wrong with one step of a batch, without failing the rest. */
function failure(step: string, error: unknown): string {
	return `  ✗ ${step}: ${error instanceof Error ? error.message : String(error)}`;
}

/** A person given as an email or id, as a user id. */
async function userIdOf(sdk: SpacesClient, value: string): Promise<string> {
	const id = await users.toUserId(sdk, value);
	if (!id) throw new Error(`No Spaces user matches "${value}".`);
	return id;
}

/** The caller's Spaces user id, which Claw's skill list needs to include their personal skills. */
let ownUserId: Promise<string> | undefined;
function myUserId(sdk: SpacesClient): Promise<string> {
	ownUserId ??= sdk.users.me().then((me) => me.id);
	ownUserId.catch(() => {
		ownUserId = undefined;
	});
	return ownUserId;
}

/** Global skills and the caller's own. */
async function visibleSkills(sdk: SpacesClient): Promise<ClawSkill[]> {
	return sdk.claw.skills.list({ userId: await myUserId(sdk) });
}

/**
 * Skill slugs or ids, as ids. Agents attach skills by id, but an agent knows
 * skills by slug.
 */
async function skillIdsOf(sdk: SpacesClient, refs: string[]): Promise<string[]> {
	let listed: ClawSkill[] | undefined;
	const ids: string[] = [];
	for (const ref of refs) {
		const bySlug = await sdk.claw.skills.get(ref).catch((error: unknown) => {
			if (error instanceof NotFoundError) return undefined;
			throw error;
		});
		if (bySlug) {
			ids.push(bySlug.id);
			continue;
		}
		listed ??= await visibleSkills(sdk);
		const byId = listed.find((s) => s.id === ref);
		if (!byId) throw new Error(`No Claw skill matches "${ref}". Find skills with spaces_claw_skills.`);
		ids.push(byId.id);
	}
	return ids;
}

/** Tool slugs or ids, as ids, from the tool registry. */
async function toolIdsOf(sdk: SpacesClient, refs: string[]): Promise<string[]> {
	const tools = await sdk.claw.tools.list();
	return refs.map((ref) => {
		const tool = tools.find((t) => t.id === ref || t.slug === ref || t.name === ref);
		if (!tool) throw new Error(`No Claw tool matches "${ref}". Find tools with spaces_claw_tools_search.`);
		return tool.id;
	});
}

/** A list of things attached to an agent, by whatever name each one carries. */
function names(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => {
		const e = (entry ?? {}) as Record<string, unknown>;
		const inner = (e["tool"] ?? e["skill"] ?? e["collection"] ?? e) as Record<string, unknown>;
		return String(inner["slug"] ?? inner["name"] ?? inner["id"] ?? inner["collectionId"] ?? "?");
	});
}

// ── Renderers ───────────────────────────────────────────────────────────────

function agentFlags(agent: ClawAgentDetail): string {
	return [agent.scope, agent.isDefault ? "default" : "", agent.enabled === false ? "disabled" : ""]
		.filter(Boolean)
		.join(" · ");
}

function renderRun(run: ClawRunRecord, i: number): string {
	const lines = [
		`  Agent: ${run.agentSlug} · Status: ${run.status}${str(run, "triggerSource") ? ` · Trigger: ${str(run, "triggerSource")}` : ""}`,
	];
	const task = snippet(run.task ?? str(run, "snippet"));
	if (task) lines.push(`  Task: ${task}`);
	const when = timeLine([
		["Started", run["startedAt"]],
		["Completed", run["completedAt"]],
	]);
	if (when) lines.push(`  ${when}`);
	if (run.conversationId) lines.push(`  Conversation: ${run.conversationId}`);
	return record(i, `Run ${run.sessionId}`, lines);
}

function renderJob(job: ClawScheduledJob, i: number): string {
	const schedule = job.type === "cron" ? `cron ${job.cronExpression ?? "?"}` : "once";
	const lines = [`  Agent: ${job.agentSlug} · ${schedule} · Status: ${job.status}`];
	const task = snippet(job.task);
	if (task) lines.push(`  Task: ${task}`);
	const when = timeLine([
		["Next run", job.nextRunAt],
		["Last run", job.lastRunAt],
	]);
	if (when) lines.push(`  ${when}`);
	if (typeof job.runCount === "number") lines.push(`  Runs so far: ${job.runCount}`);
	return record(i, `${job.label || "Scheduled job"} (id: ${job.id})`, lines);
}

// ── Reads ───────────────────────────────────────────────────────────────────

const listAgents: ToolDef = {
	name: "spaces_claw_list_agents",
	description:
		"List the Xyne Claw agents the user can see, with each one's slug and scope. Claw agents are AI agents " +
		"that do longer-running work against Spaces and connected tools; any enabled one can be run with " +
		"spaces_claw_run. Filter with query. Read one in full with spaces_claw_agent_get.",
	inputSchema: {
		type: "object",
		properties: {
			query: { type: "string", description: "Match name, slug or description." },
		},
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		const query = optionalString(args, "query");
		const agents = (await sdk.claw.agents.list({ view: "light" })).filter((a) =>
			matches(query, a.name, a.slug, a.description),
		);
		if (agents.length === 0) return ok("No Claw agents match.");

		const rendered = agents.map((agent, i) => {
			const lines: string[] = [];
			const about = snippet(agent.description, 240);
			if (about) lines.push(`  ${about}`);
			const flags = agentFlags(agent);
			if (flags) lines.push(`  ${flags}`);
			lines.push(`  Slug: ${agent.slug}`);
			return record(i + 1, agent.name || agent.slug, lines);
		});
		return ok(`${agents.length} Claw agent(s):\n\n${rendered.join("\n\n")}`);
	},
};

const agentGet: ToolDef = {
	name: "spaces_claw_agent_get",
	description:
		"Read one Xyne Claw agent in full: its system prompt, model, tool permissions, attached tools, skills and " +
		"knowledge base, and — when the user owns or edits it — its MCP connections and who it is shared with. " +
		"Use before spaces_claw_agent_update, so a change starts from what is there.",
	inputSchema: {
		type: "object",
		properties: {
			slug: { type: "string", description: "Agent slug, from spaces_claw_list_agents." },
			include_prompt: { type: "boolean", default: true, description: "Include the full system prompt." },
		},
		required: ["slug"],
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		const slug = requiredString(args, "slug");
		const agent = await sdk.claw.agents.get(slug);
		// Owner-only reads: a viewer gets the agent without them rather than an error.
		const [connections, shares] = agent.canEdit
			? await Promise.allSettled([sdk.claw.agents.listMcpConnections(slug), sdk.claw.agents.listShares(slug)])
			: [];
		await users.prime(sdk);

		const lines: string[] = [];
		if (agent.description) lines.push(`  ${cleanText(agent.description)}`);
		lines.push(`  Slug: ${agent.slug} · ${agentFlags(agent)}`);
		lines.push(`  Model: ${agent.modelId || "(agent default)"} · You can edit: ${agent.canEdit ? "yes" : "no"}`);
		if (agent.ownerUserId) lines.push(`  Owner: ${users.label(agent.ownerUserId)}`);
		const permissions = (agent.config?.["toolPermissions"] ?? {}) as Record<string, string>;
		if (Object.keys(permissions).length > 0) {
			lines.push("  Tool permissions:");
			for (const [tool, mode] of Object.entries(permissions)) lines.push(`    ${tool}: ${mode}`);
		}
		const tools = names(agent["tools"]);
		const skills = names(agent["skills"]);
		const collections = names(agent["collections"]);
		lines.push(`  Tools: ${tools.length > 0 ? tools.join(", ") : "(none attached)"}`);
		lines.push(`  Skills: ${skills.length > 0 ? skills.join(", ") : "(none)"}`);
		if (collections.length > 0) lines.push(`  Knowledge base: ${collections.join(", ")}`);
		if (connections?.status === "fulfilled" && connections.value.length > 0) {
			lines.push("  MCP connections:");
			for (const c of connections.value) {
				lines.push(`    ${str(c, "mcpServerType") ?? "?"} / ${str(c, "slug") ?? str(c, "instanceSlug") ?? "?"}${str(c, "displayName") ? ` (${str(c, "displayName")})` : ""}`);
			}
		}
		if (shares?.status === "fulfilled" && shares.value.length > 0) {
			lines.push("  Shared with:");
			for (const s of shares.value) lines.push(`    ${users.label(s.userId)} — ${s.role}`);
		}
		const when = timeLine([
			["Created", agent.createdAt],
			["Updated", agent.updatedAt],
		]);
		if (when) lines.push(`  ${when}`);
		if (optionalBoolean(args, "include_prompt") !== false && agent.systemPrompt) {
			lines.push("  System prompt:");
			lines.push(indented(agent.systemPrompt, "    "));
		}
		return ok(record(1, agent.name || agent.slug, lines));
	},
};

const subagents: ToolDef = {
	name: "spaces_claw_subagents",
	description:
		"List Xyne Claw subagents — the specialists an agent hands work to — or, given a name, read one in full " +
		"(prompt, tools, skills, MCP instance pins). Built-in subagents cannot be edited; custom ones can, with " +
		"spaces_claw_subagent_upsert.",
	inputSchema: {
		type: "object",
		properties: {
			name: { type: "string", description: "Read this subagent in full instead of listing." },
			query: { type: "string", description: "When listing, match name or description." },
		},
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		const name = optionalString(args, "name");
		if (name) {
			const sub = await sdk.claw.subagents.get(name);
			const lines = [`  ${cleanText(sub.description)}`, `  Source: ${sub.source} · Enabled: ${sub.enabled !== false ? "yes" : "no"}`];
			if (sub.paramName) lines.push(`  Takes: ${sub.paramName}${sub.paramDescription ? ` — ${sub.paramDescription}` : ""}`);
			if (sub.tools) lines.push(`  Tools: ${JSON.stringify(sub.tools)}`);
			if (sub.mcpInstanceMap && Object.keys(sub.mcpInstanceMap).length > 0) {
				lines.push(`  MCP instances: ${JSON.stringify(sub.mcpInstanceMap)}`);
			}
			if (sub.skills?.length) lines.push(`  Skills: ${sub.skills.map((s) => s.slug).join(", ")}`);
			if (sub.systemPrompt) {
				lines.push("  System prompt:");
				lines.push(indented(sub.systemPrompt, "    "));
			}
			return ok(record(1, sub.name, lines));
		}
		const query = optionalString(args, "query");
		const rows = (await sdk.claw.subagents.list()).filter((s: ClawSubagent) => matches(query, s.name, s.description));
		if (rows.length === 0) return ok("No Claw subagents match.");
		const rendered = rows.map((s, i) =>
			record(i + 1, s.name, [`  ${snippet(s.description, 240) ?? ""}`, `  ${s.source}${s.enabled === false ? " · disabled" : ""}`]),
		);
		return ok(`${rows.length} Claw subagent(s):\n\n${rendered.join("\n\n")}`);
	},
};

const skills: ToolDef = {
	name: "spaces_claw_skills",
	description:
		"List Xyne Claw skills — reusable instructions agents load — or, given a slug, read one with its full " +
		"SKILL.md content and its files. Create or change one with spaces_claw_skill_upsert; attach it to an agent " +
		"with spaces_claw_agent_update.",
	inputSchema: {
		type: "object",
		properties: {
			slug: { type: "string", description: "Read this skill in full instead of listing." },
			query: { type: "string", description: "When listing, match slug, name or description." },
		},
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		const slug = optionalString(args, "slug");
		if (slug) {
			const [skill, files] = await Promise.all([sdk.claw.skills.get(slug), sdk.claw.skills.listFiles(slug).catch(() => [])]);
			const lines = [
				`  ${cleanText(skill.description) || "(no description)"}`,
				`  Slug: ${skill.slug} · Id: ${skill.id} · ${skill.scope}${skill.enabled === false ? " · disabled" : ""}`,
			];
			if (files.length > 0) lines.push(`  Files: ${files.map((f) => f.relativePath).join(", ")}`);
			if (skill.content) {
				lines.push("  SKILL.md:");
				lines.push(indented(skill.content, "    "));
			}
			return ok(record(1, skill.name, lines));
		}
		const query = optionalString(args, "query");
		const rows = (await visibleSkills(sdk)).filter((s) => matches(query, s.slug, s.name, s.description));
		if (rows.length === 0) return ok("No Claw skills match.");
		const rendered = rows.map((s, i) =>
			record(i + 1, s.name, [`  ${snippet(s.description, 240) ?? ""}`, `  Slug: ${s.slug} · ${s.scope}`]),
		);
		return ok(`${rows.length} Claw skill(s):\n\n${rendered.join("\n\n")}`);
	},
};

const toolsSearch: ToolDef = {
	name: "spaces_claw_tools_search",
	description:
		"Search the tools Xyne Claw agents can be given — built-in tools and those of connected MCP servers " +
		"(GitHub, Grafana, Google, …). Returns each tool's slug, source and id. Pass slugs or ids to " +
		"spaces_claw_agent_update or spaces_claw_subagent_upsert.",
	inputSchema: {
		type: "object",
		properties: {
			query: { type: "string", description: "Match slug, name or description." },
			source: { type: "string", description: "Only this source: an MCP server type such as github, or builtin." },
			limit: { type: "number", minimum: 1, maximum: 200, default: 50, description: "Max tools (default 50)." },
			offset: { type: "number", minimum: 0, default: 0, description: "Skip this many, for the next page." },
		},
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		const query = optionalString(args, "query");
		const source = optionalString(args, "source")?.toLowerCase();
		const limit = boundedLimit(args, 50, 200);
		const offset = offsetOf(args);
		// The registry, not `listAvailable`: that one refreshes from every connected
		// MCP server first, which takes seconds a search should not wait on.
		const registry = await sdk.claw.tools.list();
		const hits = registry.filter(
			(t: ClawTool) =>
				t.enabled !== false &&
				(!source || (t.source ?? "").toLowerCase().includes(source)) &&
				matches(query, t.slug, t.name, t.description),
		);
		const page = hits.slice(offset, offset + limit);
		const rendered = page.map((t, i) => {
			const lines = [`  Slug: ${t.slug} · Source: ${t.source ?? "?"} · Id: ${t.id}`];
			const about = snippet(t.description, 200);
			if (about) lines.push(`  ${about}`);
			return record(offset + i + 1, t.name, lines);
		});
		return list("Claw tool(s)", rendered, { returned: page.length, limit, offset, total: hits.length });
	},
};

const runs: ToolDef = {
	name: "spaces_claw_runs",
	description:
		"The user's Xyne Claw run history, newest first: each run's session id, agent, status, task and timing. " +
		"Pass query to search tasks and results instead. Read one run in full with spaces_claw_get_run.",
	inputSchema: {
		type: "object",
		properties: {
			query: { type: "string", description: "Search run tasks and results (at least 2 characters)." },
			agent: { type: "string", description: "Only runs of this agent slug." },
			status: { type: "string", description: "Only runs in this status, e.g. running, completed, failed." },
			limit: { type: "number", minimum: 1, maximum: 100, default: 20, description: "Max runs (default 20)." },
			offset: { type: "number", minimum: 0, default: 0, description: "Skip this many, for the next page." },
		},
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		const query = optionalString(args, "query");
		const agentSlug = optionalString(args, "agent");
		const limit = boundedLimit(args, 20, 100);
		if (query) {
			const found = await sdk.claw.runs.search(query, { ...(agentSlug ? { agentSlug } : {}), limit: Math.min(limit, 50) });
			return list("matching Claw run(s)", found.map((r, i) => renderRun(r, i + 1)), { returned: found.length, limit: Math.min(limit, 50), offset: 0 });
		}
		const offset = offsetOf(args);
		const status = optionalString(args, "status");
		const page = await sdk.claw.runs.paged({ limit, offset, ...(agentSlug ? { agentSlug } : {}), ...(status ? { status } : {}) });
		return list("Claw run(s)", page.data.map((r, i) => renderRun(r, offset + i + 1)), {
			returned: page.data.length,
			limit,
			offset,
			total: page.total,
		});
	},
};

const getRun: ToolDef = {
	name: "spaces_claw_get_run",
	description:
		"Read one Xyne Claw run by its session id: status, result or error, the tools it used, model, tokens and " +
		"time taken. Use it after spaces_claw_run returned a session id without a result — because it timed out, " +
		"or was dispatched with wait set to false — or on a run from spaces_claw_runs.",
	inputSchema: {
		type: "object",
		properties: {
			session_id: { type: "string", description: "Claw session id, from spaces_claw_run or spaces_claw_runs." },
		},
		required: ["session_id"],
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		const sessionId = requiredString(args, "session_id");
		const run = (await sdk.claw.runs.get(sessionId)) as unknown as ClawRunRecord;
		const lines = [`  Status: ${run.status ?? "unknown"}${run.agentSlug ? ` · Agent: ${run.agentSlug}` : ""}`];
		const model = [str(run, "provider"), str(run, "model")].filter(Boolean).join(" / ");
		if (model) lines.push(`  Model: ${model}`);
		if (run.task) lines.push(`  Task: ${snippet(run.task, 400)}`);
		if (run.toolsUsed?.length) lines.push(`  Tools used: ${run.toolsUsed.join(", ")}`);
		const tokensIn = run["tokensIn"];
		const totalMs = run["totalMs"];
		if (typeof tokensIn === "number" || typeof totalMs === "number") {
			lines.push(`  Tokens in/out: ${String(tokensIn ?? "?")}/${String(run["tokensOut"] ?? "?")} · Took: ${typeof totalMs === "number" ? `${Math.round(totalMs / 1000)}s` : "?"}`);
		}
		if (run.conversationId) lines.push(`  Conversation: ${run.conversationId}`);
		if (run.error) lines.push(`  Error: ${run.error}`);
		if (run.result) {
			lines.push("  Result:");
			lines.push(indented(run.result, "    "));
		}
		if (!run.error && !run.result) lines.push(TERMINAL.has(String(run.status).toLowerCase()) ? "  No output." : "  No result yet.");
		return ok(record(1, `Claw run ${sessionId}`, lines));
	},
};

const conversations: ToolDef = {
	name: "spaces_claw_conversations",
	description:
		"List the user's Xyne Claw chat conversations, newest first — or, given conversation_id and agent, read " +
		"that conversation's messages. Filter the list by agent or title.",
	inputSchema: {
		type: "object",
		properties: {
			conversation_id: { type: "string", description: "Read this conversation's messages (needs agent too)." },
			agent: { type: "string", description: "The agent slug: filters the list, and names the conversation to read." },
			query: { type: "string", description: "When listing, match titles." },
			limit: { type: "number", minimum: 1, maximum: 100, default: 25, description: "Max conversations (default 25)." },
			cursor: { type: "string", description: "When listing, the cursor from the previous page." },
		},
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		const conversationId = optionalString(args, "conversation_id");
		const agent = optionalString(args, "agent");
		if (conversationId) {
			if (!agent) throw new Error("Pass agent with conversation_id: the agent slug the conversation is with.");
			const { data, runByMsgId } = await sdk.claw.chat.messages(agent, conversationId);
			if (data.length === 0) return ok("No messages in this conversation.");
			const rendered = data.map((m: ClawChatMessage, i) => {
				const lines = [`  ${timeLine([["At", m.createdAt]]) ?? ""}${m.status && m.status !== "completed" ? ` · ${m.status}` : ""}`];
				const run = runByMsgId?.[m.id];
				if (run) lines.push(`  Run: ${run}`);
				lines.push(indented(cleanText(m.content) || "(empty)", "  "));
				return record(i + 1, m.role === "user" ? "User" : `Agent (${m.agentSlug ?? agent})`, lines);
			});
			return ok(`${data.length} message(s):\n\n${rendered.join("\n\n")}`);
		}
		const limit = boundedLimit(args, 25, 100);
		const query = optionalString(args, "query");
		const cursor = optionalString(args, "cursor");
		const page = await sdk.claw.chat.listConversations({
			limit,
			...(agent ? { agentSlug: agent } : {}),
			...(query ? { q: query } : {}),
			...(cursor ? { cursor } : {}),
		});
		if (page.data.length === 0) return ok("No Claw conversations found.");
		const rendered = page.data.map((c: ClawConversation, i) => {
			const lines = [`  Agent: ${(c.agentSlugs?.length ? c.agentSlugs : [c.agentSlug]).join(", ")}${c.pinned ? " · pinned" : ""}`];
			const when = timeLine([["Last message", c.lastMessageAt]]);
			lines.push(`  ${when ?? ""}${typeof c.messageCount === "number" ? ` · ${c.messageCount} message(s)` : ""}`);
			lines.push(`  Conversation id: ${c.conversationId}`);
			return record(i + 1, c.title || "(untitled)", lines);
		});
		const more = page.nextCursor ? `\n\n[More available — call again with cursor="${page.nextCursor}".]` : "";
		return ok(`${page.data.length} Claw conversation(s):\n\n${rendered.join("\n\n")}${more}`);
	},
};

const memory: ToolDef = {
	name: "spaces_claw_memory",
	description:
		"What a Xyne Claw agent remembers. Pass query to see what it would recall for that question; otherwise " +
		"list its stored memories (optionally matching search). Scope user is the user's own memories, shared is " +
		"what the agent learned for everyone.",
	inputSchema: {
		type: "object",
		properties: {
			agent: { type: "string", description: "Agent slug." },
			query: { type: "string", description: "Recall: what the agent would remember for this question." },
			search: { type: "string", description: "When listing, match memory text." },
			scope: { type: "string", enum: ["user", "shared"], description: "Whose memories." },
			limit: { type: "number", minimum: 1, maximum: 100, default: 20, description: "Max memories when listing (default 20)." },
			offset: { type: "number", minimum: 0, default: 0, description: "Skip this many, for the next page." },
		},
		required: ["agent"],
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		const agent = requiredString(args, "agent");
		const scope = optionalString(args, "scope") as "user" | "shared" | undefined;
		const text = (m: ClawRecord): string =>
			str(m, "text") ?? str(m, "content") ?? str(m, "memory") ?? str(m, "fact") ?? JSON.stringify(m);
		const render = (m: ClawRecord, i: number): string => {
			const lines = [indented(cleanText(text(m)), "  ")];
			const meta = [str(m, "scope"), str(m, "subsystem"), str(m, "id") ? `id: ${str(m, "id")}` : undefined].filter(Boolean);
			if (meta.length > 0) lines.push(`  ${meta.join(" · ")}`);
			return record(i, "Memory", lines);
		};

		const query = optionalString(args, "query");
		if (query) {
			const { memories } = await sdk.claw.memory.recall(agent, { query, ...(scope ? { scope } : {}) });
			if (memories.length === 0) return ok(`${agent} recalls nothing for that.`);
			return ok(`${memories.length} memory(ies) ${agent} would recall:\n\n${memories.map((m, i) => render(m, i + 1)).join("\n\n")}`);
		}
		const limit = boundedLimit(args, 20, 100);
		const offset = offsetOf(args);
		const search = optionalString(args, "search");
		const page = await sdk.claw.memory.list(agent, { limit, offset, ...(search ? { search } : {}), ...(scope ? { scope } : {}) });
		return list(`memories of ${agent}`, page.data.map((m, i) => render(m, offset + i + 1)), {
			returned: page.data.length,
			limit,
			offset,
			total: page.total,
		});
	},
};

const schedules: ToolDef = {
	name: "spaces_claw_schedules",
	description:
		"List the user's scheduled Xyne Claw jobs — agent tasks that run once later or on a cron — or, given an id, " +
		"read one. Create or change them with spaces_claw_schedule.",
	inputSchema: {
		type: "object",
		properties: {
			id: { type: "string", description: "Read this job instead of listing." },
			agent: { type: "string", description: "Only jobs of this agent slug." },
			status: { type: "string", description: "Only jobs in this status: active, paused, cancelled or completed." },
		},
		additionalProperties: false,
	},
	async handler(args, { sdk }) {
		const id = optionalString(args, "id");
		if (id) {
			const job = await sdk.claw.scheduledJobs.get(id);
			const rendered = renderJob(job, 1);
			return ok(job.task ? `${rendered}\n  Full task:\n${indented(job.task, "    ")}` : rendered);
		}
		const agentSlug = optionalString(args, "agent");
		const status = optionalString(args, "status");
		const jobs = await sdk.claw.scheduledJobs.list({ ...(agentSlug ? { agentSlug } : {}), ...(status ? { status } : {}) });
		if (jobs.length === 0) return ok("No scheduled Claw jobs.");
		return ok(`${jobs.length} scheduled Claw job(s):\n\n${jobs.map((j, i) => renderJob(j, i + 1)).join("\n\n")}`);
	},
};

// ── Writes: runs ────────────────────────────────────────────────────────────

const run: ToolDef = {
	name: "spaces_claw_run",
	description:
		"Dispatch a task to a Xyne Claw agent and wait for it to finish, returning the agent's answer. Get the agent " +
		"slug from spaces_claw_list_agents; any enabled agent the user can see can run. The run executes as YOU, " +
		"so the agent sees exactly the Spaces data you can see. " +
		"Runs can take minutes; if the wait times out the session id is returned so you can poll with " +
		"spaces_claw_get_run rather than starting the work again. Set wait to false to dispatch and return " +
		"immediately. Pass channel_id to have the agent post its reply into that Spaces channel as well.",
	inputSchema: {
		type: "object",
		properties: {
			agent: { type: "string", description: "Agent slug, from spaces_claw_list_agents." },
			task: { type: "string", description: "The task or prompt to send to the agent." },
			context: { type: "string", description: "Extra background for the agent, if the task alone is not enough." },
			channel_id: { type: "string", description: "Spaces channel for the agent to post its reply into." },
			conversation_id: { type: "string", description: "Spaces thread to continue, so the agent has that history." },
			wait: {
				type: "boolean",
				default: true,
				description: "Wait for the result. Set false to dispatch and return the session id immediately.",
			},
			timeout_seconds: { type: "number", minimum: 10, maximum: 900, default: 300, description: "Max seconds to wait (default 300)." },
		},
		required: ["agent", "task"],
		additionalProperties: false,
	},
	write: true,
	// Deliberately not `sdk.claw.runs.startAndWait`: that helper has no tolerance
	// for the brief 404 between dispatch and the run row existing, no `wait:
	// false` path, and a timeout message that does not name spaces_claw_get_run.
	async handler(args, { sdk }) {
		const agent = requiredString(args, "agent");
		const task = requiredString(args, "task");

		const dispatched = await sdk.claw.runs.start({
			agent,
			task,
			...(optionalString(args, "context") ? { context: optionalString(args, "context")! } : {}),
			...(optionalString(args, "channel_id") ? { channelId: optionalString(args, "channel_id")! } : {}),
			...(optionalString(args, "conversation_id") ? { conversationId: optionalString(args, "conversation_id")! } : {}),
		});

		const sessionId = dispatched.sessionId;
		if (!sessionId) throw new Error("Claw accepted the run but returned no session id.");
		if (args["wait"] === false) {
			return ok(`Dispatched to ${agent}.\n  Session ID: ${sessionId}\n\n  Poll it with spaces_claw_get_run.`);
		}

		const timeoutMs = Math.max(10, Math.min(Math.floor(optionalNumber(args, "timeout_seconds") ?? 300), 900)) * 1000;
		const deadline = Date.now() + timeoutMs;
		// Back off rather than hammering: a Claw run is measured in minutes, and
		// the first poll almost never finds it finished.
		let pollMs = 2000;
		let sawRun = false;

		while (Date.now() < deadline) {
			await sleep(pollMs);
			try {
				const status = await sdk.claw.runs.get(sessionId);
				sawRun = true;
				if (status.status && TERMINAL.has(status.status.toLowerCase())) {
					if (status.status.toLowerCase() === "completed") {
						return ok(`${status.result || "(completed with no output)"}\n\n  Session ID: ${sessionId}`);
					}
					throw new Error(`Claw run ${status.status}: ${status.error || status.result || "(no detail)"} [session ${sessionId}]`);
				}
			} catch (error) {
				// A run can 404 briefly between dispatch and the row being written.
				if (sawRun || !(error instanceof NotFoundError)) throw error;
			}
			pollMs = Math.min(Math.floor(pollMs * 1.5), 10_000);
		}

		throw new Error(
			`Timed out after ${timeoutMs / 1000}s waiting for Claw run ${sessionId}. It is probably still going — ` +
				`read it with spaces_claw_get_run rather than dispatching again.`,
		);
	},
};

const runCancel: ToolDef = {
	name: "spaces_claw_run_cancel",
	description: "Stop a Xyne Claw run that is still going, by its session id. The run keeps what it produced so far.",
	inputSchema: {
		type: "object",
		properties: { session_id: { type: "string", description: "Claw session id, from spaces_claw_run or spaces_claw_runs." } },
		required: ["session_id"],
		additionalProperties: false,
	},
	write: true,
	async handler(args, { sdk }) {
		const sessionId = requiredString(args, "session_id");
		await sdk.claw.runs.cancel(sessionId);
		return ok(`Asked Claw to stop run ${sessionId}. Check it with spaces_claw_get_run.`);
	},
};

// ── Writes: agents ──────────────────────────────────────────────────────────

/** Attach and detach skills and tools, reporting each step rather than stopping at the first failure. */
async function applyAttachments(sdk: SpacesClient, slug: string, args: Record<string, unknown>): Promise<string[]> {
	const report: string[] = [];
	const steps: Array<[string, string[] | undefined, (refs: string[]) => Promise<string[]>, (id: string) => Promise<unknown>]> = [
		["add skill", optionalStringArray(args, "add_skills"), (r) => skillIdsOf(sdk, r), (id) => sdk.claw.agents.addSkill(slug, id)],
		["remove skill", optionalStringArray(args, "remove_skills"), (r) => skillIdsOf(sdk, r), (id) => sdk.claw.agents.removeSkill(slug, id)],
		["add tool", optionalStringArray(args, "add_tools"), (r) => toolIdsOf(sdk, r), (id) => sdk.claw.agents.addTool(slug, id)],
		["remove tool", optionalStringArray(args, "remove_tools"), (r) => toolIdsOf(sdk, r), (id) => sdk.claw.agents.removeTool(slug, id)],
	];
	for (const [label, refs, resolve, apply] of steps) {
		if (!refs) continue;
		let ids: string[];
		try {
			ids = await resolve(refs);
		} catch (error) {
			report.push(failure(label, error));
			continue;
		}
		for (const [i, id] of ids.entries()) {
			try {
				await apply(id);
				report.push(`  ✓ ${label} ${refs[i]}`);
			} catch (error) {
				report.push(failure(`${label} ${refs[i]}`, error));
			}
		}
	}
	return report;
}

const ATTACHMENT_PROPERTIES = {
	add_skills: { type: "array", items: { type: "string" }, description: "Skill slugs or ids to attach (spaces_claw_skills)." },
	remove_skills: { type: "array", items: { type: "string" }, description: "Skill slugs or ids to detach." },
	add_tools: { type: "array", items: { type: "string" }, description: "Tool slugs or ids to grant (spaces_claw_tools_search)." },
	remove_tools: { type: "array", items: { type: "string" }, description: "Tool slugs or ids to revoke." },
};

const agentCreate: ToolDef = {
	name: "spaces_claw_agent_create",
	description:
		"Create a Xyne Claw agent owned by the user, optionally with skills and tools attached in the same call. " +
		"The slug must be unique; check spaces_claw_list_agents first. Write the system prompt as the agent's " +
		"standing instructions.",
	inputSchema: {
		type: "object",
		properties: {
			slug: { type: "string", description: "URL-safe id, lowercase with dashes, e.g. release-notes-bot." },
			name: { type: "string", description: "Display name." },
			system_prompt: { type: "string", description: "The agent's standing instructions." },
			description: { type: "string", description: "One or two sentences on what it is for." },
			scope: { type: "string", enum: ["personal", "org"], default: "personal", description: "Who can see it." },
			model_id: { type: "string", description: "Model id; omit for the default." },
			color: { type: "string", description: "Hex colour, e.g. #6366f1." },
			add_skills: ATTACHMENT_PROPERTIES.add_skills,
			add_tools: ATTACHMENT_PROPERTIES.add_tools,
		},
		required: ["slug", "name", "system_prompt"],
		additionalProperties: false,
	},
	write: true,
	async handler(args, { sdk }) {
		const slug = requiredString(args, "slug");
		const skillRefs = optionalStringArray(args, "add_skills");
		const agent = await sdk.claw.agents.create({
			slug,
			name: requiredString(args, "name"),
			systemPrompt: requiredString(args, "system_prompt"),
			...(optionalString(args, "description") ? { description: optionalString(args, "description")! } : {}),
			scope: optionalString(args, "scope") ?? "personal",
			...(optionalString(args, "model_id") ? { modelId: optionalString(args, "model_id")! } : {}),
			...(optionalString(args, "color") ? { color: optionalString(args, "color")! } : {}),
			...(skillRefs ? { skills: await skillIdsOf(sdk, skillRefs) } : {}),
		});
		const report = await applyAttachments(sdk, agent.slug ?? slug, { add_tools: args["add_tools"] });
		return ok([`Created Claw agent ${agent.name} (slug: ${agent.slug ?? slug}).`, ...report].join("\n"));
	},
};

const agentUpdate: ToolDef = {
	name: "spaces_claw_agent_update",
	description:
		"Change a Xyne Claw agent the user owns or edits: name, description, system prompt, model, enabled, and " +
		"attach or detach skills and tools — all in one call. Only what you pass changes. A new system prompt " +
		"becomes a new prompt version (pass prompt_note to say why). Read it first with spaces_claw_agent_get.",
	inputSchema: {
		type: "object",
		properties: {
			slug: { type: "string", description: "Agent slug." },
			name: { type: "string", description: "New display name." },
			description: { type: "string", description: "New description." },
			system_prompt: { type: "string", description: "New system prompt. Replaces it entirely." },
			prompt_note: { type: "string", description: "Why the prompt changed, kept with the version." },
			model_id: { type: "string", description: "New model id." },
			enabled: { type: "boolean", description: "Turn the agent on or off." },
			...ATTACHMENT_PROPERTIES,
		},
		required: ["slug"],
		additionalProperties: false,
	},
	write: true,
	async handler(args, { sdk }) {
		const slug = requiredString(args, "slug");
		const enabled = optionalBoolean(args, "enabled");
		const changes = {
			...(optionalString(args, "name") ? { name: optionalString(args, "name")! } : {}),
			...(optionalString(args, "description") ? { description: optionalString(args, "description")! } : {}),
			...(optionalString(args, "system_prompt") ? { systemPrompt: optionalString(args, "system_prompt")! } : {}),
			...(optionalString(args, "prompt_note") ? { promptNote: optionalString(args, "prompt_note")! } : {}),
			...(optionalString(args, "model_id") ? { modelId: optionalString(args, "model_id")! } : {}),
			...(enabled !== undefined ? { enabled } : {}),
		};
		const report: string[] = [];
		if (Object.keys(changes).length > 0) {
			await sdk.claw.agents.update(slug, changes);
			report.push(`  ✓ updated ${Object.keys(changes).join(", ")}`);
		}
		report.push(...(await applyAttachments(sdk, slug, args)));
		if (report.length === 0) throw new Error("Nothing to change — pass at least one field besides slug.");
		return ok([`Claw agent ${slug}:`, ...report].join("\n"));
	},
};

const agentShare: ToolDef = {
	name: "spaces_claw_agent_share",
	description:
		"Share a Xyne Claw agent the user owns with a person (viewer, editor or contributor), stop sharing it, or " +
		"hand its ownership to someone else. The person is an email address or a user id.",
	inputSchema: {
		type: "object",
		properties: {
			slug: { type: "string", description: "Agent slug." },
			action: { type: "string", enum: ["share", "unshare", "transfer"], description: "What to do." },
			user: { type: "string", description: "Email address or user id." },
			role: { type: "string", enum: ["VIEWER", "EDITOR", "CONTRIBUTOR"], default: "VIEWER", description: "For share." },
			keep_editor: { type: "boolean", default: true, description: "For transfer: keep the previous owner as an editor." },
		},
		required: ["slug", "action", "user"],
		additionalProperties: false,
	},
	write: true,
	async handler(args, { sdk }) {
		const slug = requiredString(args, "slug");
		const action = requiredString(args, "action");
		const person = requiredString(args, "user");
		const userId = await userIdOf(sdk, person);
		if (action === "share") {
			const role = optionalString(args, "role") ?? "VIEWER";
			await sdk.claw.agents.addShare(slug, userId, role).catch((error: unknown) => {
				// Claw shares only with people it already knows, and it learns of a
				// person the first time they use Claw.
				if (error instanceof NotFoundError && /user/i.test(error.message)) {
					throw new Error(`${person} has not used Claw yet, so Claw cannot share with them. Ask them to open Claw once, then retry.`);
				}
				throw error;
			});
			return ok(`Shared ${slug} with ${person} as ${role}.`);
		}
		if (action === "unshare") {
			await sdk.claw.agents.removeShare(slug, userId);
			return ok(`Stopped sharing ${slug} with ${person}.`);
		}
		if (action === "transfer") {
			const keep = optionalBoolean(args, "keep_editor");
			await sdk.claw.agents.transferOwnership(slug, userId, keep === undefined ? {} : { keepPreviousOwnerAsEditor: keep });
			return ok(`Transferred ${slug} to ${person}.`);
		}
		throw new Error(`Unknown action "${action}": use share, unshare or transfer.`);
	},
};

// ── Writes: subagents, skills, schedules ────────────────────────────────────

const subagentUpsert: ToolDef = {
	name: "spaces_claw_subagent_upsert",
	description:
		"Create a custom Xyne Claw subagent, or update it if one with that name exists. A subagent is a specialist " +
		"an agent hands one kind of work to: give it a narrow description (the parent reads it to decide when to " +
		"delegate), its own system prompt, and the tools it needs. Only what you pass changes on an update.",
	inputSchema: {
		type: "object",
		properties: {
			name: { type: "string", description: "Lowercase with dashes, e.g. sql-helper." },
			description: { type: "string", description: "When the parent agent should use it (max 500 characters)." },
			system_prompt: { type: "string", description: "Its instructions." },
			param_name: { type: "string", description: "Name of the input the parent passes, e.g. question." },
			param_description: { type: "string", description: "What that input should contain." },
			progress_labels: {
				type: "array",
				items: { type: "string" },
				description: "1–8 short status lines shown while it works, e.g. 🔍 Querying the warehouse…",
			},
			tools: {
				type: "array",
				items: { type: "string" },
				description: "Tool slugs from spaces_claw_tools_search. Replaces the subagent's tools.",
			},
			skills: { type: "array", items: { type: "string" }, description: "Skill slugs or ids. Replaces its skills." },
		},
		required: ["name"],
		additionalProperties: false,
	},
	write: true,
	async handler(args, { sdk }) {
		const name = requiredString(args, "name");
		const toolRefs = optionalStringArray(args, "tools");
		const skillRefs = optionalStringArray(args, "skills");

		// Claw splits a subagent's tools in two: built-in write tools by name
		// (`direct`), everything else by slug (`custom`).
		let tools: { direct: string[]; custom: string[] } | undefined;
		if (toolRefs) {
			const catalog = await sdk.claw.tools.listAvailable().catch(() => undefined);
			const writes = new Set((catalog?.writeTools ?? []).map((t) => t.name));
			tools = { direct: toolRefs.filter((t) => writes.has(t)), custom: toolRefs.filter((t) => !writes.has(t)) };
		}
		const progressLabels = optionalStringArray(args, "progress_labels");
		const fields = {
			...(optionalString(args, "description") ? { description: optionalString(args, "description")! } : {}),
			...(optionalString(args, "system_prompt") ? { systemPrompt: optionalString(args, "system_prompt")! } : {}),
			...(optionalString(args, "param_name") ? { paramName: optionalString(args, "param_name")! } : {}),
			...(optionalString(args, "param_description") ? { paramDescription: optionalString(args, "param_description")! } : {}),
			...(progressLabels ? { progressLabels } : {}),
			...(tools ? { tools } : {}),
			...(skillRefs ? { skillIds: await skillIdsOf(sdk, skillRefs) } : {}),
		};

		const existing = await sdk.claw.subagents.get(name).catch((error: unknown) => {
			if (error instanceof NotFoundError) return undefined;
			throw error;
		});
		if (existing) {
			if (existing.source === "builtin") throw new Error(`${name} is a built-in subagent and cannot be changed.`);
			if (Object.keys(fields).length === 0) throw new Error("Nothing to change — pass at least one field besides name.");
			// Claw replaces a subagent whole on update, so what is not changing is sent as it is.
			await sdk.claw.subagents.update(name, {
				description: existing.description,
				systemPrompt: existing.systemPrompt ?? "",
				paramName: existing.paramName ?? "question",
				paramDescription: existing.paramDescription ?? `What to hand ${name}.`,
				progressLabels: Array.isArray(existing.progressLabels) ? existing.progressLabels : [`Working on ${name}…`],
				tools: existing.tools ?? { direct: [], custom: [] },
				mcpInstanceMap: existing.mcpInstanceMap ?? {},
				skillIds: (existing.skills ?? []).map((sk) => sk.id),
				...fields,
			});
			return ok(`Updated Claw subagent ${name}: ${Object.keys(fields).join(", ")}.`);
		}
		if (!fields.description || !fields.systemPrompt) {
			throw new Error(`No subagent named ${name} exists; creating one needs description and system_prompt.`);
		}
		await sdk.claw.subagents.create({
			name,
			paramDescription: `What to hand ${name}.`,
			progressLabels: [`Working on ${name}…`],
			tools: { direct: [], custom: [] },
			...fields,
			description: fields.description,
			systemPrompt: fields.systemPrompt,
		});
		return ok(`Created Claw subagent ${name}. Agents use it once it is enabled on them.`);
	},
};

const skillUpsert: ToolDef = {
	name: "spaces_claw_skill_upsert",
	description:
		"Create a Xyne Claw skill, or update it if one with that slug exists: its SKILL.md content and any files " +
		"that ship beside it. Only what you pass changes on an update; files are matched by path.",
	inputSchema: {
		type: "object",
		properties: {
			slug: { type: "string", description: "Lowercase with dashes, e.g. release-notes." },
			name: { type: "string", description: "Display name (required to create)." },
			description: { type: "string", description: "When an agent should use it." },
			content: { type: "string", description: "The SKILL.md body (required to create)." },
			files: {
				type: "array",
				items: {
					type: "object",
					properties: { path: { type: "string" }, content: { type: "string" } },
					required: ["path", "content"],
					additionalProperties: false,
				},
				description: "Extra files, e.g. { path: 'templates/notes.md', content: '…' }.",
			},
		},
		required: ["slug"],
		additionalProperties: false,
	},
	write: true,
	async handler(args, { sdk }) {
		const slug = requiredString(args, "slug");
		const name = optionalString(args, "name");
		const description = optionalString(args, "description");
		const content = typeof args["content"] === "string" && args["content"].length > 0 ? args["content"] : undefined;
		const files = Array.isArray(args["files"])
			? (args["files"] as Array<{ path?: unknown; content?: unknown }>)
					.filter((f) => typeof f.path === "string" && typeof f.content === "string")
					.map((f) => ({ relativePath: f.path as string, content: f.content as string }))
			: [];

		const existing = await sdk.claw.skills.get(slug).catch((error: unknown) => {
			if (error instanceof NotFoundError) return undefined;
			throw error;
		});
		let verb: string;
		if (existing) {
			const changes = { ...(name ? { name } : {}), ...(description ? { description } : {}), ...(content ? { content } : {}) };
			if (Object.keys(changes).length === 0 && files.length === 0) {
				throw new Error("Nothing to change — pass at least one field besides slug.");
			}
			if (Object.keys(changes).length > 0) await sdk.claw.skills.update(slug, changes);
			verb = "Updated";
		} else {
			if (!name || !content) throw new Error(`No skill ${slug} exists; creating one needs name and content.`);
			await sdk.claw.skills.create({ slug, name, content, ...(description ? { description } : {}) });
			verb = "Created";
		}
		if (files.length > 0) await sdk.claw.skills.putFiles(slug, files);
		return ok(`${verb} Claw skill ${slug}${files.length > 0 ? ` with ${files.length} file(s)` : ""}.`);
	},
};

const schedule: ToolDef = {
	name: "spaces_claw_schedule",
	description:
		"Schedule a Xyne Claw agent task — once after a delay, or on a cron — or change, pause, resume or cancel " +
		"a scheduled job. For create pass agent, task and either delay_minutes or cron. Times in cron are UTC. " +
		"List jobs with spaces_claw_schedules.",
	inputSchema: {
		type: "object",
		properties: {
			action: { type: "string", enum: ["create", "update", "pause", "resume", "cancel"], description: "What to do." },
			id: { type: "string", description: "The job, for every action but create." },
			agent: { type: "string", description: "For create: agent slug." },
			task: { type: "string", description: "For create or update: what the agent should do each time." },
			cron: { type: "string", description: "Cron expression, e.g. 0 9 * * 1-5. Makes the job recurring." },
			delay_minutes: { type: "number", minimum: 1, description: "For create: run once, this many minutes from now." },
			label: { type: "string", description: "A short name for the job." },
			context: { type: "string", description: "Extra background for each run." },
			channel_id: { type: "string", description: "For create: post results into this Spaces channel." },
			max_runs: { type: "number", minimum: 1, description: "For create: stop after this many runs." },
		},
		required: ["action"],
		additionalProperties: false,
	},
	write: true,
	async handler(args, { sdk }) {
		const action = requiredString(args, "action");
		const label = optionalString(args, "label");
		const context = optionalString(args, "context");
		const task = optionalString(args, "task");
		const cron = optionalString(args, "cron");

		if (action === "create") {
			const delayMinutes = optionalNumber(args, "delay_minutes");
			if (!cron && !delayMinutes) throw new Error("Pass cron for a recurring job or delay_minutes for a one-off.");
			const maxRuns = optionalNumber(args, "max_runs");
			const channelId = optionalString(args, "channel_id");
			const job = await sdk.claw.scheduledJobs.create({
				agentSlug: requiredString(args, "agent"),
				task: requiredString(args, "task"),
				...(cron ? { type: "cron", cronExpression: cron } : { type: "once", delayMs: Math.round(delayMinutes! * 60_000) }),
				...(label ? { label } : {}),
				...(context ? { context } : {}),
				...(channelId ? { channelId } : {}),
				...(maxRuns ? { maxRuns } : {}),
			});
			const summary = str(job, "scheduleSummary");
			return ok(`Scheduled (id: ${job.id})${summary ? `: ${summary}` : "."}`);
		}

		const id = requiredString(args, "id");
		if (action === "update") {
			const changes = { ...(task ? { task } : {}), ...(context ? { context } : {}), ...(label ? { label } : {}), ...(cron ? { cronExpression: cron } : {}) };
			if (Object.keys(changes).length === 0) throw new Error("Nothing to change — pass task, context, label or cron.");
			await sdk.claw.scheduledJobs.update(id, changes);
			return ok(`Updated scheduled job ${id}: ${Object.keys(changes).join(", ")}.`);
		}
		const transitions = {
			pause: () => sdk.claw.scheduledJobs.pause(id),
			resume: () => sdk.claw.scheduledJobs.resume(id),
			cancel: () => sdk.claw.scheduledJobs.cancel(id),
		} as const;
		const transition = transitions[action as keyof typeof transitions];
		if (!transition) throw new Error(`Unknown action "${action}".`);
		const result = await transition();
		return ok(`Scheduled job ${id} is now ${result.status}.`);
	},
};

// ── Writes: delete ──────────────────────────────────────────────────────────

const remove: ToolDef = {
	name: "spaces_claw_delete",
	description:
		"Delete a Xyne Claw agent, custom subagent or skill — permanently, it cannot be undone — or a scheduled " +
		"job, which Claw keeps on record as cancelled. Only do it when the user asked, and pass confirm repeating " +
		"the exact id. To switch an agent off instead, use spaces_claw_agent_update with enabled false.",
	inputSchema: {
		type: "object",
		properties: {
			kind: { type: "string", enum: ["agent", "subagent", "skill", "schedule"], description: "What to delete." },
			id: { type: "string", description: "Agent slug, subagent name, skill slug or job id." },
			confirm: { type: "string", description: "The same id again, to confirm." },
		},
		required: ["kind", "id", "confirm"],
		additionalProperties: false,
	},
	write: true,
	async handler(args, { sdk }) {
		const kind = requiredString(args, "kind");
		const id = requiredString(args, "id");
		if (requiredString(args, "confirm") !== id) throw new Error("confirm must repeat the id exactly; nothing was deleted.");
		const deleters = {
			agent: () => sdk.claw.agents.delete(id),
			subagent: () => sdk.claw.subagents.delete(id),
			skill: () => sdk.claw.skills.delete(id),
			schedule: () => sdk.claw.scheduledJobs.delete(id),
		} as const;
		const del = deleters[kind as keyof typeof deleters];
		if (!del) throw new Error(`Unknown kind "${kind}".`);
		await del();
		// Claw never removes a job row: deleting one stops it for good and keeps it as cancelled.
		if (kind === "schedule") return ok(`Stopped scheduled job ${id} for good; Claw keeps it on record as cancelled.`);
		return ok(`Deleted Claw ${kind} ${id}.`);
	},
};

export const clawTools: ToolDef[] = [
	listAgents,
	agentGet,
	subagents,
	skills,
	toolsSearch,
	runs,
	getRun,
	conversations,
	memory,
	schedules,
	run,
	runCancel,
	agentCreate,
	agentUpdate,
	agentShare,
	subagentUpsert,
	skillUpsert,
	schedule,
	remove,
];
