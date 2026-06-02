/**
 * Read-only client for the Spaces Postgres DB.
 *
 * Purpose: fetch a user's current Spaces session credentials (access token,
 * session id, workspace id) directly from the source of truth instead of
 * trusting the cached copy in claw-auth's `userMcpConnection` table.
 *
 * The cached copy gets stale silently — when Spaces' middleware refreshes
 * the user's JWT it writes a new row but doesn't notify claw-auth, so MCP
 * children spawned with cached env values eventually 401 ("Token expired
 * and no session provided for refresh"). Reading from the source eliminates
 * that entire failure class.
 *
 * Isolation contract:
 * - One-way connection: claw-auth → Spaces DB. Spaces never knows claw exists.
 * - Read-only. The deploy-time Postgres role grants SELECT only on
 *   `public.users` and `workflow.user_sessions`. Even if a future bug here
 *   tried to write, Postgres refuses.
 * - Auto-disabled when `SPACES_DB_URL` is empty (no client created, all
 *   callers see `null` and fall back to existing cached-creds path).
 */

import { PrismaClient } from "@prisma/client";
import { CONFIG } from "../config.js";

export interface SpacesUserAuth {
  /** Spaces user JWT (workspace-scoped if available, else legacy access token). */
  token: string;
  /** Session row id (used as `xyne_session` cookie value when calling Spaces APIs). */
  sessionId: string;
  /** Workspace the session belongs to. Required by Spaces' legacy `auth.ts` to
   *  even attempt JWT refresh. */
  workspaceId: string;
}

interface UserSessionRow {
  id: string;
  accessToken: string | null;
  accessTokenExpiry: Date | null;
  refreshTokenExpiry: Date;
  status: string;
  lastActivity: Date;
  workspaceId: string | null;
}

/**
 * Force Spaces to mint a fresh JWT for an existing session and return it.
 * Used when `accessToken` in the DB is missing/expired but the refresh window
 * is still valid — mirrors what Spaces' own auth middleware does on every
 * request with a stale cookie.
 *
 * Spaces' `GET /api/auth/refresh-session`:
 *   - reads `user_session_id` cookie
 *   - mints a new JWT via `jwtService.generateToken`
 *   - sets it on the response as the `google_access_token` cookie
 *   - returns `{ success: true }` (the JWT itself is ONLY in Set-Cookie)
 *
 * We parse the Set-Cookie header to extract the new JWT. Returns null on any
 * failure — caller treats null as "no live cred, fall back to cached path".
 */
