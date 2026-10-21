/**
 * Where the server gets its session, and how it builds an SDK client.
 *
 * The credential is a Spaces session — the `xyne_ws_<workspaceId>_token` cookie
 * Xyne SSO issues — sent as a `Cookie` header by `@xyne/spaces-sdk`. Resolution
 * is env → `~/.xyne/agent/spaces.json` → none, sharing the agent directory the
 * Xyne CLI and xyne-claw-mcp already use. `spaces_login` and `xyne-spaces-mcp
 * login` write the file; `XYNE_SPACES_COOKIE` overrides it.
 *
 * None of this lives in `@xyne/spaces-sdk`: the SDK takes a base URL and a
 * session and asks no questions about where they came from, which is right for
 * a library and not enough for a binary someone launches from an editor config.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createClient, type SpacesClient, type SsoSession } from "@xyne/spaces-sdk";

/**
 * This deployment, not the SDK's own default (`https://spaces.xyne.app`).
 * `resolveConfig` always produces a concrete string and always passes it to
 * `createClient`, so the SDK default is never reached — which is deliberate,
 * and worth knowing before anyone "simplifies" this away.
 */
const DEFAULT_BASE_URL = "https://spaces.xyne.juspay.net";

/**
 * Long enough for the unbounded reads in this API.
 *
 * The SDK defaults to 30s. Several operations here return a whole workspace in
 * one response — the user directory, a project's tickets — and on a large
 * workspace those genuinely take longer than that. The previous transport had
 * no timeout at all, so anything shorter than this would be a regression.
 */
const DEFAULT_TIMEOUT_MS = 120_000;

/** How to get a session. Quoted back to the user whenever auth fails. */
export const LOGIN_HINT = "call the spaces_login tool, or run `xyne-spaces-mcp login` in a terminal";

interface StoredConfig {
	baseUrl?: string;
	session?: SsoSession;
	[key: string]: unknown;
}

/** `~/.xyne/agent/spaces.json`, or under `XYNE_AGENT_DIR` when set. */
export function configPath(): string {
	const envDir = process.env.XYNE_AGENT_DIR;
	if (envDir) {
		if (envDir === "~") return join(homedir(), "spaces.json");
		if (envDir.startsWith("~/")) return join(homedir(), envDir.slice(2), "spaces.json");
		return join(envDir, "spaces.json");
	}
	return join(homedir(), ".xyne", "agent", "spaces.json");
}

function loadStoredConfig(): StoredConfig {
	const path = configPath();
	if (!existsSync(path)) return {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
		if (parsed && typeof parsed === "object") return parsed as StoredConfig;
		return {};
	} catch {
		return {};
	}
}

/**
 * A candidate is usable only if it is a real http(s) URL. This rejects an
 * unexpanded `${XYNE_SPACES_BASE_URL}` placeholder, which an MCP client config
 * passes through verbatim when the shell variable is not set.
 */
function isUsableBaseUrl(value: unknown): value is string {
	return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function isStoredSession(value: unknown): value is SsoSession {
	if (!value || typeof value !== "object") return false;
	const v = value as Partial<SsoSession>;
	return (
		typeof v.cookie?.name === "string" &&
		typeof v.cookie.value === "string" &&
		typeof v.expiresAt === "number" &&
		typeof v.userId === "string" &&
		typeof v.workspaceId === "string"
	);
}

/** The claims of a JWT, read without verifying it — the server does that. */
function jwtClaims(token: string): Record<string, unknown> {
	try {
		const payload = token.split(".")[1];
		if (!payload) return {};
		const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/**
 * `XYNE_SPACES_COOKIE` is the cookie exactly as the browser holds it:
 * `xyne_ws_<workspaceId>_token=<jwt>`. The workspace comes from the name, and
 * the expiry and user from the token's own claims, so the one variable is a
 * whole session. Anything else — including an unexpanded `${…}` — is ignored.
 */
function sessionFromCookie(raw: string | undefined): SsoSession | undefined {
	const match = raw?.trim().match(/^(xyne_ws_(.+)_token)=(.+)$/);
	if (!match) return undefined;
	const [, name, workspaceId, value] = match as unknown as [string, string, string, string];
	const claims = jwtClaims(value);
	if (typeof claims["exp"] !== "number" || typeof claims["sub"] !== "string") return undefined;
	return {
		cookie: { name, value },
		expiresAt: claims["exp"] * 1000,
		userId: claims["sub"],
		workspaceId,
	};
}

function timeoutFrom(raw: string | undefined): number {
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export interface SpacesConfig {
	baseUrl: string;
	/** Mutable: `spaces_login` replaces it without a restart. */
	session: SsoSession | undefined;
	/** Where the session came from, so an auth failure can say what to fix. */
	sessionSource: "env" | "file" | undefined;
	readOnly: boolean;
	timeoutMs: number;
}

/** env → `~/.xyne/agent/spaces.json` → default. */
export function resolveConfig(): SpacesConfig {
	const stored = loadStoredConfig();
	const baseUrl = [process.env.XYNE_SPACES_BASE_URL, stored.baseUrl].find(isUsableBaseUrl) ?? DEFAULT_BASE_URL;
	const envSession = sessionFromCookie(process.env.XYNE_SPACES_COOKIE);
	const fileSession = isStoredSession(stored.session) ? stored.session : undefined;
	// Read-only unless writes are explicitly turned on. Anything else — unset,
	// a typo, or an unexpanded `${…}` a client passed through verbatim — keeps
	// the write tools hidden, so a config mistake fails closed.
	const readOnly = !["0", "false", "no"].includes((process.env.XYNE_SPACES_READONLY ?? "").trim().toLowerCase());
	return {
		baseUrl: baseUrl.replace(/\/+$/, ""),
		session: envSession ?? fileSession,
		sessionSource: envSession ? "env" : fileSession ? "file" : undefined,
		readOnly,
		timeoutMs: timeoutFrom(process.env.XYNE_SPACES_TIMEOUT_MS),
	};
}

/**
 * Persist a session to `~/.xyne/agent/spaces.json`, keeping whatever else the
 * file holds. Owner-only (0600): the cookie grants everything its user can do.
 * Returns the path written.
 */
export function saveSession(session: SsoSession): string {
	const path = configPath();
	const { apiKey: _dropped, ...stored } = loadStoredConfig();
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	writeFileSync(path, `${JSON.stringify({ ...stored, session }, null, 2)}\n`, { mode: 0o600 });
	// `mode` only applies when the file is created; tighten an existing one too.
	chmodSync(path, 0o600);
	return path;
}

/** Build the SDK client every tool calls through. */
export function createSpacesSdk(config: SpacesConfig): SpacesClient {
	return createClient({
		baseUrl: config.baseUrl,
		// `exactOptionalPropertyTypes` is on here and not in the SDK, so an
		// explicit `undefined` is not the same as an absent key.
		...(config.session !== undefined ? { session: config.session } : {}),
		timeout: config.timeoutMs,
	});
}
