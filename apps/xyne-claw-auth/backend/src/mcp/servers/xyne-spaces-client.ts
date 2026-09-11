/**
 * HTTP client for the Xyne Spaces backend.
 *
 * Default auth/base URL are read from env:
 * - XYNE_SPACES_URL (legacy)
 * - SPACES_BACKEND_URL (preferred fallback)
 * - XYNE_SPACES_TOKEN
 * - XYNE_SPACES_SESSION_ID
 * - XYNE_SPACES_WORKSPACE_ID
 *
 * Callers can override auth per request for user-scoped routes.
 */

import { errMsg } from "../../lib/errors.js";

export interface SpacesAuthContext {
  token?: string;
  sessionId?: string;
  workspaceId?: string;
  baseUrl?: string;
  s2sKey?: string;
}

/**
 * Thrown by every Spaces client fetch on a non-2xx response, carrying the HTTP
 * `status` as a NUMBER so callers can branch on `err.status === 403` instead of
 * regex-matching the message. `status` is 0 for a network-level failure (no
 * response). The message keeps the historical `Spaces API <status>: …` /
 * `Spaces app API <status>: …` shape so older string-matching callers still work.
 */
export class SpacesApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SpacesApiError";
  }
}

/**
 * True when a Spaces `/chat/postMessage` rejected a FlowUI card because it used
 * a component type the deployed backend doesn't recognize — a 400 whose body is
 * an "Invalid flowJSON" discriminator error. The signal to retry with a card
 * built only from universally-supported components. Deliberately narrow: any
 * other 400 (channel validation, empty conversation) or status returns false.
 */
export function isFlowSchemaRejection(err: unknown): boolean {
  return (
    err instanceof SpacesApiError &&
    err.status === 400 &&
    /invalid\s*flowjson|flowjson|discriminator/i.test(err.message)
  );
}

// `??` alone is not enough here: the adapter always writes XYNE_SPACES_URL into
// the child's env, so a credential set without a `url` leaves it defined-but-
// empty, which shadows SPACES_BACKEND_URL and takes the whole server down with
// "Spaces base URL is not configured". Treat blank as unset at every level.
export function resolveBaseUrl(override?: string): string {
  const candidates = [override, process.env["XYNE_SPACES_URL"], process.env["SPACES_BACKEND_URL"]];
  const raw = candidates.find((value) => typeof value === "string" && value.trim().length > 0) ?? "";
  return raw.trim().replace(/\/+$/, "");
}

// Extract Spaces userId from the JWT token's `sub` claim (user tokens)
// or `userId` claim (app tokens)
function extractUserIdFromToken(token: string): string {
  try {
    const parts = token.split(".");
    if (!parts[1]) return "";
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    return payload.sub ?? payload.userId ?? "";
  } catch {
    return "";
  }
}

const DEFAULT_TOKEN = process.env["XYNE_SPACES_TOKEN"] ?? "";

export const CURRENT_USER_ID = extractUserIdFromToken(DEFAULT_TOKEN);

