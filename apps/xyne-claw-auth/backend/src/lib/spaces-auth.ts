/**
 * User-scoped Spaces credentials for claw-auth → Spaces calls.
 *
 * Spaces web sessions are an opaque httpOnly cookie (`xs`) whose value is
 * stored hashed, so a usable session credential can no longer be read from the
 * Spaces DB (`workflow.user_sessions` is read-only legacy and gets no new
 * rows). Instead claw-auth asks Spaces to MINT a short-lived workspace JWT for
 * the user over S2S:
 *
 *   POST {spacesInternalUrl}/api/internal/auth/token
 *   headers: x-s2s-key: <INTERNAL_S2S_KEY>
 *   body:    { userId, workspaceId }
 *   200 → { token, expiresIn (seconds), workspaceId, userId }
 *   404 user_not_found · 409 no_active_session · 403 workspace_forbidden
 *
 * The JWT carries the user's newest ACTIVE session id and dies when the user
 * logs out of every device. Spaces APIs accept it as
 * `Authorization: Bearer <token>` + `x-workspace-id` — no cookies, no session
 * id, no refresh hop. `null` from every function here keeps today's "no live
 * Spaces session" semantics: callers fall back to app tokens / headless paths.
 *
 * Tokens are cached per `userId:workspaceId` until 120 s before expiry and
 * minted single-flight, so a burst of calls for one user costs one S2S hop.
 */

import type { Request } from "express";
import { CONFIG } from "../config.js";
import { errMsg } from "./errors.js";
import { getWorkspaceIdForUser } from "./spaces-db.js";

import { createLogger } from "../logger.js";
const log = createLogger("spaces-auth");

/** Audit trail tag — identifies which code path asked for a user credential so
 *  logs can be correlated with Spaces' `/api/internal/auth/token` log and the
 *  `claw_readonly` query log. Keep this enum-style so greps stay clean. */
export type SpacesAuthCaller =
  | "webhook"
  | "agent-chat"
  | "agents"
  | "mcp-runner"
  | "require-auth"
  | "scheduled-job"
  | "write-action"
  | "clone-owner-dm"
  | "skill-update-owner-dm"
  | "awakening"
  | "artifact-apps"
  | "artifact-app-agents"
  | "artifact-app-storage"
  | "conversation-artifacts"
  | "unknown";

export interface SpacesUserAuth {
  /** Short-lived Spaces workspace JWT for `userId` in `workspaceId`. */
  token: string;
  /** Workspace the token is scoped to — send as `x-workspace-id`. */
  workspaceId: string;
  /** Spaces user id (`public.users.id`) the token acts as. */
  userId: string;
  /** Epoch ms after which `token` is rejected. */
  expiresAt: number;
}

/** Re-mint this long before `expiresAt` so a token never expires mid-call. */
const REFRESH_SKEW_MS = 120_000;
const MINT_TIMEOUT_MS = 5_000;
/** Spaces' default `WORKSPACE_TOKEN_TTL_SECONDS`; used only when a 200 omits `expiresIn`. */
const DEFAULT_TTL_SECONDS = 3600;

const cache = new Map<string, SpacesUserAuth>();
const inflight = new Map<string, Promise<SpacesUserAuth | null>>();

