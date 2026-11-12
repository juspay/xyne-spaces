import { getWorkspaceIdForUser, type SpacesAuthCaller } from "../../lib/spaces-db.js";
import { getSpacesAuthForAgent, type SpacesAgentAuth } from "../../lib/spaces-agent-client.js";
import { spacesUserIdForClawUser } from "../../lib/users-jit.js";
import type { SpacesAuthContext } from "../../mcp/servers/xyne-spaces-client.js";
import { CONFIG } from "../../config.js";
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";

const log = createLogger("spaces-user-auth");

export interface UserSpacesAuth {
  /** The agent's on-behalf-of token (Bearer). */
  token: string;
  agentToken: string;
  workspaceId: string;
  principalId: string;
}

/**
 * Spaces auth for work done BY an agent run on behalf of a user: an
 * on-behalf-of agent token from Spaces (lib/spaces-agent-client.ts).
 *
 * `userId` may be the canonical Claw id or the raw workspace-scoped Spaces id;
 * the canonical id is mapped through claw-auth's own UserSurfaceIdentity rows.
 * The workspace is the one given, else the user's single workspace. Returns
 * null when there is no agent in scope, no workspace, or Spaces won't let the
 * agent act for the user — callers treat it as "no Spaces auth".
 */
export async function resolveAgentSpacesAuth(args: {
  clawAgentId: string | null | undefined;
  userId: string;
  workspaceId?: string | null | undefined;
  caller?: SpacesAuthCaller;
}): Promise<SpacesAgentAuth | null> {
  const caller = args.caller ?? "unknown";
  if (!args.clawAgentId || !args.userId) {
    log.info(`No agent in scope for Spaces auth user=${args.userId} (caller=${caller})`);
    return null;
  }
  try {
    const workspaceId = args.workspaceId?.trim()
      || (await getWorkspaceIdForUser(args.userId, caller).catch(() => null));
    if (!workspaceId) {
      log.info(`No workspace for Spaces agent auth user=${args.userId} agent=${args.clawAgentId} (caller=${caller})`);
      return null;
    }
    const spacesUserId = await spacesUserIdForClawUser(args.userId, workspaceId).catch(() => args.userId);
    const auth = await getSpacesAuthForAgent({ clawAgentId: args.clawAgentId, spacesUserId, workspaceId });
    if (!auth) log.info(`Agent ${args.clawAgentId} may not act in Spaces for user ${spacesUserId} (caller=${caller})`);
    return auth;
  } catch (err) {
    log.warn(`Spaces agent auth failed user=${args.userId} agent=${args.clawAgentId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** SpacesAuthContext for the in-process Spaces client from an agent token. */
export function agentSpacesAuthContext(a: SpacesAgentAuth): SpacesAuthContext {
  return { agentToken: a.agentToken, workspaceId: a.workspaceId, baseUrl: CONFIG.spacesInternalUrl };
}

/** How a lookup reaches Spaces for a user: the user's own forwarded browser
 *  cookie (a user-initiated request), or the run's agent acting for them. */
export interface SpacesAccess {
  cookie?: string | undefined;
  clawAgentId?: string | null | undefined;
}

/** SpacesAuthContext for `access`, or null (no cookie, no agent, or Spaces
 *  refuses the agent) — callers treat null as "no Spaces auth". */
export async function resolveSpacesAccess(
  userId: string,
  workspaceId: string | null | undefined,
  access: SpacesAccess,
  caller: SpacesAuthCaller = "unknown",
): Promise<SpacesAuthContext | null> {
  if (access.cookie) {
    return { cookie: access.cookie, ...(workspaceId ? { workspaceId } : {}), baseUrl: CONFIG.spacesInternalUrl };
  }
  const a = await resolveAgentSpacesAuth({ clawAgentId: access.clawAgentId, userId, workspaceId: workspaceId ?? null, caller });
  return a ? agentSpacesAuthContext(a) : null;
}

/** Claw agent id (prisma.agent.id) for an org-scoped slug, or null. */
export async function clawAgentIdForSlug(
  agentSlug: string | null | undefined,
  orgId: string | null | undefined,
): Promise<string | null> {
  if (!agentSlug || !orgId) return null;
  const row = await prisma.agent
    .findUnique({ where: { orgId_slug: { orgId, slug: agentSlug } }, select: { id: true } })
    .catch(() => null);
  return row?.id ?? null;
}

/**
 * The run's agent acting for `userId` in Spaces, shaped like the old
 * session-based result (token + workspaceId) for the attachment download path.
 */
export async function resolveUserSpacesAuth(
  userId: string,
  caller: SpacesAuthCaller = "unknown",
  opts: { clawAgentId?: string | null; workspaceId?: string | null } = {},
): Promise<UserSpacesAuth | null> {
  const a = await resolveAgentSpacesAuth({ clawAgentId: opts.clawAgentId, userId, workspaceId: opts.workspaceId, caller });
  if (!a) {
    log.info(`No Spaces agent auth for user ${userId} (caller=${caller})`);
    return null;
  }
  return { token: a.agentToken, agentToken: a.agentToken, workspaceId: a.workspaceId, principalId: a.principalId };
}
