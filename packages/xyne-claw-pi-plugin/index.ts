/**
 * xyne-claw — a Pi extension (plugin) for the `xyne` CLI.
 *
 * Adds Xyne Claw remote-agent support WITHOUT any change to the CLI core:
 *
 *   Tools (the agent can call these):
 *     • claw_list_agents    — list Claw agents you can invoke
 *     • claw_list_sessions  — list your recent Claw sessions/runs
 *     • claw_run_agent      — dispatch a task to a remote agent and wait for the result
 *
 *   Slash command (you type these):
 *     • /claw login | logout | whoami | agents | sessions | run <slug> <task>
 *
 * Install:  xyne extension add <path-or-git-or-npm-source>
 *
 * Login uses a device/pairing-code flow: the plugin opens your browser to a
 * Claw page already authenticated by your Spaces session; you approve, and the
 * plugin polls until a token is minted and stored at ~/.xyne/agent/claw.json.
 *
 * Remote runs are async: POST /run returns a sessionId immediately; the plugin
 * polls GET /runs/:sessionId until the run reaches a terminal status.
 *
 * The extension module's DEFAULT EXPORT is the ExtensionFactory (loaded by pi's
 * jiti loader). Imports of @earendil-works/pi-* resolve to the CLI's bundled
 * copies at load time, so this package ships no Pi dependency of its own.
 */

import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionFactory, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// ── Config (self-contained; mirrors the CLI's ~/.xyne/agent convention) ─────

const DEFAULT_CLAW_BASE_URL = "https://spaces.xyne.juspay.net";
const API_PATH = "/claw/api/v1";

interface ClawConfig {
	baseUrl: string;
	token: string;
	tokenPrefix?: string;
	userId?: string;
	email?: string;
	createdAt?: string;
}

function getAgentDir(): string {
	const envDir = process.env.XYNE_AGENT_DIR;
	if (envDir) {
		if (envDir === "~") return homedir();
		if (envDir.startsWith("~/")) return homedir() + envDir.slice(1);
		return envDir;
	}
	return join(homedir(), ".xyne", "agent");
}

function getClawConfigPath(): string {
	return join(getAgentDir(), "claw.json");
}

function trimTrailingSlash(url: string): string {
	return url.replace(/\/+$/, "");
}

function apiUrl(baseUrl: string, path: string): string {
	const suffix = path.startsWith("/") ? path : `/${path}`;
	return `${trimTrailingSlash(baseUrl)}${API_PATH}${suffix}`;
}

function loadClawConfig(): ClawConfig | undefined {
	const path = getClawConfigPath();
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		if (parsed && typeof parsed === "object" && typeof parsed.token === "string") {
			return parsed as ClawConfig;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function saveClawConfig(config: ClawConfig): void {
	const dir = getAgentDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(getClawConfigPath(), JSON.stringify(config, null, 2) + "\n");
}

function clearClawConfig(): boolean {
	const path = getClawConfigPath();
	if (!existsSync(path)) return false;
	rmSync(path, { force: true });
	return true;
}

/** override (flag/env) → stored config → default. */
function resolveBaseUrl(override?: string): string {
	const chosen = override || process.env.XYNE_CLAW_BASE_URL || loadClawConfig()?.baseUrl || DEFAULT_CLAW_BASE_URL;
	return trimTrailingSlash(chosen);
}

// ── HTTP client ─────────────────────────────────────────────────────────────

class ClawApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body?: unknown,
	) {
		super(message);
		this.name = "ClawApiError";
	}
}

interface DeviceAuthStart {
	deviceCode: string;
	userCode: string;
	verifyUrl: string;
	expiresIn: number;
	interval: number;
}
interface DeviceAuthToken {
	token: string;
	userId?: string;
	email?: string;
}
interface ClawAgent {
	slug: string;
	name?: string;
	description?: string;
}
interface ClawSession {
	sessionId: string;
	agentSlug?: string;
	status?: string;
	title?: string;
	createdAt?: string;
}
interface ClawRun {
	sessionId: string;
	status: string;
	result?: string;
	error?: string;
}

const TERMINAL_RUN_STATUSES = ["completed", "failed", "cancelled", "canceled", "error"];

