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
import { errMsg } from "./errors.js";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";
import { withRetry } from "../retry.js";

import { createLogger } from "../logger.js";
const log = createLogger("spaces-db");

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
      log.warn(`[spaces-db] refresh-session sessionId=${sessionId} status=${res.status}`);
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
        log.info(`[spaces-db] refresh-session matched JWT-shaped cookie name=${m[1]}`);
        return decodeURIComponent(m[2]);
      }
    }
    log.warn(`[spaces-db] refresh-session sessionId=${sessionId} response cookies=[${cookies.map((c) => c.split("=")[0]).join(",")}] — no token-bearing cookie found`);
    return null;
  } catch (err) {
    log.warn(
      `[spaces-db] refresh-session sessionId=${sessionId} failed: ${errMsg(err)}`,
    );
    return null;
  }
}

function buildClient() {
  return new PrismaClient({
    datasourceUrl: CONFIG.spacesDbUrl,
    log: ["error"],
  }).$extends({
    query: {
      $allOperations({ operation, model, args, query }) {
        return withRetry(() => query(args), `spaces-db.${model ?? "raw"}.${operation}`);
      },
    },
  });
}

type SpacesDbClient = ReturnType<typeof buildClient>;

let _client: SpacesDbClient | null = null;
let _initFailed = false;

/**
 * Lazy-init a PrismaClient pointed at the Spaces DB. Idempotent — first caller
 * pays the connection cost, everyone else reuses. If init fails (bad URL,
 * unreachable DB) we mark it so subsequent calls short-circuit without
 * thrashing on retries; the operator can fix env + restart.
 */
