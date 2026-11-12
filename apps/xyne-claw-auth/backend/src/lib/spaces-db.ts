/**
 * Spaces directory lookups for claw-auth: who a Spaces user is, which workspace
 * they are in, @mention resolution, and the DM with an agent's bot.
 *
 * claw-auth has NO access to the Spaces database. Each lookup is a signed,
 * read-only Spaces service call (claw/routes.ts /api/claw-agents/service/users,
 * /service/groups; claw/directory.ts) returning minimal fields, or the agent's
 * bot API (openDm). Lookups never throw: callers treat null / [] as "couldn't
 * resolve", exactly as before.
 */

import type { Request } from "express";
import { errMsg } from "./errors.js";
import { prisma } from "../db.js";
import { SpacesAgentError, agentCallsConfigured, serviceCall } from "./spaces-agent-client.js";
import { spacesAppFetch } from "../surfaces/spaces/client.js";

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


/**
 * Read the workspace requireAuth stamped on this request
 * (`x-spaces-workspace-id`), string-only. Pass it to getSpacesAuthForUser /
 * getWorkspaceIdForUser so a user holding memberships in two Spaces
 * workspaces resolves the identity for the workspace THIS request selected
 * instead of tripping the ambiguity guard.
 */
export function requestWorkspaceHint(req: Request): string | undefined {
  const raw = req.headers["x-spaces-workspace-id"];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}


/** A signed GET to a Spaces directory route; null on 404 or any error (logged). */
async function directoryGet<T>(path: string, what: string): Promise<T | null> {
  if (!agentCallsConfigured()) return null;
  try {
    return await serviceCall<T>("GET", path);
  } catch (err) {
    if (!(err instanceof SpacesAgentError && err.status === 404)) {
      log.warn(`[spaces-directory] ${what} failed: ${errMsg(err)}`);
    }
    return null;
  }
}

const enc = encodeURIComponent;

/** Which code path triggered a lookup (logged, for tracing). */
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
  | "conversation-artifacts"
  | "start-run"
  | "unknown";

/**
 * Translate a canonical Claw user id to its raw, workspace-scoped Spaces id.
 *
 * Spaces only knows its own user id (`public.users.id`), while all Claw-owned
 * records use `User.id`. Legacy rows happen to use the same value for both,
 * but newly provisioned users do not. Do not guess when a canonical user has
 * identities in multiple workspaces: callers must provide the workspace that
 * selected the request.
 */
interface SpacesIdentityRow {
  surfaceUserId: string;
  surfaceWorkspaceId: string | null;
}

async function resolveSpacesIdentity(
  clawUserId: string,
  workspaceId?: string | null,
): Promise<SpacesIdentityRow | null> {
  const user = await prisma.user.findUnique({
    where: { id: clawUserId },
    select: { id: true },
  });
  if (!user) return null;

  const identities = await prisma.userSurfaceIdentity.findMany({
    where: {
      surfaceId: "spaces",
      userId: clawUserId,
      status: "ACTIVE",
      ...(workspaceId ? { surfaceWorkspaceId: workspaceId } : {}),
    },
    select: { surfaceUserId: true, surfaceWorkspaceId: true },
    orderBy: { updatedAt: "desc" },
    take: 2,
  });
  if (identities.length === 1) return identities[0]!;
  if (identities.length > 1) {
    log.warn(
      `[spaces-db] identity resolution clawUserId=${clawUserId} result=ambiguous ` +
        `workspaceId=${workspaceId ?? "none"}`,
    );
  }
  return null;
}


/** The workspace of a RAW Spaces user id, from the Spaces directory. */
async function findUserWorkspaceRow(spacesUserId: string): Promise<{ workspaceId: string | null } | undefined> {
  const r = await directoryGet<{ user: { workspaceId: string | null } }>(`/api/claw-agents/service/users/${enc(spacesUserId)}`, "workspace-lookup");
  return r?.user ? { workspaceId: r.user.workspaceId } : undefined;
}

/**
 * Minimum user profile fields needed to JIT-create a claw_auth `users` row.
 * Spaces stores more (avatar, locale, etc.) — we only mirror what claw needs.
 */
export interface SpacesUserProfile {
  id: string;
  email: string;
  name: string;
  /** Stable person-in-org id (`public.org_members.memberId`). */
  spacesOrgMemberId: string | null;
  /// The user's current Spaces workspace (public.users.workspaceId). Used by
  /// JIT to map the user to a claw org via ConnectedSurface. May be null.
  workspaceId: string | null;
  /// The upstream Spaces org for workspaceId (public.workspaces.orgId). Used
  /// to validate connected_surfaces.surfaceOrgId before assigning a claw org.
  spacesOrgId: string | null;
}