function cacheKey(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`;
}

function s2sKey(): string {
  return process.env["INTERNAL_S2S_KEY"] ?? process.env["XYNE_CLAW_S2S_KEY"] ?? "";
}

interface MintResponse {
  token?: unknown;
  expiresIn?: unknown;
  workspaceId?: unknown;
  userId?: unknown;
  error?: unknown;
}

async function mintUncached(
  userId: string,
  workspaceId: string,
  caller: SpacesAuthCaller,
): Promise<SpacesUserAuth | null> {
  const started = Date.now();
  const key = s2sKey();
  if (!key) {
    log.warn(`[spaces-auth] mint userId=${userId} caller=${caller} result=no-s2s-key (set INTERNAL_S2S_KEY)`);
    return null;
  }
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(`${CONFIG.spacesInternalUrl}/api/internal/auth/token`, {
      method: "POST",
      headers: { "x-s2s-key": key, "content-type": "application/json" },
      body: JSON.stringify({ userId, workspaceId }),
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    });
  } catch (err) {
    log.warn(
      `[spaces-auth] mint userId=${userId} workspaceId=${workspaceId} caller=${caller} result=network ms=${Date.now() - started} err=${errMsg(err)}`,
    );
    return null;
  }

  const elapsed = Date.now() - started;
  if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 409) {
    const body = (await res.json().catch(() => null)) as MintResponse | null;
    const reason = typeof body?.error === "string" ? body.error : `http_${res.status}`;
    // 409 no_active_session is the everyday "user is logged out everywhere"
    // answer; 404/403 mean a stale userId / workspace pairing; 401 is a key
    // mismatch between claw-auth and Spaces (ops).
    log.info(
      `[spaces-auth] mint userId=${userId} workspaceId=${workspaceId} caller=${caller} result=miss reason=${reason} ms=${elapsed}`,
    );
    return null;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log.warn(
      `[spaces-auth] mint userId=${userId} workspaceId=${workspaceId} caller=${caller} result=upstream_${res.status} ms=${elapsed} body=${text.slice(0, 200)}`,
    );
    return null;
  }

  const body = (await res.json().catch(() => null)) as MintResponse | null;
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) {
    log.warn(`[spaces-auth] mint userId=${userId} workspaceId=${workspaceId} caller=${caller} result=malformed-200 ms=${elapsed}`);
    return null;
  }
  const expiresInRaw = Number(body?.expiresIn);
  const expiresIn = Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? expiresInRaw : DEFAULT_TTL_SECONDS;
  const auth: SpacesUserAuth = {
    token,
    workspaceId: typeof body?.workspaceId === "string" && body.workspaceId ? body.workspaceId : workspaceId,
    userId: typeof body?.userId === "string" && body.userId ? body.userId : userId,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  log.info(
    `[spaces-auth] mint userId=${userId} workspaceId=${auth.workspaceId} caller=${caller} result=hit expiresIn=${expiresIn}s ms=${elapsed}`,
  );
  return auth;
}

/**
 * A live Spaces user credential for `userId`, minted via the S2S token
 * endpoint and cached until shortly before expiry.
 *
 * `workspaceId` defaults to the user's own workspace (`public.users.workspaceId`
 * via `getWorkspaceIdForUser`). Returns `null` when the workspace cannot be
 * resolved, the user has no live Spaces session anywhere (409), the pairing is
 * invalid (403/404), the S2S key is rejected (401), or Spaces is unreachable —
 * callers treat every `null` as "no live Spaces session".
 */
export async function mintSpacesToken(
  input: { userId: string; workspaceId?: string | undefined },
  caller: SpacesAuthCaller = "unknown",
): Promise<SpacesUserAuth | null> {
  const userId = input.userId?.trim();
  if (!userId) return null;

  let workspaceId = input.workspaceId?.trim();
  if (!workspaceId) {
    workspaceId = (await getWorkspaceIdForUser(userId, caller).catch(() => null)) ?? undefined;
    if (!workspaceId) {
      log.info(`[spaces-auth] mint userId=${userId} caller=${caller} result=miss reason=no_workspace`);
      return null;
    }
  }

  const key = cacheKey(userId, workspaceId);
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt - REFRESH_SKEW_MS) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = mintUncached(userId, workspaceId, caller)
    .then((auth) => {
      if (auth) cache.set(key, auth);
      else cache.delete(key);
      return auth;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Drop cached tokens for a user — one workspace, or every workspace when omitted. */
export function invalidateSpacesToken(userId: string, workspaceId?: string): void {
  if (workspaceId) {
    cache.delete(cacheKey(userId, workspaceId));
    return;
  }
  const prefix = `${userId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** The headers Spaces APIs need to act as this user. */
export function spacesAuthHeaders(a: SpacesUserAuth): Record<string, string> {
  return { Authorization: `Bearer ${a.token}`, "x-workspace-id": a.workspaceId };
}

interface JwtClaims {
  sub?: unknown;
  userId?: unknown;
  workspaceId?: unknown;
  exp?: unknown;
}

/** Payload of a JWT-shaped string, decoded WITHOUT verification (Spaces
 *  verifies the signature); `null` for anything that is not a JWT — e.g. a
 *  `xyne_cli_*` / `xyne_svc_*` access token presented to requireAuth. */
export function decodeJwtClaims(token: string): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    return typeof claims === "object" && claims !== null ? (claims as JwtClaims) : null;
  } catch {
    return null;
  }
}

function headerString(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = typeof first === "string" ? first.trim() : "";
  return trimmed || undefined;
}