async function refreshSpacesAccessToken(sessionId: string, workspaceId: string): Promise<string | null> {
  if (!CONFIG.spacesInternalUrl) return null;
  try {
    const res = await fetch(`${CONFIG.spacesInternalUrl}/api/auth/refresh-session`, {
      method: "GET",
      headers: { cookie: `user_session_id=${sessionId}` },
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
    });
    if (!res.ok) {
      console.warn(`[spaces-db] refresh-session sessionId=${sessionId} status=${res.status}`);
      return null;
    }
    const cookies = res.headers.getSetCookie?.() ?? [];
    // Spaces sets the JWT under one of two cookie names depending on version:
    //   - legacy:    google_access_token=<jwt>
    //   - workspace: xyne_ws_<workspaceId>_token=<jwt>
    // Try both. Fallback: pick the first cookie whose value looks like a JWT
    // (starts with `eyJ`) so we don't break if the name changes again.
    const wantedNames = [
      `xyne_ws_${workspaceId}_token`,
      "google_access_token",
    ];
    for (const c of cookies) {
      for (const name of wantedNames) {
        const m = c.match(new RegExp(`^${name}=([^;]+)`));
        if (m && m[1]) return decodeURIComponent(m[1]);
      }
    }
    for (const c of cookies) {
      const m = c.match(/^([a-zA-Z0-9_]+)=(eyJ[^;]+)/);
      if (m && m[2]) {
        console.log(`[spaces-db] refresh-session matched JWT-shaped cookie name=${m[1]}`);
        return decodeURIComponent(m[2]);
      }
    }
    console.warn(`[spaces-db] refresh-session sessionId=${sessionId} response cookies=[${cookies.map((c) => c.split("=")[0]).join(",")}] — no token-bearing cookie found`);
    return null;
  } catch (err) {
    console.warn(
      `[spaces-db] refresh-session sessionId=${sessionId} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

let _client: PrismaClient | null = null;
let _initFailed = false;

/**
 * Lazy-init a PrismaClient pointed at the Spaces DB. Idempotent — first caller
 * pays the connection cost, everyone else reuses. If init fails (bad URL,
 * unreachable DB) we mark it so subsequent calls short-circuit without
 * thrashing on retries; the operator can fix env + restart.
 */
function getClient(): PrismaClient | null {
  if (_initFailed) return null;
  if (_client) return _client;
  if (!CONFIG.spacesDbUrl) return null;

  try {
    _client = new PrismaClient({
      datasourceUrl: CONFIG.spacesDbUrl,
      log: ["error"],
    });
    console.log("[spaces-db] Read-only client initialized");
    return _client;
  } catch (err) {
    console.error("[spaces-db] Failed to init client:", err instanceof Error ? err.message : err);
    _initFailed = true;
    return null;
  }
}

/**
 * Return the user's most recent ACTIVE Spaces session, or `null` if:
 *   - `SPACES_DB_URL` is unset (feature off)
 *   - the user has no active session row
 *   - the session's refresh-token window has elapsed
 *   - the row is missing essential fields (accessToken / workspaceId)
 *   - any DB error
 *
 * Callers should treat `null` as "fall back to cached credentials" — never
 * as a hard failure. The cached path still works in 99% of cases; this
 * function exists to plug the 1% where the cache is stale.
 */
/** Audit trail tag — identifies which code path triggered the read so logs
 *  can be correlated with Spaces' Postgres-side query log for the
 *  `claw_readonly` role. Keep this enum-style so greps stay clean. */
export type SpacesAuthCaller =
  | "webhook"
  | "agent-chat"
  | "mcp-runner"
  | "require-auth"
  | "scheduled-job"
  | "write-action"
  | "unknown";

export async function getSpacesAuthForUser(
  userId: string,
  caller: SpacesAuthCaller = "unknown",
): Promise<SpacesUserAuth | null> {
  const client = getClient();
  if (!client) return null;
  if (!userId) return null;

  const started = Date.now();
  try {
    // Most recently active non-expired session for this user.
    // `workspaceId` lives on `public.users.workspaceId`, NOT on the session
    // row — sessions inherit the user's workspace. We join on `userId` to
    // pull both in one query.
    const rows = await client.$queryRaw<Array<UserSessionRow>>`
      SELECT
        s.id,
        s."accessToken",
        s."accessTokenExpiry",
        s."refreshTokenExpiry",
        s.status::text AS status,
        s."lastActivity",
        u."workspaceId"
      FROM workflow.user_sessions s
      JOIN public.users u ON u.id = s."userId"
      WHERE s."userId" = ${userId}
        AND s.status = 'ACTIVE'
        AND s."refreshTokenExpiry" > NOW()
      ORDER BY s."lastActivity" DESC
      LIMIT 1
    `;

    const row = rows[0];
    const elapsed = Date.now() - started;

    if (!row) {
      console.log(`[spaces-db] read userId=${userId} caller=${caller} result=miss-no-session ms=${elapsed}`);
      return null;
    }
    if (!row.workspaceId) {
      console.log(`[spaces-db] read userId=${userId} caller=${caller} result=miss-no-workspace ms=${elapsed}`);
      return null;
    }

    const now = Date.now();
    const tokenValid = row.accessToken && row.accessTokenExpiry && row.accessTokenExpiry.getTime() > now;

    if (tokenValid) {
      console.log(`[spaces-db] read userId=${userId} caller=${caller} result=hit ms=${elapsed}`);
      return {
        token: row.accessToken!,
        sessionId: row.id,
        workspaceId: row.workspaceId,
      };
    }

    // accessToken missing or expired but the session row itself is still
    // alive (refreshTokenExpiry > NOW already filtered). Ask Spaces to mint
    // a fresh JWT for this session — same path Spaces' own middleware uses.
    const staleReason = !row.accessToken ? "null-token" : "expired-token";
    console.log(
      `[spaces-db] read userId=${userId} caller=${caller} result=stale (${staleReason}) ms=${elapsed} → refreshing`,
    );
    const freshToken = await refreshSpacesAccessToken(row.id, row.workspaceId);
    if (!freshToken) {
      console.log(`[spaces-db] read userId=${userId} caller=${caller} result=refresh-failed`);
      return null;
    }
    console.log(
      `[spaces-db] read userId=${userId} caller=${caller} result=refreshed tokenLen=${freshToken.length}`,
    );
    return {
      token: freshToken,
      sessionId: row.id,
      workspaceId: row.workspaceId,
    };
  } catch (err) {
    // Don't crash the whole MCP spawn over a DB hiccup — surface as null and
    // let the caller fall back to cached creds.
    const elapsed = Date.now() - started;
    console.warn(
      `[spaces-db] read userId=${userId} caller=${caller} result=error ms=${elapsed} err=${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Minimum user profile fields needed to JIT-create a claw_auth `users` row.
 * Spaces stores more (avatar, locale, etc.) — we only mirror what claw needs.
 */
export interface SpacesUserProfile {
  id: string;
  email: string;
  name: string;
}

/**
 * Look up a Spaces user's profile by id. Used by `ensureUserExists` to JIT-
 * create the matching claw_auth `users` row the first time a request
 * references a user we haven't seen yet — eliminates the "log in to the
 * dashboard once before webhooks work" prerequisite.
 *
 * Returns null on the usual reasons (SPACES_DB_URL unset, user not in Spaces,
 * DB error). Callers must treat null as "skip JIT, request fails normally".
 */
export async function getSpacesUserById(
  userId: string,
  caller: SpacesAuthCaller = "unknown",
): Promise<SpacesUserProfile | null> {
  const client = getClient();
  if (!client) return null;
  if (!userId) return null;

  const started = Date.now();
  try {
    const rows = await client.$queryRaw<Array<SpacesUserProfile>>`
      SELECT id, email, name
      FROM public.users
      WHERE id = ${userId}
      LIMIT 1
    `;
    const row = rows[0];
    const elapsed = Date.now() - started;
    console.log(
      `[spaces-db] user-lookup userId=${userId} caller=${caller} result=${row ? "hit" : "miss"} ms=${elapsed}`,
    );
    return row ?? null;
  } catch (err) {
    const elapsed = Date.now() - started;
    console.warn(
      `[spaces-db] user-lookup userId=${userId} caller=${caller} result=error ms=${elapsed} err=${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Read the encrypted signing secret for a Spaces app directly from
 * `public.installed_apps`. Returns the raw AES-256-CBC blob
 * (`${ivHex}:${ciphertextHex}`) — the caller decrypts with
 * `decryptSpacesCbc` + SPACES_ENCRYPTION_KEY.
 *
 * One installation per app in our flow (apps are created+installed once),
 * so LIMIT 1 is sufficient. Returns null when SPACES_DB_URL is unset, the
 * row is missing, or on any DB error.
 *
 * Requires `GRANT SELECT ON public.installed_apps TO claw_readonly` on the
 * Spaces DB role (in addition to the existing users + user_sessions grants).
 */
export async function getInstalledAppSigningSecret(
  spacesAppId: string,
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;
  if (!spacesAppId) return null;

  try {
    const rows = await client.$queryRaw<Array<{ signingSecret: string }>>`
      SELECT "signingSecret"
      FROM public.installed_apps
      WHERE "appId" = ${spacesAppId}
      LIMIT 1
    `;
    const blob = rows[0]?.signingSecret;
    if (!blob) {
      console.warn(`[spaces-db] installed-app-secret spacesAppId=${spacesAppId} result=miss`);
      return null;
    }
    return blob;
  } catch (err) {
    console.warn(
      `[spaces-db] installed-app-secret spacesAppId=${spacesAppId} result=error err=${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** Graceful shutdown — called from main.ts shutdown handler. */
export async function disconnectSpacesDb(): Promise<void> {
  if (_client) {
    await _client.$disconnect().catch(() => {});
    _client = null;
  }
}
