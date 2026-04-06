/**
 * HTTP client for the Xyne Spaces backend.
 *
 * Reads XYNE_SPACES_URL and XYNE_SPACES_TOKEN (google_access_token) from env.
 * Calls backend API routes directly: /api/query, /api/search, /api/memory/search.
 */

const BASE_URL = (process.env["XYNE_SPACES_URL"] ?? "").replace(/\/+$/, "");
const TOKEN = process.env["XYNE_SPACES_TOKEN"] ?? "";

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

export const CURRENT_USER_ID = extractUserIdFromToken(TOKEN);

export async function spacesFetch(path: string, init?: RequestInit): Promise<unknown> {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
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

export async function interact(ast: QueryAST): Promise<unknown> {
  const payload = JSON.stringify(ast);
  console.error(`[spaces-client] POST /api/query ${payload}`);
  const result = (await spacesFetch("/api/query", {
    method: "POST",
    body: payload,
  })) as { data: unknown };
  return result.data;
}

export async function search(params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  console.error(`[spaces-client] GET /api/search?${qs}`);
  return spacesFetch(`/api/search?${qs}`);
}

export async function memorySearch(body: Record<string, unknown>): Promise<unknown> {
  const payload = JSON.stringify(body);
  console.error(`[spaces-client] POST /api/memory/search ${payload}`);
  return spacesFetch("/api/memory/search", {
    method: "POST",
    body: payload,
  });
}