function cookieValue(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`).exec(raw);
  const value = match?.[1]?.trim();
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Explicit Spaces JWT the caller supplied (SDK / CLI / S2S on behalf of a
 *  user): `body.userToken`, else a JWT-shaped `Authorization: Bearer`. */
function explicitJwt(req: Request): string | undefined {
  const bodyToken = (req.body as { userToken?: unknown } | undefined)?.userToken;
  if (typeof bodyToken === "string" && bodyToken.trim()) return bodyToken.trim();
  const header = req.headers.authorization;
  if (typeof header !== "string") return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && decodeJwtClaims(token) ? token : undefined;
}

/**
 * The Spaces credential to use for this inbound request.
 *
 * 1. An explicit JWT (`body.userToken` / JWT-shaped `Authorization: Bearer`) is
 *    honoured as-is — the caller already decided. Its `workspaceId`/`sub`
 *    claims fill the rest (header `x-workspace-id` wins over the claim).
 * 2. Otherwise the identity requireAuth attached (`x-user-id`, or
 *    `opts.userId` when the route derives the user itself) is minted a token
 *    for `x-workspace-id` → `xyne_last_workspace` cookie → the user's own
 *    workspace.
 *
 * Browsers no longer carry a `xyne_ws_*` cookie, so a cookie-only request
 * yields a credential only after requireAuth identified the user via
 * `/api/auth/me` (which forwards the raw `Cookie` holding `xs`).
 */
export async function spacesCredentialsFor(
  req: Request,
  caller: SpacesAuthCaller = "unknown",
  opts: { userId?: string | undefined } = {},
): Promise<SpacesUserAuth | null> {
  const headerWorkspace = headerString(req, "x-workspace-id");
  const token = explicitJwt(req);
  if (token) {
    const claims = decodeJwtClaims(token) ?? {};
    const claimWorkspace = typeof claims.workspaceId === "string" ? claims.workspaceId : "";
    const claimUser =
      typeof claims.sub === "string" ? claims.sub : typeof claims.userId === "string" ? claims.userId : "";
    const exp = typeof claims.exp === "number" ? claims.exp * 1000 : Date.now() + DEFAULT_TTL_SECONDS * 1000;
    return {
      token,
      workspaceId: headerWorkspace ?? claimWorkspace,
      userId: claimUser || opts.userId?.trim() || headerString(req, "x-user-id") || "",
      expiresAt: exp,
    };
  }

  const userId = opts.userId?.trim() || headerString(req, "x-user-id");
  if (!userId) return null;
  const workspaceId = headerWorkspace ?? cookieValue(req, "xyne_last_workspace");
  return mintSpacesToken({ userId, workspaceId }, caller);
}

/**
 * `fetch` as a Spaces user with one 401 retry: a 401 drops the cached token,
 * re-mints, and repeats the request once when a fresh token came back. Pass
 * `init.headers` for anything beyond the auth pair (content-type, …).
 */
export async function fetchAsSpacesUser(
  auth: SpacesUserAuth,
  url: string,
  init: RequestInit = {},
  caller: SpacesAuthCaller = "unknown",
): Promise<Awaited<ReturnType<typeof fetch>>> {
  const send = (a: SpacesUserAuth) =>
    fetch(url, {
      ...init,
      headers: { ...((init.headers as Record<string, string> | undefined) ?? {}), ...spacesAuthHeaders(a) },
    });
  const first = await send(auth);
  if (first.status !== 401 || !auth.userId) return first;
  invalidateSpacesToken(auth.userId, auth.workspaceId);
  const fresh = await mintSpacesToken({ userId: auth.userId, workspaceId: auth.workspaceId }, caller);
  if (!fresh || fresh.token === auth.token) return first;
  log.info(`[spaces-auth] 401 from ${url.split("?")[0]} — retrying once with a re-minted token (caller=${caller})`);
  await first.body?.cancel().catch(() => {});
  return send(fresh);
}

/**
 * Mint-then-fetch convenience for server-side paths that only know a userId.
 * `null` when no live Spaces session exists for the user.
 */
export async function fetchForSpacesUser(
  input: { userId: string; workspaceId?: string | undefined },
  url: string,
  init: RequestInit = {},
  caller: SpacesAuthCaller = "unknown",
): Promise<Awaited<ReturnType<typeof fetch>> | null> {
  const auth = await mintSpacesToken(input, caller);
  if (!auth) return null;
  return fetchAsSpacesUser(auth, url, init, caller);
}

/**
 * Compat shim for the former `lib/spaces-db.ts` export of the same name. Same
 * "live credential or null" contract, minus `sessionId` (there is no session
 * cookie to forge any more).
 */
export const getSpacesAuthForUser = (
  userId: string,
  caller: SpacesAuthCaller = "unknown",
): Promise<SpacesUserAuth | null> => mintSpacesToken({ userId }, caller);

/** Test hook — clears the token cache and in-flight mints. */
export function __resetSpacesAuthCacheForTests(): void {
  cache.clear();
  inflight.clear();
}
