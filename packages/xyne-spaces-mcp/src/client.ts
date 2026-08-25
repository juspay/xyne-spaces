/**
 * HTTP client for the Xyne Spaces public API (`/api/sdk`).
 *
 * Three ways in, matching the three things the API offers:
 *
 *   catalogQuery   POST /api/sdk/catalog/query    reads, by Zero operation name
 *   catalogMutate  POST /api/sdk/catalog/mutate   writes, by Zero operation name
 *   direct         GET|POST /api/sdk/<path>       operations that are not catalog
 *                                                 entries: search, uploads,
 *                                                 sequence allocation, Claw
 *
 * Authentication is a `xyne_sk_` API key, the same credential `@xyne/spaces-sdk`
 * uses. A key acts as its user and reaches exactly what that user can reach —
 * Zero's per-table ACL is the authorization boundary, here as in the app.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_BASE_URL = "https://spaces.xyne.juspay.net";
const API_PATH = "/api/sdk";

/** Where a key is minted. Quoted back to the user whenever auth fails. */
export const KEY_SOURCE = "the Spaces dashboard, under Apps → API keys";

// ── Configuration ───────────────────────────────────────────────────────────

interface StoredConfig {
	baseUrl?: string;
	apiKey?: string;
}

/**
 * Credentials file, sharing the `~/.xyne/agent` directory the Xyne CLI and
 * xyne-claw-mcp already use. Preferred over putting the key in a committed
 * `.mcp.json`.
 */
function configPath(): string {
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

function isUsableKey(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0 && !value.includes("${");
}

export interface SpacesConfig {
	baseUrl: string;
	apiKey: string | undefined;
	readOnly: boolean;
}

/** env → `~/.xyne/agent/spaces.json` → default. */
export function resolveConfig(): SpacesConfig {
	const stored = loadStoredConfig();
	const baseUrl = [process.env.XYNE_SPACES_BASE_URL, stored.baseUrl].find(isUsableBaseUrl) ?? DEFAULT_BASE_URL;
	const apiKey = [process.env.XYNE_SPACES_API_KEY, stored.apiKey].find(isUsableKey);
	const readOnly = ["1", "true", "yes"].includes((process.env.XYNE_SPACES_READONLY ?? "").toLowerCase());
	return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, readOnly };
}

// ── Errors ──────────────────────────────────────────────────────────────────

/**
 * A failed call to `/api/sdk`.
 *
 * `code` is the stable field from the API's error envelope; branch on it, never
 * on `message`. Status 0 means the request never reached the server.
 */
export class SpacesApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: string,
		readonly requestId?: string,
	) {
		super(message);
		this.name = "SpacesApiError";
	}
}

/**
 * Turn a failure into something the model can act on.
 *
 * The auth cases are the ones worth special-casing: a bare "401" tells an agent
 * nothing, whereas naming where keys come from lets it tell the user what to do.
 */
export function describeError(err: unknown): string {
	if (!(err instanceof SpacesApiError)) {
		return err instanceof Error ? err.message : String(err);
	}
	if (err.status === 401 || err.code === "unauthenticated") {
		return `${err.message} Set XYNE_SPACES_API_KEY to a key minted in ${KEY_SOURCE}. Keys last at most 90 days, and can be revoked from that page.`;
	}
	if (err.code === "forbidden") {
		return `${err.message} (Your key acts as your Spaces user, so it can only reach what that user can.)`;
	}
	const suffix = err.requestId ? ` [request_id: ${err.requestId}]` : "";
	return `${err.message}${err.code ? ` (${err.code})` : ""}${suffix}`;
}