function getClient(): SpacesDbClient | null {
  if (_initFailed) return null;
  if (_client) return _client;
  if (!CONFIG.spacesDbUrl) return null;

  try {
    _client = buildClient();
    log.info("[spaces-db] Read-only client initialized");
    return _client;
  } catch (err) {
    log.error("[spaces-db] Failed to init client:", err instanceof Error ? err.message : err);
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
  | "clone-owner-dm"
  | "skill-update-owner-dm"
  | "awakening"
  | "artifact-apps"
  | "artifact-app-agents"
  | "artifact-app-storage"
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
      log.info(`[spaces-db] read userId=${userId} caller=${caller} result=miss-no-session ms=${elapsed}`);
      return null;
    }
    if (!row.workspaceId) {
      log.info(`[spaces-db] read userId=${userId} caller=${caller} result=miss-no-workspace ms=${elapsed}`);
      return null;
    }

    const now = Date.now();
    const tokenValid = row.accessToken && row.accessTokenExpiry && row.accessTokenExpiry.getTime() > now;

    if (tokenValid) {
      log.info(`[spaces-db] read userId=${userId} caller=${caller} result=hit workspaceId=${row.workspaceId} ms=${elapsed}`);
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
    log.info(
      `[spaces-db] read userId=${userId} caller=${caller} result=stale (${staleReason}) ms=${elapsed} → refreshing`,
    );
    const freshToken = await refreshSpacesAccessToken(row.id, row.workspaceId);
    if (!freshToken) {
      log.info(`[spaces-db] read userId=${userId} caller=${caller} result=refresh-failed`);
      return null;
    }
    log.info(
      `[spaces-db] read userId=${userId} caller=${caller} result=refreshed workspaceId=${row.workspaceId} tokenLen=${freshToken.length}`,
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
    log.warn(
      `[spaces-db] read userId=${userId} caller=${caller} result=error ms=${elapsed} err=${errMsg(err)}`,
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
  /// The user's current Spaces workspace (public.users.workspaceId). Used by
  /// JIT to map the user to a claw org via SurfaceTenantLink. May be null.
  workspaceId: string | null;
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
      SELECT id, email, name, "workspaceId"
      FROM public.users
      WHERE id = ${userId}
      LIMIT 1
    `;
    const row = rows[0];
    const elapsed = Date.now() - started;
    log.info(
      `[spaces-db] user-lookup userId=${userId} caller=${caller} result=${row ? "hit" : "miss"} ms=${elapsed}`,
    );
    return row ?? null;
  } catch (err) {
    const elapsed = Date.now() - started;
    log.warn(
      `[spaces-db] user-lookup userId=${userId} caller=${caller} result=error ms=${elapsed} err=${errMsg(err)}`,
    );
    return null;
  }
}

/**
 * Resolve a user's workspaceId directly from `public.users`, WITHOUT requiring
 * an active login session. `getSpacesAuthForUser` only returns a workspaceId
 * when the user has a live, non-expired session — so scheduled jobs created by
 * a user who isn't currently logged in (the common case for a "remind me at
 * 10 PM" typed hours earlier, or any S2S/automation trigger) fell through to a
 * NULL workspaceId and Spaces then rejected result delivery. The workspaceId
 * lives on the user row itself, so this session-independent lookup is the
 * reliable fallback. Single-workspace deployment → one workspaceId per user.
 *
 * Returns null when SPACES_DB_URL is unset, the user is missing, the column is
 * NULL, or on any DB error — callers treat null as "couldn't resolve".
 */
export async function getWorkspaceIdForUser(
  userId: string,
  caller: SpacesAuthCaller = "unknown",
): Promise<string | null> {
  if (!userId) return null;

  const started = Date.now();
  const client = getClient();
  if (client) try {
    const rows = await client.$queryRaw<Array<{ workspaceId: string | null }>>`
      SELECT "workspaceId"
      FROM public.users
      WHERE id = ${userId}
      LIMIT 1
    `;
    const workspaceId = rows[0]?.workspaceId ?? null;
    const elapsed = Date.now() - started;
    log.info(
      `[spaces-db] workspace-lookup userId=${userId} caller=${caller} result=${workspaceId ? "hit" : "miss"}${workspaceId ? ` workspaceId=${workspaceId}` : ""} ms=${elapsed}`,
    );
    if (workspaceId) return workspaceId;
  } catch (err) {
    const elapsed = Date.now() - started;
    log.warn(
      `[spaces-db] workspace-lookup userId=${userId} caller=${caller} result=error ms=${elapsed} err=${errMsg(err)}`,
    );
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { orgId: true },
    });
    if (!user?.orgId) return null;

    const links = await prisma.surfaceTenantLink.findMany({
      where: { surfaceType: "spaces", orgId: user.orgId },
      select: { surfaceTenantId: true },
      take: 2,
    });
    if (links.length === 1) {
      const workspaceId = links[0]!.surfaceTenantId;
      const elapsed = Date.now() - started;
      log.info(
        `[spaces-db] workspace-lookup userId=${userId} caller=${caller} result=hit-claw-link workspaceId=${workspaceId} orgId=${user.orgId} ms=${elapsed}`,
      );
      return workspaceId;
    }
    if (links.length > 1) {
      log.warn(
        `[spaces-db] workspace-lookup userId=${userId} caller=${caller} result=ambiguous-claw-link orgId=${user.orgId}`,
      );
    }
    return null;
  } catch (err) {
    const elapsed = Date.now() - started;
    log.warn(
      `[spaces-db] workspace-lookup userId=${userId} caller=${caller} result=claw-link-error ms=${elapsed} err=${errMsg(err)}`,
    );
    return null;
  }
}

/**
 * Resolve the existing 1:1 Spaces DM channel between a human user and an
 * installed app's APP user. This is read-only: callers fall back to headless
 * delivery when no single channel is found.
 */
export async function getDmChannelForUserAndApp(
  userId: string,
  spacesAppId: string,
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;
  const trimmedUserId = userId.trim();
  const trimmedAppId = spacesAppId.trim();
  if (!trimmedUserId || !trimmedAppId) return null;

  const workspaceId = await getWorkspaceIdForUser(trimmedUserId, "mcp-runner");
  if (!workspaceId) return null;

  const appProviderUserId = `xyne-app-${trimmedAppId}`;
  const started = Date.now();
  try {
    const rows = await client.$queryRaw<Array<{ id: string }>>`
      WITH app_users AS (
        SELECT ia."userId" AS id
        FROM public.installed_apps ia
        JOIN public.apps a ON a.id = ia."appId"
        JOIN public.users creator ON creator.id = a."createdBy"
        WHERE ia."appId" = ${trimmedAppId}
          AND creator."workspaceId" = ${workspaceId}
        UNION
        SELECT app_user.id
        FROM public.users app_user
        WHERE app_user."providerUserId" = ${appProviderUserId}
          AND (app_user."workspaceId" = ${workspaceId} OR app_user."workspaceId" IS NULL)
      )
      SELECT c.id
      FROM public.channels c
      JOIN public.channel_participants human_cp
        ON human_cp."channelId" = c.id AND human_cp."userId" = ${trimmedUserId}
      JOIN public.channel_participants app_cp
        ON app_cp."channelId" = c.id AND app_cp."userId" IN (SELECT id FROM app_users)
      WHERE c."scopeType" = 'DM'
        AND (
          SELECT COUNT(*)
          FROM public.channel_participants count_cp
          WHERE count_cp."channelId" = c.id
        ) = 2
      ORDER BY c."updatedAt" DESC
      LIMIT 2
    `;
    const elapsed = Date.now() - started;
    if (rows.length === 1) {
      log.info(`[spaces-db] dm-channel userId=${trimmedUserId} spacesAppId=${trimmedAppId} workspaceId=${workspaceId} result=hit channelId=${rows[0]!.id} ms=${elapsed}`);
      return rows[0]!.id;
    }
    log.info(`[spaces-db] dm-channel userId=${trimmedUserId} spacesAppId=${trimmedAppId} workspaceId=${workspaceId} result=${rows.length === 0 ? "miss" : "ambiguous"} ms=${elapsed}`);
    return null;
  } catch (err) {
    const elapsed = Date.now() - started;
    log.warn(
      `[spaces-db] dm-channel userId=${trimmedUserId} spacesAppId=${trimmedAppId} workspaceId=${workspaceId} result=error ms=${elapsed} err=${errMsg(err)}`,
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
      log.warn(`[spaces-db] installed-app-secret spacesAppId=${spacesAppId} result=miss`);
      return null;
    }
    return blob;
  } catch (err) {
    log.warn(
      `[spaces-db] installed-app-secret spacesAppId=${spacesAppId} result=error err=${errMsg(err)}`,
    );
    return null;
  }
}

/**
 * Resolve a user-group mention alias (e.g. `data-intelligence`) → group, read
 * DIRECTLY from `public.user_groups`. This bypasses the `/api/query` gateway,
 * which forbids the `userGroup` model ("Model userGroup is not allowed for
 * querying"), and the group-read REST routes, which were removed (reads moved
 * to Zero/zql) — so a direct DB read is the only server-side path for the
 * mention resolver to tag `@group`s.
 *
 * `alias` is GLOBALLY @unique with NO workspace column in the schema, so the
 * match is unambiguous (0 or 1). LIMIT 2 is defensive only. Active groups only.
 *
 * Requires `GRANT SELECT ON public.user_groups TO claw_readonly` on the Spaces
 * DB role (in addition to the existing users / user_sessions / installed_apps
 * grants). Returns [] when SPACES_DB_URL is unset, no match, or on any error.
 */
export async function getSpacesGroupByAlias(
  alias: string,
): Promise<Array<{ id: string; name: string; alias: string | null }>> {
  const client = getClient();
  if (!client) return [];
  const trimmed = alias.trim();
  if (!trimmed) return [];

  try {
    const rows = await client.$queryRaw<Array<{ id: string; name: string; alias: string | null }>>`
      SELECT id, name, alias
      FROM public.user_groups
      WHERE lower(alias) = lower(${trimmed}) AND "isActive" = true
      LIMIT 2
    `;
    return rows;
  } catch (err) {
    log.warn(
      `[spaces-db] group-by-alias alias=${trimmed} result=error err=${errMsg(err)}`,
    );
    return [];
  }
}

/** True when the Spaces read-only DB client is configured + initialised. */
export function spacesDbAvailable(): boolean {
  return getClient() !== null;
}

type UserHit = { id: string; name: string };

// Only ever resolve a mention to a real, active HUMAN — never a BOT/APP user
// (they'd be tagged as "people" otherwise). `name` and `displayName` are both
// candidates because agents emit either; we return the canonical `name` for the
// chip label. LIMIT 2 preserves the resolver's "≥2 ⇒ ambiguous, skip" rule.
const HUMAN = `"userType" = 'USER' AND status = 'ACTIVE'`;

/**
 * Resolve `@First Last` → active human users with that exact (case-insensitive)
 * display name. Direct DB read — bypasses the app-token 401 on Spaces' HTTP
 * user endpoints. Returns 0/1/2 rows (caller treats ≥2 as ambiguous).
 *
 * Requires `GRANT SELECT ON public.users TO claw_readonly`.
 */
export async function getSpacesUsersByName(name: string, workspaceId?: string): Promise<UserHit[]> {
  const client = getClient();
  if (!client) return [];
  const trimmed = name.trim();
  if (!trimmed) return [];
  // Scope to the agent's workspace when known — `public.users.workspaceId`
  // exists in prod (see getSpacesAuthForUser) even though it isn't in the Prisma
  // model. Without it, a common name shared across workspaces (e.g. a
  // cross-platform import) matches ≥2 rows and the resolver leaves it untagged.
  const params: string[] = [trimmed];
  let wsClause = "";
  if (workspaceId && workspaceId.trim()) {
    params.push(workspaceId.trim());
    wsClause = ` AND "workspaceId" = $2`;
  }
  try {
    return await client.$queryRawUnsafe<UserHit[]>(
      `SELECT id, name FROM public.users
       WHERE ${HUMAN} AND (lower(name) = lower($1) OR lower("displayName") = lower($1))${wsClause}
       LIMIT 2`,
      ...params,
    );
  } catch (err) {
    log.warn(`[spaces-db] users-by-name name=${trimmed} err=${errMsg(err)}`);
    return [];
  }
}

/** The workspace a user belongs to (`public.users.workspaceId`). Used to scope
 *  name resolution to the agent's own workspace. Returns null if unknown. */
export async function getSpacesUserWorkspaceId(userId: string): Promise<string | null> {
  const client = getClient();
  if (!client) return null;
  const trimmed = userId.trim();
  if (!trimmed) return null;
  try {
    const rows = await client.$queryRawUnsafe<Array<{ workspaceId: string | null }>>(
      `SELECT "workspaceId" FROM public.users WHERE id = $1 LIMIT 1`,
      trimmed,
    );
    return rows[0]?.workspaceId ?? null;
  } catch (err) {
    log.warn(`[spaces-db] user-workspace userId=${trimmed} err=${errMsg(err)}`);
    return null;
  }
}

/** Resolve `@email@domain` → the active user with that email (email is @unique). */
export async function getSpacesUserByEmail(email: string, workspaceId?: string): Promise<UserHit[]> {
  const client = getClient();
  if (!client) return [];
  const trimmed = email.trim();
  if (!trimmed) return [];
  // Emails are NOT globally unique: the same person is imported into multiple
  // workspaces (one users row each), so an unscoped lookup returns ≥2 rows and
  // the mention resolver leaves it untagged (prod bug — @email never resolved
  // while @Name did). Scope to the agent's workspace when known, like byName.
  const params: string[] = [trimmed];
  let wsClause = "";
  if (workspaceId && workspaceId.trim()) {
    params.push(workspaceId.trim());
    wsClause = ` AND "workspaceId" = $2`;
  }
  try {
    return await client.$queryRawUnsafe<UserHit[]>(
      `SELECT id, name FROM public.users WHERE status = 'ACTIVE' AND lower(email) = lower($1)${wsClause} LIMIT 2`,
      ...params,
    );
  } catch (err) {
    log.warn(`[spaces-db] user-by-email err=${errMsg(err)}`);
    return [];
  }
}

/** Resolve a dotted handle (`@bowmitha.c`) → the user whose email local-part is
 *  the handle (email starts `${handle}@`). Matches the HTTP byHandle semantics. */
export async function getSpacesUsersByHandle(handle: string, workspaceId?: string): Promise<UserHit[]> {
  const client = getClient();
  if (!client) return [];
  const trimmed = handle.trim();
  if (!trimmed) return [];
  // Same cross-workspace duplication as byEmail — scope to the workspace when known.
  const params: string[] = [trimmed];
  let wsClause = "";
  if (workspaceId && workspaceId.trim()) {
    params.push(workspaceId.trim());
    wsClause = ` AND "workspaceId" = $2`;
  }
  try {
    return await client.$queryRawUnsafe<UserHit[]>(
      `SELECT id, name FROM public.users WHERE status = 'ACTIVE' AND lower(email) LIKE lower($1) || '@%'${wsClause} LIMIT 2`,
      ...params,
    );
  } catch (err) {
    log.warn(`[spaces-db] users-by-handle err=${errMsg(err)}`);
    return [];
  }
}

/** Graceful shutdown — called from main.ts shutdown handler. */
export async function disconnectSpacesDb(): Promise<void> {
  if (_client) {
    await _client.$disconnect().catch(() => {});
    _client = null;
  }
}
