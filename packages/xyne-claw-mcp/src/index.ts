#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type CallToolResult,
	type ServerNotification,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";

// ── Config (self-contained; mirrors the CLI's ~/.xyne/agent convention) ─────

const DEFAULT_CLAW_BASE_URL = "https://spaces.xyne.juspay.net";
const API_PATH = "/claw/api/v1";

interface ClawConfig {
	baseUrl: string;
	token: string;
	tokenPrefix?: string;
	userId?: string;
	email?: string;
	selfDmChannelId?: string; // legacy login payload; DM delivery is resolved by claw-auth
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
/** A candidate base URL is usable only if it's a real http(s) URL — this
 * rejects unexpanded `${XYNE_CLAW_BASE_URL}` placeholders that a plugin
 * .mcp.json can pass through when the shell env var isn't set. */
function isUsableBaseUrl(v: unknown): v is string {
	return typeof v === "string" && /^https?:\/\//i.test(v.trim());
}

function resolveBaseUrl(override?: string): string {
	const candidates = [override, process.env.XYNE_CLAW_BASE_URL, loadClawConfig()?.baseUrl];
	const chosen = candidates.find(isUsableBaseUrl) ?? DEFAULT_CLAW_BASE_URL;
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
	selfDmChannelId?: string;
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
		// envelope first so a data array (or a data object holding the list)
		// is found. Without this, list calls silently return [].
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
			return {
				token,
				userId: str(raw, "userId", "user_id"),
				email: str(raw, "email"),
				selfDmChannelId: str(raw, "selfDmChannelId", "self_dm_channel_id"),
			};
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
		// conversationId is present, and it's also the key that lets a later run
		// resume this thread. Generate one if the caller didn't supply it.
		// channelId (optional): when set, the agent's submit-response posts the
		// reply INTO that Spaces channel/DM (delivery mechanism already in run.ts).
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
		const sessionId = str(raw, "sessionId", "session_id", "id") ?? str((raw.data as Record<string, unknown>) ?? {}, "sessionId", "id");
		if (!sessionId) throw new ClawApiError("Malformed /run response (missing sessionId).", 502, raw);
		return { sessionId, conversationId };
	}

	async getRun(sessionId: string): Promise<ClawRun> {
		return (await this.getRunWithDetail(sessionId)).run;
	}