// ── Transport ───────────────────────────────────────────────────────────────

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
	const value = obj[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Read the `{ error: { code, message, request_id } }` envelope `/api/sdk` emits. */
function toApiError(status: number, parsed: unknown, fallback: string): SpacesApiError {
	if (parsed && typeof parsed === "object") {
		const envelope = (parsed as Record<string, unknown>)["error"];
		if (envelope && typeof envelope === "object") {
			const e = envelope as Record<string, unknown>;
			return new SpacesApiError(
				pickString(e, "message") ?? fallback,
				status,
				pickString(e, "code"),
				pickString(e, "request_id"),
			);
		}
	}
	return new SpacesApiError(fallback, status);
}

export class SpacesClient {
	constructor(private readonly config: SpacesConfig) {}

	get baseUrl(): string {
		return this.config.baseUrl;
	}

	private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
		if (!this.config.apiKey) {
			throw new SpacesApiError("No API key configured.", 401, "unauthenticated");
		}

		const headers: Record<string, string> = {
			Accept: "application/json",
			Authorization: `Bearer ${this.config.apiKey}`,
			"User-Agent": "xyne-spaces-mcp",
		};
		if (body !== undefined) headers["Content-Type"] = "application/json";

		const url = `${this.config.baseUrl}${API_PATH}${path.startsWith("/") ? path : `/${path}`}`;

		let res: Response;
		try {
			res = await fetch(url, {
				method,
				headers,
				...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			});
		} catch (err) {
			throw new SpacesApiError(
				`Could not reach Xyne Spaces at ${this.config.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
				0,
			);
		}

		const text = await res.text();
		let parsed: unknown;
		if (text) {
			try {
				parsed = JSON.parse(text);
			} catch {
				parsed = text;
			}
		}

		if (!res.ok) throw toApiError(res.status, parsed, `${method} ${path} failed with ${res.status}`);
		return parsed;
	}

	/**
	 * Run one Zero catalog query.
	 *
	 * `name` is the operation as registered in the backend's `queries.ts`; `args`
	 * must satisfy that operation's own zod schema, including the arguments Zero's
	 * optimistic-write model requires but a human caller would not think to send.
	 * The per-tool arg builders are what fill those in.
	 */
	async catalogQuery<T = unknown>(name: string, args?: unknown): Promise<T> {
		const raw = await this.request("POST", "/catalog/query", { name, ...(args !== undefined ? { args } : {}) });
		if (raw && typeof raw === "object" && "data" in raw) {
			return (raw as { data: T }).data;
		}
		return raw as T;
	}

	/** Run one Zero catalog mutator. Throws on failure; returns nothing on success. */
	async catalogMutate(name: string, args?: unknown): Promise<void> {
		await this.request("POST", "/catalog/mutate", { name, ...(args !== undefined ? { args } : {}) });
	}

	/** Call a non-catalog endpoint: search, Claw, or a controller-backed create. */
	async direct<T = unknown>(
		method: "GET" | "POST",
		path: string,
		opts: { query?: Record<string, unknown>; body?: unknown } = {},
	): Promise<T> {
		let target = path;
		if (opts.query) {
			const params = new URLSearchParams();
			for (const [key, value] of Object.entries(opts.query)) {
				// Only absent values are dropped. An empty string is meaningful to
				// search: `groupBy=` is what asks for a flat ranked list rather than
				// results bucketed by document type.
				if (value === undefined || value === null) continue;
				params.set(key, Array.isArray(value) ? value.join(",") : String(value));
			}
			const qs = params.toString();
			if (qs) target = `${path}?${qs}`;
		}
		return (await this.request(method, target, opts.body)) as T;
	}
}

// ── Client-supplied identifiers ─────────────────────────────────────────────

/**
 * Zero mutators expect the caller to supply the primary key of any row they
 * create, plus an explicit timestamp — the browser writes a row locally before
 * the server sees it and therefore has to pick the id itself. A tool caller has
 * no such requirement, so the arg builders generate these and the handler
 * reports back any id the caller will need later.
 */
export function newId(): string {
	return globalThis.crypto.randomUUID();
}

/** Epoch milliseconds, the unit every mutator expects. */
export function now(): number {
	return Date.now();
}
