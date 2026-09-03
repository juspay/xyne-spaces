/**
 * Where the server gets its credentials, and how it builds an SDK client.
 *
 * Resolution is env → `~/.xyne/agent/spaces.json` → default, sharing the agent
 * directory the Xyne CLI and xyne-claw-mcp already use. Keeping the key in that
 * file rather than a committed `.mcp.json` is the point of the file existing.
 *
 * None of this lives in `@xyne/spaces-sdk`: the SDK takes a base URL and a key
 * and asks no questions about where they came from, which is right for a
 * library and not enough for a binary someone launches from an editor config.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient, type SpacesClient } from "@xyne/spaces-sdk";

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

/** Where a key is minted. Quoted back to the user whenever auth fails. */
export const KEY_SOURCE = "the Spaces dashboard, under Apps → API keys";

interface StoredConfig {
	baseUrl?: string;
	apiKey?: string;
}

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

function timeoutFrom(raw: string | undefined): number {
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export interface SpacesConfig {
	baseUrl: string;
	apiKey: string | undefined;
	readOnly: boolean;
	timeoutMs: number;
}

/** env → `~/.xyne/agent/spaces.json` → default. */
export function resolveConfig(): SpacesConfig {
	const stored = loadStoredConfig();
	const baseUrl = [process.env.XYNE_SPACES_BASE_URL, stored.baseUrl].find(isUsableBaseUrl) ?? DEFAULT_BASE_URL;
	const apiKey = [process.env.XYNE_SPACES_API_KEY, stored.apiKey].find(isUsableKey);
	const readOnly = ["1", "true", "yes"].includes((process.env.XYNE_SPACES_READONLY ?? "").toLowerCase());
	return {
		baseUrl: baseUrl.replace(/\/+$/, ""),
		apiKey,
		readOnly,
		timeoutMs: timeoutFrom(process.env.XYNE_SPACES_TIMEOUT_MS),
	};
}

/** Build the SDK client every tool calls through. */
export function createSpacesSdk(config: SpacesConfig): SpacesClient {
	return createClient({
		baseUrl: config.baseUrl,
		// `exactOptionalPropertyTypes` is on here and not in the SDK, so an
		// explicit `undefined` is not the same as an absent key.
		...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
		timeout: config.timeoutMs,
	});
}