/**
 * Look up a Spaces user's profile by id. Used by `ensureUserExists` to JIT-
 * create the matching claw_auth `users` row the first time a request
 * references a user we haven't seen yet — eliminates the "log in to the
 * dashboard once before webhooks work" prerequisite.
 *
 * Returns null when the user isn't in Spaces or the lookup fails. Callers must
 * treat null as "skip JIT, request fails normally".
 */
export async function getSpacesUserById(
  userId: string,
  caller: SpacesAuthCaller = "unknown",
): Promise<SpacesUserProfile | null> {
  if (!userId) return null;
  const started = Date.now();
  const r = await directoryGet<{ user: SpacesUserProfile }>(`/api/claw-agents/service/users/${enc(userId)}`, "user-lookup");
  const u = r?.user;
  log.info(`[spaces-directory] user-lookup userId=${userId} caller=${caller} result=${u ? "hit" : "miss"} ms=${Date.now() - started}`);
  return u
    ? { id: u.id, email: u.email, name: u.name, spacesOrgMemberId: u.spacesOrgMemberId ?? null, workspaceId: u.workspaceId ?? null, spacesOrgId: u.spacesOrgId ?? null }
    : null;
}

/**
 * Resolve a user's workspaceId from the Spaces directory, WITHOUT requiring
 * an active login session. `getSpacesAuthForUser` only returns a workspaceId
 * when the user has a live, non-expired session — so scheduled jobs created by
 * a user who isn't currently logged in (the common case for a "remind me at
 * 10 PM" typed hours earlier, or any S2S/automation trigger) fell through to a
 * NULL workspaceId and Spaces then rejected result delivery. The workspaceId
 * lives on the user row itself, so this session-independent lookup is the
 * reliable fallback. A canonical Claw user with several Spaces memberships
 * must supply its selected workspace; this helper deliberately refuses to
 * choose an arbitrary workspace.
 *
 * Returns null when the user is missing, has no workspace, or the lookup fails
 * — callers treat null as "couldn't resolve".
 */
