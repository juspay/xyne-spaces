/**
 * Xyne Claw agents, reached through Spaces.
 *
 * Claw is a separate service with its own database and its own credential — a
 * Spaces API key is not valid there. Rather than making a caller hold two
 * logins, the Spaces backend relays: it calls Claw with the deployment's own
 * service credential and passes the caller's identity through explicitly. So
 * these three tools authenticate exactly like every other tool here.
 */

import { ok, optionalNumber, optionalString, record, requiredString } from "../render.js";
import type { ToolDef } from "./shared.js";

const TERMINAL = new Set(["completed", "failed", "cancelled", "canceled", "error"]);

interface ClawAgent {
	id?: string;
	slug?: string;
	name?: string;
	description?: string;
	enabled?: boolean;
	isDefault?: boolean;
}

interface ClawRun {
	sessionId?: string;
	status?: string;
	result?: string | null;
	error?: string | null;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── spaces_claw_list_agents ─────────────────────────────────────────────────

const listAgents: ToolDef = {
	name: "spaces_claw_list_agents",
	description:
		"List the Xyne Claw agents this deployment can run, with the slug each one is invoked by. Claw agents are " +
		"remote AI agents that can do longer-running work against Spaces data. Call this before spaces_claw_run to " +
		"find the right slug — an unknown slug is rejected. Uses the same API key as every other tool; there is no " +
		"separate Claw login.",
	inputSchema: { type: "object", properties: {}, additionalProperties: false },
	direct: [{ method: "get", path: "/claw/agents" }],
	async handler(_args, client) {
		const raw = await client.direct<unknown>("GET", "/claw/agents");
		const agents = Array.isArray(raw) ? (raw as ClawAgent[]) : [];
		if (agents.length === 0) return ok("No Claw agents are available to this deployment.");

		const rendered = agents.map((agent, i) => {
			const lines: string[] = [];
			if (agent.description) lines.push(`  ${agent.description}`);
			const flags = [agent.isDefault ? "default" : "", agent.enabled === false ? "disabled" : ""].filter(Boolean);
			if (flags.length > 0) lines.push(`  ${flags.join(" · ")}`);
			lines.push(`  Slug: ${agent.slug ?? "(none)"}`);
			return record(i + 1, agent.name || agent.slug || "(unnamed agent)", lines);
		});

		return ok(`${agents.length} Claw agent(s):\n\n${rendered.join("\n\n")}`);
	},
};

// ── spaces_claw_run ─────────────────────────────────────────────────────────

const run: ToolDef = {
	name: "spaces_claw_run",
	description:
		"Dispatch a task to a Xyne Claw agent and wait for it to finish, returning the agent's answer. Get the agent " +
		"slug from spaces_claw_list_agents. The run executes as YOU, so the agent sees exactly the Spaces data you " +
		"can see. " +
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
	direct: [
		{ method: "post", path: "/claw/runs" },
		{ method: "get", path: "/claw/runs/:sessionId" },
	],
	write: true,
	async handler(args, client) {
		const agent = requiredString(args, "agent");
		const task = requiredString(args, "task");

		const dispatched = await client.direct<{ sessionId?: string }>("POST", "/claw/runs", {
			body: {
				agent,
				task,
				...(optionalString(args, "context") ? { context: optionalString(args, "context") } : {}),
				...(optionalString(args, "channel_id") ? { channelId: optionalString(args, "channel_id") } : {}),
				...(optionalString(args, "conversation_id") ? { conversationId: optionalString(args, "conversation_id") } : {}),
			},
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
				const status = await client.direct<ClawRun>("GET", `/claw/runs/${encodeURIComponent(sessionId)}`);
				sawRun = true;
				if (status.status && TERMINAL.has(status.status.toLowerCase())) {
					if (status.status.toLowerCase() === "completed") {
						return ok(`${status.result ?? "(completed with no output)"}\n\n  Session ID: ${sessionId}`);
					}
					throw new Error(`Claw run ${status.status}: ${status.error ?? status.result ?? "(no detail)"} [session ${sessionId}]`);
				}
			} catch (error) {
				// A run can 404 briefly between dispatch and the row being written.
				const message = error instanceof Error ? error.message : String(error);
				if (sawRun || !message.includes("404")) throw error;
			}
			pollMs = Math.min(Math.floor(pollMs * 1.5), 10_000);
		}

		throw new Error(
			`Timed out after ${timeoutMs / 1000}s waiting for Claw run ${sessionId}. It is probably still going — ` +
				`read it with spaces_claw_get_run rather than dispatching again.`,
		);
	},
};

// ── spaces_claw_get_run ─────────────────────────────────────────────────────

const getRun: ToolDef = {
	name: "spaces_claw_get_run",
	description:
		"Read the status and result of one Xyne Claw run by its session id. Use it after spaces_claw_run returned a " +
		"session id without a result — because it timed out, or because it was dispatched with wait set to false. " +
		"Status is one of running, completed, failed or cancelled.",
	inputSchema: {
		type: "object",
		properties: {
			session_id: { type: "string", description: "Claw session id, from spaces_claw_run." },
		},
		required: ["session_id"],
		additionalProperties: false,
	},
	direct: [{ method: "get", path: "/claw/runs/:sessionId" }],
	async handler(args, client) {
		const sessionId = requiredString(args, "session_id");
		const status = await client.direct<ClawRun>("GET", `/claw/runs/${encodeURIComponent(sessionId)}`);
		const lines = [`  Status: ${status.status ?? "unknown"}`];
		if (status.error) lines.push(`  Error: ${status.error}`);
		if (status.result) {
			lines.push("  Result:");
			lines.push(`    ${status.result.split("\n").join("\n    ")}`);
		}
		if (!status.error && !status.result) lines.push("  No result yet.");
		return ok(record(1, `Claw run ${sessionId}`, lines));
	},
};

export const clawTools: ToolDef[] = [listAgents, run, getRun];