export async function spacesFetch(path: string, init?: RequestInit, auth?: SpacesAuthContext): Promise<unknown> {
  const token = auth?.token ?? process.env["XYNE_SPACES_TOKEN"] ?? "";
  const sessionId = auth?.sessionId ?? process.env["XYNE_SPACES_SESSION_ID"] ?? "";
  const workspaceId = auth ? (auth.workspaceId ?? "") : (process.env["XYNE_SPACES_WORKSPACE_ID"] ?? "");
  const baseUrl = resolveBaseUrl(auth?.baseUrl);

  if (!baseUrl) {
    throw new Error("Spaces base URL is not configured. Set SPACES_BACKEND_URL (preferred) or XYNE_SPACES_URL.");
  }
  if (!token) {
    throw new Error("Spaces auth token is missing for this request.");
  }

  // Spaces' auth middleware reads session ID from multiple cookie names
  // depending on which middleware variant is mounted:
  //   - `auth.ts` (legacy):           reads `xyne_session`
  //   - `auth.ts` (newer refresh path): reads `user_session_id` ← REQUIRED for
  //     proactive token refresh. Without this, when our token is within ~60s
  //     of expiring (always true in tight TTL setups), the middleware tries
  //     to refresh, fails because the cookie is missing, and returns 401
  //     ("Token expired and no session provided for refresh"). Sending it
  //     unconditionally is harmless on other paths.
  //   - `authV2Middleware.ts`:        reads `x-session-id` header or
  //                                   `user_session_id` cookie.
  // Workspace id (legacy: `xyne_last_workspace` cookie, authV2: `x-workspace-id`
  // header) is sent through both channels for the same reason.
  const cookieParts: string[] = [];
  if (sessionId) {
    cookieParts.push(`xyne_session=${sessionId}`);
    cookieParts.push(`user_session_id=${sessionId}`);
  }
  if (workspaceId) cookieParts.push(`xyne_last_workspace=${workspaceId}`);
  const cookieHeader = cookieParts.join("; ");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(sessionId ? { "x-session-id": sessionId } : {}),
    ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
    ...(auth?.s2sKey ? { "x-s2s-key": auth.s2sKey } : {}),
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };

  type Attempt =
    | { ok: true; json: unknown }
    | { ok: false; status: number | null; text: string };

  const attempt = async (p: string): Promise<Attempt> => {
    const url = new URL(p, `${baseUrl}/`).toString();
    try {
      // Fresh timeout signal per attempt (unless the caller supplied one) so a
      // first-attempt timeout doesn't instantly fail the fallback.
      const response = await fetch(url, {
        ...init,
        headers,
        signal: init?.signal ?? AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { ok: false, status: response.status, text };
      }
      return { ok: true, json: await response.json() };
    } catch (err) {
      // Network error / timeout — the endpoint is unreachable.
      return { ok: false, status: null, text: errMsg(err) };
    }
  };

  let res = await attempt(path);

  // Resilience: the `/claw` endpoints are newer and may not exist (or be
  // method-mismatched) in every environment / deploy. Fall back to the original
  // (non-/claw) endpoint — battle-tested and also user-token-capable — on any
  // signal that the /claw ROUTE itself is the problem:
  //   - network error / timeout  (status null) — unreachable
  //   - 404 Not Found            — the /claw route isn't mounted
  //   - 405 Method Not Allowed   — route exists but not for this verb
  //   - 502 / 503 / 504          — gateway down / rolling
  // This is SAFE for 404: if it's a route-missing 404 the original serves the
  // request; if it's a genuine resource-not-found the original ALSO 404s, so we
  // just return the same result (one extra request, no behaviour change).
  // We do NOT fall back on 400/401/403 — those are real request-level responses
  // (validation/auth) the original would return identically. Strips the `/claw`
  // segment wherever it sits, e.g. /api/query/claw → /api/query,
  // /api/memory/claw/search → /api/memory/search.
  const clawless = path.replace(/\/claw(?=\/|$)/, "");
  if (
    !res.ok &&
    clawless !== path &&
    (res.status === null ||
      res.status === 404 ||
      res.status === 405 ||
      res.status === 502 ||
      res.status === 503 ||
      res.status === 504)
  ) {
    console.warn(
      `[spaces-client] /claw route unavailable (${res.status ?? "network"}) for ${path} — falling back to ${clawless}`,
    );
    res = await attempt(clawless);
  }

  if (!res.ok) {
    throw new SpacesApiError(res.status ?? 0, `Spaces API ${res.status ?? "network error"}: ${res.text.slice(0, 500)}`);
  }
  return res.json;
}

/**
 * Binary download variant of spacesFetch. Same auth handling, but returns
 * the raw response body as a Buffer + content-type for attachment downloads.
 */