	/** Full run row (tool calls, tokens, timing, …) alongside the summary. */
	async getRunWithDetail(sessionId: string): Promise<{ run: ClawRun; detail: Record<string, unknown> }> {
		const rawEnvelope = (await this.request("GET", `/runs/${encodeURIComponent(sessionId)}`, { auth: true })) as Record<
			string,
			unknown
		>;
		// claw-auth wraps the run as { success, data: run } — unwrap it.
		const raw = (rawEnvelope?.data && typeof rawEnvelope.data === "object"
			? (rawEnvelope.data as Record<string, unknown>)
			: rawEnvelope) ?? {};
		return {
			run: {
				sessionId,
				status: str(raw, "status") ?? "unknown",
				result: str(raw, "result", "response", "output", "lastAssistantText"),
				error: str(raw, "error", "errorMessage"),
			},
			detail: raw,
		};
	}
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run the device-login flow, persist the token. Returns the saved config. */

/** Best-effort open the user's default browser to a URL. Runs locally (the MCP
 * server is a subprocess of the CLI), so this works on the user's machine. */
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

async function performLogin(
	baseUrl: string,
	timeoutSeconds: number | undefined,
	onProgress: (msg: string) => void | Promise<void>,
): Promise<{ config: ClawConfig; start: DeviceAuthStart }> {
	const client = new ClawClient(baseUrl);
	const start = await client.startDeviceAuth();
	const opened = openBrowser(start.verifyUrl);
	await onProgress(
		`${opened ? "Opened your browser to authorize Xyne Claw." : "Open this URL to authorize Xyne Claw:"} ${start.verifyUrl}\n` +
			`Confirm this code and click Authorize: ${start.userCode}`,
	);
	await onProgress("Waiting for authorization...");

	const maxSeconds = timeoutSeconds && timeoutSeconds > 0 ? Math.min(timeoutSeconds, start.expiresIn) : start.expiresIn;
	const deadline = Date.now() + maxSeconds * 1000;
	let intervalMs = Math.max(1, start.interval) * 1000;
	let token: DeviceAuthToken | null = null;
	while (Date.now() < deadline) {
		await sleep(intervalMs);
		try {
			token = await client.pollDeviceToken(start.deviceCode);
		} catch (err) {
			if (err instanceof ClawApiError) {
				const code = (err.body && typeof err.body === "object" && str(err.body as Record<string, unknown>, "error")) || "";
				if (code === "slow_down") {
					intervalMs += 5000;
					continue;
				}
			}
			throw err;
		}
		if (token) break;
	}
	if (!token) throw new ClawApiError("Login timed out. Run claw_login to try again.", 408);

	const config: ClawConfig = {
		baseUrl,
		token: token.token,
		tokenPrefix: token.token.slice(0, 12),
		userId: token.userId,
		email: token.email,
		...(token.selfDmChannelId ? { selfDmChannelId: token.selfDmChannelId } : {}),
		createdAt: new Date().toISOString(),
	};
	saveClawConfig(config);
	return { config, start };
}

/** Poll a run to completion. `onTick` fires between polls. */
async function runAndWait(
	client: ClawClient,
	agentSlug: string,
	task: string,
	timeoutMs: number,
	signal: AbortSignal | undefined,
	onTick: (sessionId: string) => void | Promise<void>,
	channelId?: string,
	deliverTo?: "dm",
): Promise<ClawRun> {
	const { sessionId } = await client.createRun({ agentSlug, task, channelId, deliverTo });
	const deadline = Date.now() + timeoutMs;
	let pollMs = 2000;
	let sawRun = false;
	while (Date.now() < deadline) {
		if (signal?.aborted) throw new ClawApiError("Cancelled.", 0);
		await sleep(pollMs);
		await onTick(sessionId);
		try {
			const run = await client.getRun(sessionId);
			sawRun = true;
			if (TERMINAL_RUN_STATUSES.includes(run.status.toLowerCase())) return run;
		} catch (err) {
			if (err instanceof ClawApiError && err.status === 404 && !sawRun) {
				pollMs = Math.min(Math.floor(pollMs * 1.5), 10_000);
				continue;
			}
			throw err;
		}
		pollMs = Math.min(Math.floor(pollMs * 1.5), 10_000);
	}
	throw new ClawApiError(
		`Timed out waiting for run ${sessionId}. It may still be in progress; check with claw_get_run or claw_list_sessions.`,
		408,
	);
}

function requireConfigOrThrow(): ClawConfig {
	const config = loadClawConfig();
	if (!config) throw new ClawApiError("Not logged in to Claw. Run claw_login first.", 401);
	return config;
}

function textResult(text: string, structuredContent: Record<string, unknown> = {}): CallToolResult {
	return { content: [{ type: "text", text }], structuredContent };
}

/** Error result: the model reads the content text; prefix so failure is unambiguous. */
function errorResult(text: string, structuredContent: Record<string, unknown> = {}): CallToolResult {
	return { content: [{ type: "text", text: `Error: ${text}` }], structuredContent, isError: true };
}

function errMsg(err: unknown): string {
	if (err instanceof ClawApiError && err.status === 401) {
		return "Not authorized. Run claw_login first (your session may have expired).";
	}
	return err instanceof Error ? err.message : String(err);
}

function asObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
	const value = args[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requiredString(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new ClawApiError(`Missing required parameter: ${key}`, 400);
	}
	return value;
}

function safeLimit(value: number | undefined): number {
	if (value === undefined) return 20;
	return Math.max(1, Math.min(Math.floor(value), 100));
}

function safeTimeoutSeconds(value: number | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	return Math.max(1, Math.floor(value));
}

async function notify(extra: { sendNotification: (notification: ServerNotification) => Promise<void> }, message: string): Promise<void> {
	try {
		await extra.sendNotification({
			method: "notifications/message",
			params: { level: "info", logger: "xyne-claw-mcp", data: message },
		});
	} catch {
		// Notifications are best-effort; the final tool result carries the same important data.
	}
}

const emptyInputSchema = {
	type: "object",
	properties: {},
	additionalProperties: false,
} as const;

const tools: Tool[] = [
	{
		name: "claw_login",
		description:
			"Log in to Xyne Claw using device flow. Opens no browser; returns the verification URL and user code, polls until a token is minted, then stores it in ~/.xyne/agent/claw.json.",
		inputSchema: {
			type: "object",
			properties: {
				timeout_seconds: {
					type: "number",
					description: "Max seconds to poll for authorization. Defaults to the device-flow expiresIn value.",
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: "claw_logout",
		description: "Log out of Xyne Claw by deleting the stored ~/.xyne/agent/claw.json token.",
		inputSchema: emptyInputSchema,
	},
	{
		name: "claw_whoami",
		description: "Show the stored Xyne Claw login email, userId, and baseUrl, or report that no login is stored.",
		inputSchema: emptyInputSchema,
	},
	{
		name: "claw_list_agents",
		description: "List Xyne Claw agents available to the logged-in user. Requires claw_login first.",
		inputSchema: emptyInputSchema,
	},
	{
		name: "claw_list_sessions",
		description: "List recent Xyne Claw sessions/runs. Requires claw_login first.",
		inputSchema: {
			type: "object",
			properties: {
				limit: { type: "number", description: "Max sessions to return (default 20, max 100)." },
			},
			additionalProperties: false,
		},
	},
	{
		name: "claw_run_agent",
		description:
			"Dispatch a task to a remote Xyne Claw agent and poll until the run completes, fails, is cancelled, errors, or times out. Requires claw_login first.",
		inputSchema: {
			type: "object",
			properties: {
				agent: { type: "string", description: "Agent slug to invoke." },
				task: { type: "string", description: "Task or prompt to send to the agent." },
				timeout_seconds: { type: "number", description: "Max seconds to wait for the result (default 300)." },
				channel_id: { type: "string", description: "Optional Spaces channel/DM id — the agent posts its reply INTO that Spaces thread." },
				deliver_to: { type: "string", enum: ["cli", "dm"], description: "Where to deliver: 'cli' (default, result to the terminal) or 'dm' (request delivery to the user's Spaces DM)." },
			},
			required: ["agent", "task"],
			additionalProperties: false,
		},
	},
	{
		name: "claw_get_run",
		description: "Get one Xyne Claw run status/result by session id. Requires claw_login first.",
		inputSchema: {
			type: "object",
			properties: {
				session_id: { type: "string", description: "Claw session id to fetch." },
			},
			required: ["session_id"],
			additionalProperties: false,
		},
	},
];

const server = new Server(
	{ name: "xyne-claw-mcp", version: "0.1.0" },
	{
		capabilities: { tools: {} },
		instructions: "Use claw_login first. Credentials are shared with the Xyne CLI at ~/.xyne/agent/claw.json.",
	},
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
	const name = request.params.name;
	const args = asObject(request.params.arguments);
	try {
		switch (name) {
			case "claw_login": {
				const timeoutSeconds = optionalNumber(args, "timeout_seconds");
				const baseUrl = resolveBaseUrl();
				const { config, start } = await performLogin(baseUrl, timeoutSeconds, (message) => notify(extra, message));
				return textResult(
					[
						`Logged in to Xyne Claw${config.email ? ` as ${config.email}` : ""}.`,
						`Verification URL used: ${start.verifyUrl}`,
						`User code used: ${start.userCode}`,
						`Token stored at: ${getClawConfigPath()}`,
					].join("\n"),
					{
						baseUrl: config.baseUrl,
						email: config.email,
						userId: config.userId,
						tokenPrefix: config.tokenPrefix,
						configPath: getClawConfigPath(),
						verifyUrl: start.verifyUrl,
						userCode: start.userCode,
					},
				);
			}
			case "claw_logout": {
				const cleared = clearClawConfig();
				return textResult(cleared ? "Logged out. Local Claw credentials removed." : "Not logged in to Claw.", {
					cleared,
					configPath: getClawConfigPath(),
				});
			}
			case "claw_whoami": {
				const config = loadClawConfig();
				if (!config) return textResult("Not logged in to Claw. Run claw_login first.", { loggedIn: false });
				return textResult(
					`Xyne Claw: ${config.email ?? "(unknown email)"}${config.userId ? ` · ${config.userId}` : ""} · ${config.baseUrl}`,
					{
						loggedIn: true,
						email: config.email,
						userId: config.userId,
						baseUrl: config.baseUrl,
						createdAt: config.createdAt,
						tokenPrefix: config.tokenPrefix,
						configPath: getClawConfigPath(),
					},
				);
			}
			case "claw_list_agents": {
				const config = requireConfigOrThrow();
				const agents = await new ClawClient(resolveBaseUrl(), config.token).listAgents();
				if (agents.length === 0) return textResult("No Claw agents available.", { count: 0, agents });
				const lines = agents.map((a) => `- ${a.slug}${a.name ? ` (${a.name})` : ""}${a.description ? `: ${a.description}` : ""}`);
				return textResult(`Claw agents (${agents.length}):\n${lines.join("\n")}`, { count: agents.length, agents });
			}
			case "claw_list_sessions": {
				const config = requireConfigOrThrow();
				const limit = safeLimit(optionalNumber(args, "limit"));
				const sessions = await new ClawClient(resolveBaseUrl(), config.token).listSessions(limit);
				if (sessions.length === 0) return textResult("No Claw sessions found.", { count: 0, sessions });
				const lines = sessions.map(
					(s) => `- ${s.sessionId}${s.agentSlug ? ` [${s.agentSlug}]` : ""}${s.status ? ` ${s.status}` : ""}${s.title ? ` - ${s.title}` : ""}`,
				);
				return textResult(`Claw sessions (${sessions.length}):\n${lines.join("\n")}`, { count: sessions.length, sessions });
			}
			case "claw_run_agent": {
				const config = requireConfigOrThrow();
				const agent = requiredString(args, "agent");
				const task = requiredString(args, "task");
				const timeoutMs = safeTimeoutSeconds(optionalNumber(args, "timeout_seconds"), 300) * 1000;
				// Delivery target: explicit channel_id > server-resolved deliver_to:"dm" > none (CLI only).
				const explicitChannel = optionalString(args, "channel_id");
				const deliverTo = optionalString(args, "deliver_to");
				let channelId: string | undefined = explicitChannel;
				const requestedDmDelivery = !channelId && deliverTo === "dm";
				const client = new ClawClient(resolveBaseUrl(), config.token);
				const run = await runAndWait(
					client,
					agent,
					task,
					timeoutMs,
					extra.signal,
					(sessionId) => notify(extra, `Running on ${agent} (session ${sessionId})...`),
					channelId,
					requestedDmDelivery ? "dm" : undefined,
				);
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
						result: run.result,
						...(channelId ? { deliveredToChannelId: channelId } : {}),
						...(requestedDmDelivery ? { deliveryRequested: "dm" } : {}),
					});
				}
				return errorResult(`Run ${run.status}: ${run.error ?? run.result ?? "(no detail)"}` + deliveredNote, {
					sessionId: run.sessionId,
					status: run.status,
					result: run.result,
					error: run.error,
					...(channelId ? { deliveredToChannelId: channelId } : {}),
					...(requestedDmDelivery ? { deliveryRequested: "dm" } : {}),
				});
			}
			case "claw_get_run": {
				const config = requireConfigOrThrow();
				const sessionId = requiredString(args, "session_id");
				const { run, detail } = await new ClawClient(resolveBaseUrl(), config.token).getRunWithDetail(sessionId);
				const summary = run.error ?? run.result ?? "(no result yet)";
				// Full run row (task, trigger, provider/model, timing, token usage,
				// tool calls) so "show me the whole session" works from the tool
				// alone — no raw-API fallback needed.
				return textResult(`Run ${run.sessionId}: ${run.status}\n${summary}\n\nFull run detail:\n${JSON.stringify(detail, null, 2)}`, {
					sessionId: run.sessionId,
					status: run.status,
					result: run.result,
					error: run.error,
					detail,
				});
			}
			default:
				return errorResult(`Unknown tool: ${name}`);
		}
	} catch (err) {
		return errorResult(errMsg(err));
	}
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", async () => {
	await server.close();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	await server.close();
	process.exit(0);
});
