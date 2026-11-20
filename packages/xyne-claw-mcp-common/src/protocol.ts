/**
 * Request and response shapes of the MCP service (apps/xyne-claw-mcp-service).
 * A request carries `launch` only after the service answered 409
 * `launch-required`.
 */
import { createHash } from "node:crypto";

export const MCP_SERVICE_NAME = "xyne-claw-mcp";

/** Header carrying the session key of a request. */
export const MCP_SESSION_KEY_HEADER = "x-mcp-session-key";

/** Timeout of tools/list and tools/call inside the service. */
export const MCP_REQUEST_TIMEOUT_MS = 600_000;

export const MCP_SERVICE_PATHS = {
  listTools: "/v1/tools/list",
  callTool: "/v1/tools/call",
  evict: "/v1/sessions/evict",
  restart: "/v1/sessions/restart",
} as const;

/** Command of a builtin server launch: `{ cmd: BUILTIN_SERVER_CMD, args: [<name>] }`. */
export const BUILTIN_SERVER_CMD = "xyne-mcp-server";

export type LaunchSpec =
  | { transport: "http"; url: string; headers: Record<string, string> }
  | {
      transport: "stdio";
      cmd: string;
      args: string[];
      env: Record<string, string>;
      /** name → content; written 0600 per session, `{{file:<name>}}` → its path. */
      files?: Record<string, string>;
    };

export interface SessionTarget {
  /** Session cache key computed by claw-auth (user × server × scope). */
  key: string;
  serverType: string;
  /**
   * Hash of the credentials the session runs with. A live session with a
   * different fingerprint is closed and restarted. Empty matches any session.
   */
  fingerprint: string;
  /** Sent after a 409 launch-required. */
  launch?: LaunchSpec;
}

export interface ListToolsRequest {
  session: SessionTarget;
}

export interface CallToolRequest {
  session: SessionTarget;
  tool: string;
  arguments: Record<string, unknown>;
  /** MCP `_meta` for the call (e.g. per-call Spaces auth). */
  meta?: Record<string, unknown>;
}

export interface EvictRequest {
  /** Close sessions whose key equals one of these or starts with `<key>:`. */
  scopedKeys?: string[];
  /** Close sessions whose key starts with one of these. */
  prefixes?: string[];
}

export interface RestartRequest {
  serverType?: string;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ServiceErrorCode = "launch-required" | "launch-not-allowed" | "tool-error" | "bad-request" | "unauthorized";

export type ServiceResponse<T> =
  | { ok: true; result: T }
  | { ok: false; code: ServiceErrorCode; error: string };

/** sha256 of the exact request body, base64url. Signed into the service assertion. */
export function bodyHash(body: string | Buffer): string {
  return createHash("sha256").update(body).digest("base64url");
}

/** True when a session key matches an evict request. */
export function evictMatches(key: string, req: EvictRequest): boolean {
  for (const scoped of req.scopedKeys ?? []) {
    if (key === scoped || key.startsWith(`${scoped}:`)) return true;
  }
  for (const prefix of req.prefixes ?? []) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

/** Thrown when the service needs the launch spec for a session (409 launch-required). */
export class LaunchRequiredError extends Error {
  constructor(key: string) {
    super(`launch required for session ${key}`);
    this.name = "LaunchRequiredError";
  }
}