export async function spacesFetchBuffer(
  path: string,
  auth?: SpacesAuthContext,
): Promise<{ buffer: Buffer; contentType: string }> {
  const token = auth?.token ?? process.env["XYNE_SPACES_TOKEN"] ?? "";
  const sessionId = auth?.sessionId ?? process.env["XYNE_SPACES_SESSION_ID"] ?? "";
  const workspaceId = auth ? (auth.workspaceId ?? "") : (process.env["XYNE_SPACES_WORKSPACE_ID"] ?? "");
  const baseUrl = resolveBaseUrl(auth?.baseUrl);
  if (!baseUrl) throw new Error("Spaces base URL not configured");
  if (!token) throw new Error("Spaces auth token missing");

  const cookieParts: string[] = [];
  if (sessionId) {
    cookieParts.push(`xyne_session=${sessionId}`);
    cookieParts.push(`user_session_id=${sessionId}`);
  }
  if (workspaceId) cookieParts.push(`xyne_last_workspace=${workspaceId}`);
  const cookieHeader = cookieParts.join("; ");

  const url = new URL(path, `${baseUrl}/`).toString();
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(sessionId ? { "x-session-id": sessionId } : {}),
      ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new SpacesApiError(response.status, `Spaces API ${response.status}: ${text.slice(0, 300)}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType: response.headers.get("content-type") ?? "application/octet-stream" };
}

/** Plain-text variant of spacesFetch — returns the response body as a string. */
export async function spacesFetchText(path: string, auth?: SpacesAuthContext): Promise<string> {
  const token = auth?.token ?? process.env["XYNE_SPACES_TOKEN"] ?? "";
  const sessionId = auth?.sessionId ?? process.env["XYNE_SPACES_SESSION_ID"] ?? "";
  const workspaceId = auth ? (auth.workspaceId ?? "") : (process.env["XYNE_SPACES_WORKSPACE_ID"] ?? "");
  const baseUrl = resolveBaseUrl(auth?.baseUrl);
  if (!baseUrl) throw new Error("Spaces base URL not configured");
  if (!token) throw new Error("Spaces auth token missing");

  const cookieParts: string[] = [];
  if (sessionId) {
    cookieParts.push(`xyne_session=${sessionId}`);
    cookieParts.push(`user_session_id=${sessionId}`);
  }
  if (workspaceId) cookieParts.push(`xyne_last_workspace=${workspaceId}`);
  const cookieHeader = cookieParts.join("; ");

  const url = new URL(path, `${baseUrl}/`).toString();
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(sessionId ? { "x-session-id": sessionId } : {}),
      ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new SpacesApiError(response.status, `Spaces API ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.text();
}

/**
 * App-token variant of spacesFetch. Hits the `/api/apps/*` routes (gated by
 * Spaces' `authenticateApp` middleware) using the agent's app token as Bearer.
 *
 * Used by tool `appHandler`s when the spaces MCP runs in APP MODE — i.e. the
 * run is attributed to an agent's app user, which has no Spaces login session
 * but does have a valid app token. The app routes resolve the acting user from
 * the app token itself, so no session id / workspace id is needed.
 */
export async function appFetch(path: string, init?: RequestInit, auth?: SpacesAuthContext): Promise<unknown> {
  const token = auth?.token ?? process.env["XYNE_SPACES_TOKEN"] ?? "";
  const baseUrl = resolveBaseUrl(auth?.baseUrl);
  if (!baseUrl) throw new Error("Spaces base URL is not configured.");
  if (!token) throw new Error("Spaces app token is missing for this request.");

  const url = `${baseUrl}/api/apps${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new SpacesApiError(response.status, `Spaces app API ${response.status}: ${text.slice(0, 500)}`);
  }
  return response.json();
}

/**
 * Binary download over the APP-token surface (`/api/apps/*`). The app twin of
 * spacesFetchBuffer: authenticates with the agent's app token (Bearer) instead
 * of a user session, so it works in headless/automation runs where there is no
 * user JWT. Used by tools that must pull raw bytes (e.g. attachment download)
 * through an app endpoint such as `/api/apps/files/download/:attachmentId`.
 */
export async function appFetchBuffer(
  path: string,
  auth?: SpacesAuthContext,
): Promise<{ buffer: Buffer; contentType: string }> {
  const token = auth?.token ?? process.env["XYNE_SPACES_TOKEN"] ?? "";
  const baseUrl = resolveBaseUrl(auth?.baseUrl);
  if (!baseUrl) throw new Error("Spaces base URL is not configured.");
  if (!token) throw new Error("Spaces app token is missing for this request.");

  const url = `${baseUrl}/api/apps${path}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new SpacesApiError(response.status, `Spaces app API ${response.status}: ${text.slice(0, 300)}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType: response.headers.get("content-type") ?? "application/octet-stream" };
}

export interface QueryAST {
  model: string;
  operation: "findMany" | "count";
  where?: Record<string, unknown>;
  orderBy?: Record<string, string> | Array<Record<string, string>>;
  take?: number;
  skip?: number;
  include?: Record<string, unknown>;
  select?: Record<string, unknown>;
}

// Opt-in outbound-query tracing. Off by default so the hot path is silent; set
// SPACES_CLIENT_DEBUG=1 to see model/operation per query when diagnosing a
// specific run. Never logs where/param/body VALUES (PII) — shape only.
const SPACES_CLIENT_DEBUG = process.env["SPACES_CLIENT_DEBUG"] === "1";

export async function interact(ast: QueryAST, auth?: SpacesAuthContext): Promise<unknown> {
  const payload = JSON.stringify(ast);
  if (SPACES_CLIENT_DEBUG) {
    console.error(`[spaces-client] POST /api/query/claw model=${ast.model} op=${ast.operation}`);
  }
  const result = (await spacesFetch("/api/query/claw", {
    method: "POST",
    body: payload,
  }, auth)) as { data: unknown };
  return result.data;
}

export async function search(params: Record<string, string>, auth?: SpacesAuthContext): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  return spacesFetch(`/api/vespaSearch/claw?${qs}`, undefined, auth);
}

export async function memorySearch(body: Record<string, unknown>, auth?: SpacesAuthContext): Promise<unknown> {
  const payload = JSON.stringify(body);
  return spacesFetch("/api/memory/claw/search", {
    method: "POST",
    body: payload,
  }, auth);
}
