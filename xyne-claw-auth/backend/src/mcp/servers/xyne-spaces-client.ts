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

export interface SpacesAuthContext {
  token?: string;
  sessionId?: string;
  workspaceId?: string;
  baseUrl?: string;
  s2sKey?: string;
}

function resolveBaseUrl(override?: string): string {
  const raw = override
    ?? process.env["XYNE_SPACES_URL"]
    ?? process.env["SPACES_BACKEND_URL"]
    ?? "";
  return raw.replace(/\/+$/, "");
}


export async function spacesFetch(path: string, init?: RequestInit, auth?: SpacesAuthContext): Promise<unknown> {
  const token = auth?.token ?? process.env["XYNE_SPACES_TOKEN"] ?? "";
  const sessionId = auth?.sessionId ?? process.env["XYNE_SPACES_SESSION_ID"] ?? "";
  const workspaceId = auth?.workspaceId ?? process.env["XYNE_SPACES_WORKSPACE_ID"] ?? "";
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

  const url = new URL(path, `${baseUrl}/`).toString();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(sessionId ? { "x-session-id": sessionId } : {}),
      ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
      ...(auth?.s2sKey ? { "x-s2s-key": auth.s2sKey } : {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Spaces API ${response.status}: ${text.slice(0, 500)}`);
  }

  return response.json();
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
  const workspaceId = auth?.workspaceId ?? process.env["XYNE_SPACES_WORKSPACE_ID"] ?? "";
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
    throw new Error(`Spaces API ${response.status}: ${text.slice(0, 300)}`);
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

export async function interact(ast: QueryAST, auth?: SpacesAuthContext): Promise<unknown> {
  const payload = JSON.stringify(ast);
  console.error(`[spaces-client] POST /api/query ${payload}`);
  const result = (await spacesFetch("/api/query", {
    method: "POST",
    body: payload,
  }, auth)) as { data: unknown };
  return result.data;
}

export async function search(params: Record<string, string>, auth?: SpacesAuthContext): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  console.error(`[spaces-client] GET /api/search?${qs}`);
  return spacesFetch(`/api/vespaSearch?${qs}`, undefined, auth);
}

export async function memorySearch(body: Record<string, unknown>, auth?: SpacesAuthContext): Promise<unknown> {
  const payload = JSON.stringify(body);
  console.error(`[spaces-client] POST /api/memory/search ${payload}`);
  return spacesFetch("/api/memory/search", {
    method: "POST",
    body: payload,
  }, auth);
}
