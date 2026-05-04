/**
 * HTTP client for the Xyne Spaces backend.
 *
 * Default auth/base URL are read from env:
 * - XYNE_SPACES_URL (legacy)
 * - SPACES_BACKEND_URL (preferred fallback)
 * - XYNE_SPACES_TOKEN
 * - XYNE_SPACES_SESSION_ID
 *
 * Callers can override auth per request for user-scoped routes.
 */

export interface SpacesAuthContext {
  token?: string;
  sessionId?: string;
  baseUrl?: string;
}

function resolveBaseUrl(override?: string): string {
  const raw = override
    ?? process.env["XYNE_SPACES_URL"]
    ?? process.env["SPACES_BACKEND_URL"]
    ?? "";
  return raw.replace(/\/+$/, "");
}

// Extract Spaces userId from the JWT token's `sub` claim
function extractUserIdFromToken(token: string): string {
  try {
    const parts = token.split(".");
    if (!parts[1]) return "";
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    return payload.sub ?? "";
  } catch {
    return "";
  }
}

const DEFAULT_TOKEN = process.env["XYNE_SPACES_TOKEN"] ?? "";

export const CURRENT_USER_ID = extractUserIdFromToken(DEFAULT_TOKEN);

export async function spacesFetch(path: string, init?: RequestInit, auth?: SpacesAuthContext): Promise<unknown> {
  const token = auth?.token ?? process.env["XYNE_SPACES_TOKEN"] ?? "";
  const sessionId = auth?.sessionId ?? process.env["XYNE_SPACES_SESSION_ID"] ?? "";
  const baseUrl = resolveBaseUrl(auth?.baseUrl);

  if (!baseUrl) {
    throw new Error("Spaces base URL is not configured. Set SPACES_BACKEND_URL (preferred) or XYNE_SPACES_URL.");
  }
  if (!token) {
    throw new Error("Spaces auth token is missing for this request.");
  }

  const url = new URL(path, `${baseUrl}/`).toString();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(sessionId ? { "x-session-id": sessionId } : {}),
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