function str(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const k of keys) {
		const v = obj[k];
		if (typeof v === "string" && v.length > 0) return v;
	}
	return undefined;
}
function num(obj: Record<string, unknown>, fallback: number, ...keys: string[]): number {
	for (const k of keys) {
		const v = obj[k];
		if (typeof v === "number" && Number.isFinite(v)) return v;
	}
	return fallback;
}
function coerceList(raw: unknown, ...keys: string[]): unknown[] {
	if (Array.isArray(raw)) return raw;
	if (raw && typeof raw === "object") {
		// claw-auth wraps responses as { success, data: … } — unwrap the
		// envelope first. Without this, list calls silently return [].
		const data = (raw as Record<string, unknown>)["data"];
		if (Array.isArray(data)) return data;
		if (data && typeof data === "object") {
			for (const k of keys) {
				const v = (data as Record<string, unknown>)[k];
				if (Array.isArray(v)) return v;
			}
		}
		for (const k of keys) {
			const v = (raw as Record<string, unknown>)[k];
			if (Array.isArray(v)) return v;
		}
	}
	return [];
}

class ClawClient {
	constructor(
		private readonly baseUrl: string,
		private readonly token?: string,
	) {}

	private async request(method: string, path: string, opts: { auth?: boolean; body?: unknown } = {}): Promise<unknown> {
		const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "xyne-claw-plugin" };
		if (opts.body !== undefined) headers["Content-Type"] = "application/json";
		if (opts.auth) {
			if (!this.token) throw new ClawApiError("Not logged in. Run `/claw login` first.", 401);
			headers["Authorization"] = `Bearer ${this.token}`;
		}
		let res: Response;
		try {
			res = await fetch(apiUrl(this.baseUrl, path), {
				method,
				headers,
				body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
			});
		} catch (err) {
			throw new ClawApiError(
				`Could not reach Claw at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
				0,
			);
		}
		const text = await res.text();
		let parsed: unknown = undefined;
		if (text) {
			try {
				parsed = JSON.parse(text);
			} catch {
				parsed = text;
			}
		}
		if (!res.ok) {
			let msg = `${method} ${path} failed with ${res.status}`;
			if (parsed && typeof parsed === "object") {
				const fromBody = str(parsed as Record<string, unknown>, "error", "message");
				if (fromBody) msg = fromBody;
			}
			throw new ClawApiError(msg, res.status, parsed);
		}
		return parsed;
	}

	async startDeviceAuth(): Promise<DeviceAuthStart> {
		const raw = (await this.request("POST", "/cli/auth/start", { body: { clientId: "xyne-cli" } })) as Record<
			string,
			unknown
		>;
		const deviceCode = str(raw, "deviceCode", "device_code");
		const userCode = str(raw, "userCode", "user_code");
		const verifyUrl = str(raw, "verifyUrl", "verification_uri", "verificationUri", "verify_url");
		if (!deviceCode || !userCode || !verifyUrl) {
			throw new ClawApiError("Malformed /cli/auth/start response.", 502, raw);
		}
		return {
			deviceCode,
			userCode,
			verifyUrl,
			expiresIn: num(raw, 600, "expiresIn", "expires_in"),
			interval: num(raw, 3, "interval"),
		};
	}

	async pollDeviceToken(deviceCode: string): Promise<DeviceAuthToken | null> {
		try {
			const raw = (await this.request("POST", "/cli/auth/token", {
				body: { deviceCode, clientId: "xyne-cli" },
			})) as Record<string, unknown>;
			const token = str(raw, "token", "access_token");
			if (!token) return null;
			return { token, userId: str(raw, "userId", "user_id"), email: str(raw, "email") };
		} catch (err) {
			if (err instanceof ClawApiError) {
				const code = (err.body && typeof err.body === "object" && str(err.body as Record<string, unknown>, "error")) || "";
				if (err.status === 202 || code === "authorization_pending" || code === "slow_down") return null;
			}
			throw err;
		}
	}

	async listAgents(): Promise<ClawAgent[]> {
		const raw = await this.request("GET", "/agents", { auth: true });
		return coerceList(raw, "agents").map((item) => {
			const o = item as Record<string, unknown>;
			return { slug: str(o, "slug", "agentSlug") ?? "", name: str(o, "name", "displayName"), description: str(o, "description") };
		});
	}

	async listSessions(limit = 20): Promise<ClawSession[]> {
		const raw = await this.request("GET", `/runs/light?limit=${limit}`, { auth: true });
		return coerceList(raw, "runs", "sessions").map((item) => {
			const o = item as Record<string, unknown>;
			return {
				sessionId: str(o, "sessionId", "session_id", "id") ?? "",
				agentSlug: str(o, "agentSlug", "agent_slug", "agent"),
				status: str(o, "status"),
				title: str(o, "title", "summary", "name"),
				createdAt: str(o, "createdAt", "created_at"),
			};
		});
	}

	async createRun(input: { agentSlug: string; task: string; conversationId?: string; channelId?: string; deliverTo?: "dm" }): Promise<{ sessionId: string; conversationId: string }> {
		// A conversationId is REQUIRED for the run to be persisted + pollable:
		// claw-auth only writes the AgentRun row (queried by GET /runs/:id) when
		// conversationId is present. Generate one if the caller didn't supply it.
		const conversationId = input.conversationId ?? `cli-${randomUUID()}`;
		const raw = (await this.request("POST", "/run", {
			auth: true,
			body: {
				agentSlug: input.agentSlug,
				task: input.task,
				triggerSource: "api",
				conversationId,
				...(input.channelId ? { channelId: input.channelId } : {}),
				...(input.deliverTo ? { deliverTo: input.deliverTo } : {}),
			},
		})) as Record<string, unknown>;
		const sessionId =
			str(raw, "sessionId", "session_id", "id") ??
			str((raw["data"] as Record<string, unknown>) ?? {}, "sessionId", "id");
		if (!sessionId) throw new ClawApiError("Malformed /run response (missing sessionId).", 502, raw);
		return { sessionId, conversationId };
	}

	async getRun(sessionId: string): Promise<ClawRun> {
		const rawEnvelope = (await this.request("GET", `/runs/${encodeURIComponent(sessionId)}`, { auth: true })) as Record<
			string,
			unknown
		>;
		// claw-auth wraps the run as { success, data: run } — unwrap it.
		const raw = (rawEnvelope?.["data"] && typeof rawEnvelope["data"] === "object"
			? (rawEnvelope["data"] as Record<string, unknown>)
			: rawEnvelope) ?? {};
		return {
			sessionId,
			status: str(raw, "status") ?? "unknown",
			result: str(raw, "result", "response", "output", "lastAssistantText"),
			error: str(raw, "error", "errorMessage"),
		};
	}
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function openBrowser(url: string): boolean {
	try {
		// Only hand a normalized http(s) URL to the OS opener. This rejects non-web schemes and,
		// because a valid http(s) href never starts with "-", prevents the value from being
		// interpreted as a CLI option/command argument by `open`/`xdg-open`/`cmd`.
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
		const safeUrl = parsed.href;
		const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
		const args = process.platform === "win32" ? ["/c", "start", "", safeUrl] : [safeUrl];
		execFileSync(cmd, args, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/** Run the device-login flow, persist the token. Returns the saved config. */
async function performLogin(baseUrl: string, onProgress: (msg: string) => void): Promise<ClawConfig> {
	const client = new ClawClient(baseUrl);
	const start = await client.startDeviceAuth();
	onProgress(`Opening browser to authorize. Confirm this code, then click Authorize: ${start.userCode}`);
	onProgress(`If the browser did not open, visit: ${start.verifyUrl}`);
	openBrowser(start.verifyUrl);

	const deadline = Date.now() + start.expiresIn * 1000;
	const intervalMs = Math.max(1, start.interval) * 1000;
	onProgress("Waiting for authorization…");
	let token: DeviceAuthToken | null = null;
	while (Date.now() < deadline) {
		await sleep(intervalMs);
		token = await client.pollDeviceToken(start.deviceCode);
		if (token) break;
	}
	if (!token) throw new ClawApiError("Login timed out. Run `/claw login` to try again.", 408);

	const config: ClawConfig = {
		baseUrl,
		token: token.token,
		tokenPrefix: token.token.slice(0, 12),
		userId: token.userId,
		email: token.email,
		createdAt: new Date().toISOString(),
	};
	saveClawConfig(config);
	return config;
}

/** Poll a run to completion. `onTick` fires between polls. */
async function runAndWait(
	client: ClawClient,
	agentSlug: string,
	task: string,
	timeoutMs: number,
	signal: AbortSignal | undefined,
	onTick: (sessionId: string) => void,
	channelId?: string,
	deliverTo?: "dm",
): Promise<ClawRun> {
	const { sessionId } = await client.createRun({ agentSlug, task, channelId, deliverTo });
	const deadline = Date.now() + timeoutMs;
	const pollMs = 2000;
	while (Date.now() < deadline) {
		if (signal?.aborted) throw new ClawApiError("Cancelled.", 0);
		await sleep(pollMs);
		onTick(sessionId);
		const run = await client.getRun(sessionId);
		if (TERMINAL_RUN_STATUSES.includes(run.status.toLowerCase())) return run;
	}
	throw new ClawApiError(
		`Timed out waiting for run ${sessionId}. It may still be in progress — check with /claw sessions.`,
		408,
	);
}

function requireConfigOrThrow(): ClawConfig {
	const config = loadClawConfig();
	if (!config) throw new ClawApiError("Not logged in to Claw. Run `/claw login` first.", 401);
	return config;
}

function textResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

/** Error result: the model reads the content text; prefix so failure is unambiguous. */
function errorResult(text: string, details: Record<string, unknown> = {}) {
	return textResult(`Error: ${text}`, details);
}

function parseRunArgs(parts: string[]): { agent?: string; task: string; channelId?: string; deliverTo?: "dm" } {
	let channelId: string | undefined;
	let deliverTo: "dm" | undefined;
	const positional: string[] = [];
	for (let i = 0; i < parts.length; i += 1) {
		const part = parts[i];
		if (part === "--dm") {
			deliverTo = "dm";
			continue;
		}
		if (part === "--deliver-to" && parts[i + 1] === "dm") {
			deliverTo = "dm";
			i += 1;
			continue;
		}
		if (part === "--channel-id" && parts[i + 1]) {
			channelId = parts[i + 1];
			i += 1;
			continue;
		}
		if (part?.startsWith("--deliver-to=")) {
			if (part.slice("--deliver-to=".length) === "dm") deliverTo = "dm";
			continue;
		}
		if (part?.startsWith("--channel-id=")) {
			channelId = part.slice("--channel-id=".length) || undefined;
			continue;
		}
		if (part) positional.push(part);
	}
	const agent = positional[0];
	return { agent, task: positional.slice(1).join(" "), channelId, deliverTo: channelId ? undefined : deliverTo };
}

// ── The extension ───────────────────────────────────────────────────────────

const clawExtension: ExtensionFactory = (pi) => {
	// ---- Tools (agent-callable) ----

	pi.registerTool({
		name: "claw_list_agents",
		label: "Claw: list agents",
		description:
			"List the Xyne Claw agents the logged-in user can invoke. Requires a prior `/claw login`. Returns each agent's slug, name, and description.",
		parameters: Type.Object({}),
		async execute() {
			try {
				const config = requireConfigOrThrow();
				const agents = await new ClawClient(resolveBaseUrl(), config.token).listAgents();
				if (agents.length === 0) return textResult("No Claw agents available.", { count: 0 });
				const lines = agents.map((a) => `- ${a.slug}${a.name ? ` (${a.name})` : ""}${a.description ? `: ${a.description}` : ""}`);
				return textResult(`Claw agents (${agents.length}):\n${lines.join("\n")}`, { count: agents.length });
			} catch (err) {
				return errorResult(errMsg(err));
			}
		},
	});

	pi.registerTool({
		name: "claw_list_sessions",
		label: "Claw: list sessions",
		description:
			"List the logged-in user's recent Xyne Claw sessions/runs (id, agent, status, title). Requires a prior `/claw login`.",
		parameters: Type.Object({
			limit: Type.Optional(Type.Number({ description: "Max sessions to return (default 20)." })),
		}),
		async execute(_id, params) {
			try {
				const config = requireConfigOrThrow();
				const limit = (params as { limit?: number }).limit ?? 20;
				const sessions = await new ClawClient(resolveBaseUrl(), config.token).listSessions(limit);
				if (sessions.length === 0) return textResult("No Claw sessions found.", { count: 0 });
				const lines = sessions.map(
					(s) => `- ${s.sessionId}${s.agentSlug ? ` [${s.agentSlug}]` : ""}${s.status ? ` ${s.status}` : ""}${s.title ? ` — ${s.title}` : ""}`,
				);
				return textResult(`Claw sessions (${sessions.length}):\n${lines.join("\n")}`, { count: sessions.length });
			} catch (err) {
				return errorResult(errMsg(err));
			}
		},
	});

	pi.registerTool({
		name: "claw_run_agent",
		label: "Claw: run agent",
		description:
			"Dispatch a task to a remote Xyne Claw agent and wait for the result. Requires a prior `/claw login`. Provide the agent slug (see claw_list_agents) and the task text. Blocks until the run completes, fails, or times out.",
		parameters: Type.Object({
			agent: Type.String({ description: "Agent slug to invoke (e.g. 'assistant')." }),
			task: Type.String({ description: "The task / prompt to send to the agent." }),
			timeout_seconds: Type.Optional(Type.Number({ description: "Max seconds to wait for the result (default 300)." })),
			channel_id: Type.Optional(Type.String({ description: "Optional Spaces channel/DM id; explicit channel delivery wins over deliver_to." })),
			deliver_to: Type.Optional(Type.String({ description: "Set to 'dm' to request delivery to your Spaces DM." })),
		}),
		async execute(_id, params, signal, onUpdate) {
			const p = params as { agent: string; task: string; timeout_seconds?: number; channel_id?: string; deliver_to?: string };
			try {
				const config = requireConfigOrThrow();
				const client = new ClawClient(resolveBaseUrl(), config.token);
				const timeoutMs = (p.timeout_seconds ?? 300) * 1000;
				const channelId = p.channel_id?.trim() || undefined;
				const requestedDmDelivery = !channelId && p.deliver_to === "dm";
				const run = await runAndWait(client, p.agent, p.task, timeoutMs, signal, (sid) => {
					onUpdate?.({ content: [{ type: "text", text: `Running on ${p.agent} (session ${sid})…` }], details: {} });
				}, channelId, requestedDmDelivery ? "dm" : undefined);
				const deliveredNote = channelId
					? ` (reply delivered to Spaces channel ${channelId})`
					: requestedDmDelivery
						? " (delivery requested to your Spaces DM)"
						: "";
				const status = run.status.toLowerCase();
				if (status === "completed") {
					return textResult((run.result ?? "(completed with no output)") + deliveredNote, {
						sessionId: run.sessionId,
						status: run.status,
						...(channelId ? { deliveredToChannelId: channelId } : {}),
						...(requestedDmDelivery ? { deliveryRequested: "dm" } : {}),
					});
				}
				return errorResult(`Run ${run.status}: ${run.error ?? run.result ?? "(no detail)"}` + deliveredNote, {
					sessionId: run.sessionId,
					status: run.status,
					...(channelId ? { deliveredToChannelId: channelId } : {}),
					...(requestedDmDelivery ? { deliveryRequested: "dm" } : {}),
				});
			} catch (err) {
				return errorResult(errMsg(err));
			}
		},
	});

	// ---- /claw slash command (user-invoked) ----

	const SUBCOMMANDS = [
		{ value: "login", description: "Log in to Xyne Claw (opens browser)" },
		{ value: "logout", description: "Remove stored Claw credentials" },
		{ value: "whoami", description: "Show the current Claw login" },
		{ value: "agents", description: "List Claw agents you can invoke" },
		{ value: "sessions", description: "List your recent Claw sessions" },
		{ value: "run", description: "Run a remote agent: /claw run <slug> <task>" },
	];

	pi.registerCommand("claw", {
		description: "Xyne Claw: login and invoke remote agents",
		getArgumentCompletions: (prefix: string) => {
			if (prefix.includes(" ")) return null;
			const p = prefix.toLowerCase();
			const items = SUBCOMMANDS.filter((s) => s.value.startsWith(p)).map((s) => ({
				value: s.value,
				label: s.value,
				description: s.description,
			}));
			return items.length > 0 ? items : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const notify = (msg: string, type: "info" | "warning" | "error" = "info") => {
				if (ctx.hasUI && ctx.ui?.notify) ctx.ui.notify(msg, type);
			};
			const trimmed = args.trim();
			const [sub, ...rest] = trimmed.split(/\s+/);
			const restStr = trimmed.slice(sub.length).trim();

			try {
				switch (sub) {
					case "login": {
						const baseUrl = resolveBaseUrl(rest[0]?.startsWith("http") ? rest[0] : undefined);
						notify(`Logging in to Xyne Claw (${baseUrl})…`);
						const config = await performLogin(baseUrl, (m) => notify(m));
						notify(`✓ Logged in${config.email ? ` as ${config.email}` : ""}.`, "info");
						return;
					}
					case "logout": {
						notify(clearClawConfig() ? "✓ Logged out. Local Claw credentials removed." : "Not logged in to Claw.");
						return;
					}
					case "whoami": {
						const config = loadClawConfig();
						if (!config) return notify("Not logged in to Claw. Run `/claw login`.");
						notify(
							`Xyne Claw — ${config.email ?? "(unknown email)"}${config.userId ? ` · ${config.userId}` : ""} · ${config.baseUrl}`,
						);
						return;
					}
					case "agents": {
						const config = requireConfigOrThrow();
						const agents = await new ClawClient(resolveBaseUrl(), config.token).listAgents();
						if (agents.length === 0) return notify("No Claw agents available.");
						notify(`Claw agents (${agents.length}): ${agents.map((a) => a.slug).join(", ")}`);
						return;
					}
					case "sessions": {
						const config = requireConfigOrThrow();
						const sessions = await new ClawClient(resolveBaseUrl(), config.token).listSessions();
						if (sessions.length === 0) return notify("No Claw sessions found.");
						for (const s of sessions.slice(0, 20)) {
							notify(`${s.sessionId}${s.agentSlug ? ` [${s.agentSlug}]` : ""}${s.status ? ` ${s.status}` : ""}${s.title ? ` — ${s.title}` : ""}`);
						}
						return;
					}
					case "run": {
						const config = requireConfigOrThrow();
						const client = new ClawClient(resolveBaseUrl(), config.token);
						// Args form: /claw run [--dm|--deliver-to dm|--channel-id id] <slug> <task…>.
						const parsed = parseRunArgs(rest);
						let agent = parsed.agent;
						let task = parsed.task;
						if ((!agent || !task) && ctx.hasUI && ctx.ui) {
							if (!agent && ctx.ui.select) {
								const agents = await client.listAgents();
								if (agents.length === 0) return notify("No Claw agents available.");
								// select() takes a string[] and returns the chosen string.
								const picked = await ctx.ui.select("Pick a Claw agent", agents.map((a) => a.slug));
								if (!picked) return;
								agent = picked;
							}
							if (!task && ctx.ui.input) {
								const entered = await ctx.ui.input("Task for the agent", "e.g. summarize my open tickets");
								if (!entered) return;
								task = entered;
							}
						}
						if (!agent || !task) return notify("Usage: /claw run <agent-slug> <task>", "warning");
						notify(`Dispatching to ${agent}…`);
						const requestedDmDelivery = !parsed.channelId && parsed.deliverTo === "dm";
						const run = await runAndWait(client, agent, task, 300_000, undefined, (sid) =>
							notify(`Running on ${agent} (session ${sid})…`),
							parsed.channelId,
							requestedDmDelivery ? "dm" : undefined,
						);
						const deliveredNote = parsed.channelId
							? ` (reply delivered to Spaces channel ${parsed.channelId})`
							: requestedDmDelivery
								? " (delivery requested to your Spaces DM)"
								: "";
						if (run.status.toLowerCase() === "completed") {
							notify(`✓ completed${deliveredNote}:\n${run.result ?? "(no output)"}`);
						} else {
							notify(`Run ${run.status}: ${run.error ?? run.result ?? "(no detail)"}` + deliveredNote, "error");
						}
						return;
					}
					case "":
					case "help":
						notify("Usage: /claw login | logout | whoami | agents | sessions | run [--dm] <slug> <task>");
						return;
					default:
						notify(`Unknown subcommand: ${sub}. Try /claw help.`, "warning");
						return;
				}
			} catch (err) {
				notify(errMsg(err), "error");
			}
		},
	});
};

function errMsg(err: unknown): string {
	if (err instanceof ClawApiError && err.status === 401) {
		return "Not authorized. Run `/claw login` (your session may have expired).";
	}
	return err instanceof Error ? err.message : String(err);
}

export default clawExtension;