export async function getWorkspaceIdForUser(
  userId: string,
  caller: SpacesAuthCaller = "unknown",
  requestedWorkspaceId?: string | null,
): Promise<string | null> {
  if (!userId) return null;

  const started = Date.now();
  try {
    let spacesUserId = userId;
    let row = await findUserWorkspaceRow(spacesUserId);
    if (!row) {
      const identity = await resolveSpacesIdentity(userId, requestedWorkspaceId);
      if (identity && identity.surfaceUserId !== spacesUserId) {
        spacesUserId = identity.surfaceUserId;
        row = await findUserWorkspaceRow(spacesUserId);
      }
    }
    const workspaceId = row?.workspaceId ?? null;
    log.info(
      `[spaces-directory] workspace-lookup userId=${userId} spacesUserId=${spacesUserId} caller=${caller} result=${workspaceId ? "hit" : "miss"}${workspaceId ? ` workspaceId=${workspaceId}` : ""} ms=${Date.now() - started}`,
    );
    if (workspaceId) return workspaceId;
  } catch (err) {
    log.warn(`[spaces-directory] workspace-lookup userId=${userId} caller=${caller} result=error err=${errMsg(err)}`);
  }

  try {
    // resolveSpacesIdentity already read the single matching identity row —
    // reuse its surfaceWorkspaceId directly instead of re-querying
    // UserSurfaceIdentity for the same row it just selected.
    const identity = await resolveSpacesIdentity(userId, requestedWorkspaceId);
    if (identity?.surfaceWorkspaceId) {
      return identity.surfaceWorkspaceId;
    }

    // Backward compatibility for legacy Claw users that predate
    // UserSurfaceIdentity. This is deliberately allowed only when the org has
    // exactly one Spaces workspace; choosing from two or more would attach a
    // request to the wrong membership.
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
    if (!user?.orgId) return null;
    const connected = await prisma.connectedSurface.findMany({
      where: { surfaceId: "spaces", orgId: user.orgId, surfaceTenantId: { not: "" } },
      select: { surfaceTenantId: true },
      take: 2,
    });
    if (connected.length === 1) {
      log.warn(
        `[spaces-db] workspace-lookup userId=${userId} caller=${caller} used legacy single-workspace connected-surface fallback`,
      );
      return connected[0]!.surfaceTenantId;
    }
    if (connected.length > 1) {
      log.warn(
        `[spaces-db] workspace-lookup userId=${userId} caller=${caller} result=ambiguous-connected-surfaces orgId=${user.orgId}`,
      );
      return null;
    }

    const links = await prisma.surfaceTenantLink.findMany({
      where: { surfaceType: "spaces", orgId: user.orgId },
      select: { surfaceTenantId: true },
      take: 2,
    });
    if (links.length === 1) {
      log.warn(
        `[spaces-db] workspace-lookup userId=${userId} caller=${caller} used deprecated single-workspace surface-tenant-link fallback`,
      );
      return links[0]!.surfaceTenantId;
    }
    if (links.length > 1) {
      log.warn(
        `[spaces-db] workspace-lookup userId=${userId} caller=${caller} result=ambiguous-legacy-surface-tenant-links orgId=${user.orgId}`,
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
 * The 1:1 DM channel between a user and a Claw agent's bot, opened (or reused)
 * through the agent's bot API as the agent itself. null when the agent isn't
 * added to the user's workspace or the call fails; callers fall back to
 * headless delivery.
 */
export async function getDmChannelForUserAndAgent(userId: string, clawAgentId: string): Promise<string | null> {
  const trimmedUserId = userId.trim();
  if (!trimmedUserId || !clawAgentId) return null;
  const workspaceId = await getWorkspaceIdForUser(trimmedUserId, "mcp-runner");
  if (!workspaceId) return null;
  const spacesUserId = (await resolveSpacesIdentity(trimmedUserId, workspaceId))?.surfaceUserId ?? trimmedUserId;
  try {
    const r = (await spacesAppFetch("/channel/openDm", { targetUserId: spacesUserId }, { clawAgentId, workspaceId })) as { channelId?: string };
    log.info(`[spaces-directory] dm-channel userId=${trimmedUserId} agent=${clawAgentId} workspaceId=${workspaceId} result=${r?.channelId ? "hit" : "miss"}`);
    return r?.channelId ?? null;
  } catch (err) {
    log.warn(`[spaces-directory] dm-channel userId=${trimmedUserId} agent=${clawAgentId} result=error err=${errMsg(err)}`);
    return null;
  }
}

/** Resolve a user-group mention alias (e.g. `data-intelligence`) → active groups (≤ 2), in the workspace when given. */
export async function getSpacesGroupByAlias(
  alias: string,
  workspaceId?: string,
): Promise<Array<{ id: string; name: string; alias: string | null }>> {
  const trimmed = alias.trim();
  if (!trimmed) return [];
  const r = await directoryGet<{ groups: Array<{ id: string; name: string; alias: string | null }> }>(
    `/api/claw-agents/service/groups?alias=${enc(trimmed)}${workspaceId ? `&workspaceId=${enc(workspaceId)}` : ""}`,
    "group-by-alias",
  );
  return r?.groups ?? [];
}

/** True when claw-auth can make Spaces directory calls (its service signing key is set). */
export function spacesDbAvailable(): boolean {
  return agentCallsConfigured();
}

type UserHit = { id: string; name: string };

async function userLookup(kind: "name" | "email" | "handle", value: string, workspaceId?: string): Promise<UserHit[]> {
  const v = value.trim();
  if (!v) return [];
  const ws = workspaceId && workspaceId.trim() ? `&workspaceId=${enc(workspaceId.trim())}` : "";
  const r = await directoryGet<{ users: UserHit[] }>(`/api/claw-agents/service/users?${kind}=${enc(v)}${ws}`, `users-by-${kind}`);
  return r?.users ?? [];
}

/** `@First Last` → active HUMAN users with that exact (case-insensitive) name or display name (≤ 2; ≥ 2 means ambiguous). */
export async function getSpacesUsersByName(name: string, workspaceId?: string): Promise<UserHit[]> {
  return userLookup("name", name, workspaceId);
}

/** The workspace a user belongs to. Used to scope name resolution to the agent's own workspace. */
export async function getSpacesUserWorkspaceId(userId: string): Promise<string | null> {
  return getWorkspaceIdForUser(userId, "unknown");
}

/** `@email@domain` → active users with that email, scoped to the workspace when known. */
export async function getSpacesUserByEmail(email: string, workspaceId?: string): Promise<UserHit[]> {
  return userLookup("email", email, workspaceId);
}

/** `@first.last` → active users whose email local part is the handle. */
export async function getSpacesUsersByHandle(handle: string, workspaceId?: string): Promise<UserHit[]> {
  return userLookup("handle", handle, workspaceId);
}
