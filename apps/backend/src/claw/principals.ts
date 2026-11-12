/**
 * Claw agents as first-party principals: who an agent is in a workspace and
 * what it may do there.
 *
 * - A principal is one Claw agent in one workspace. It acts through its own bot
 *   user (userType AGENT) and holds no secret.
 * - Agent grants (onBehalfOfUserId null) are what the agent may do as itself,
 *   approved by a workspace admin.
 * - Delegations (onBehalfOfUserId set) are what a user lets the agent do for
 *   them while they are not present. A delegation is capped by the agent
 *   grants: an agent can never act for a user beyond what the workspace allows
 *   it, nor beyond what that user can do.
 *
 * Scopes use the app-permission vocabulary (AvailableAppPermission, "name:type",
 * e.g. "chat:write"), so requirePermission works unchanged for agents.
 */

import { AuthProvider, OrgRole, UserType } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { runAsServiceActor, runAsSystem } from '@/database/tenant/context';
import { AppPermissionType } from '@xyne/shared';
import { toScope } from '@/database/repositories/appPermissionRepository';
import { logger } from '@/utils/logger';

export const PRINCIPAL_ACTIVE = 'ACTIVE';
export const PRINCIPAL_DISABLED = 'DISABLED';
export const GRANT_APPROVED = 'APPROVED';
export const GRANT_REVOKED = 'REVOKED';

export interface PrincipalView {
  id: string;
  workspaceId: string;
  orgId: string;
  clawAgentId: string;
  name: string;
  botUserId: string;
  status: string;
}

export class ClawAgentError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function toView(p: {
  id: string;
  workspaceId: string;
  orgId: string;
  clawAgentId: string;
  name: string;
  botUserId: string;
  status: string;
}): PrincipalView {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    orgId: p.orgId,
    clawAgentId: p.clawAgentId,
    name: p.name,
    botUserId: p.botUserId,
    status: p.status,
  };
}

/** Every scope Spaces knows, as "name:type". */
export async function knownScopes(): Promise<Set<string>> {
  const rows = await runAsSystem(() =>
    db.availableAppPermission.findMany({ select: { name: true, type: true } })
  );
  return new Set(rows.map((r) => toScope(r.name, r.type as AppPermissionType)));
}

/** Normalise and validate requested scopes; throws 400 on any unknown scope. */
export async function validateScopes(scopes: unknown): Promise<string[]> {
  if (!Array.isArray(scopes) || scopes.length === 0) throw new ClawAgentError('scopes must be a non-empty array', 400);
  const known = await knownScopes();
  const wanted = [...new Set(scopes.map((s) => String(s).trim().toLowerCase()))];
  const unknown = wanted.filter((s) => !known.has(s));
  if (unknown.length) throw new ClawAgentError(`unknown scopes: ${unknown.join(', ')}`, 400);
  return wanted;
}

function botEmail(clawAgentId: string, workspaceId: string): string {
  // OrgMember.email is globally unique, so the workspace is part of it (as for app bots).
  const safe = clawAgentId.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 40);
  return `claw-${safe}-${workspaceId}@agent.xyne.ai`;
}

/**
 * Add a Claw agent to a workspace, or return it if already there. Creates the
 * agent's bot user (userType AGENT) and org membership. Idempotent per
 * (clawAgentId, workspaceId). Re-enables a disabled principal.
 */
export async function ensurePrincipal(args: {
  clawAgentId: string;
  name: string;
  workspaceId: string;
  createdBy: string;
}): Promise<PrincipalView> {
  const clawAgentId = args.clawAgentId.trim();
  const name = args.name.trim().slice(0, 120);
  if (!clawAgentId || !name) throw new ClawAgentError('clawAgentId and name are required', 400);

  return runAsServiceActor(args.createdBy, args.workspaceId, async () => {
    const existing = await db.clawAgentPrincipal.findUnique({
      where: { clawAgentId_workspaceId: { clawAgentId, workspaceId: args.workspaceId } },
    });
    if (existing) {
      if (existing.status !== PRINCIPAL_ACTIVE || existing.revokedAt) {
        const revived = await db.clawAgentPrincipal.update({
          where: { id: existing.id },
          data: { status: PRINCIPAL_ACTIVE, revokedAt: null, name },
        });
        logger.info('[ClawAgents] principal re-enabled', { principalId: revived.id, by: args.createdBy });
        return toView(revived);
      }
      return toView(existing);
    }

    const workspace = await db.workspace.findUnique({ where: { id: args.workspaceId }, select: { orgId: true } });
    if (!workspace) throw new ClawAgentError('workspace not found', 404);

    const email = botEmail(clawAgentId, args.workspaceId);
    const orgMember =
      (await db.orgMember.findUnique({ where: { email }, select: { memberId: true } })) ??
      (await db.orgMember.create({ data: { email, orgId: workspace.orgId, role: OrgRole.MEMBER }, select: { memberId: true } }));

    let bot = await repositories.users.findByEmail(email, args.workspaceId);
    if (!bot) {
      bot = await repositories.users.create({
        name,
        email,
        providerUserId: `xyne-claw-agent-${clawAgentId}`,
        authProvider: AuthProvider.API_KEY,
        userType: UserType.AGENT,
        status: 'ACTIVE',
        workspace: { connect: { id: args.workspaceId } },
        orgMember: { connect: { memberId: orgMember.memberId } },
      });
    }

    const created = await db.clawAgentPrincipal.create({
      data: {
        workspaceId: args.workspaceId,
        orgId: workspace.orgId,
        clawAgentId,
        name,
        botUserId: bot.id,
        createdBy: args.createdBy,
      },
    });
    logger.info('[ClawAgents] principal created', {
      principalId: created.id,
      clawAgentId,
      workspaceId: args.workspaceId,
      by: args.createdBy,
    });
    return toView(created);
  });
}

export async function listPrincipals(workspaceId: string, actorUserId: string): Promise<PrincipalView[]> {
  return runAsServiceActor(actorUserId, workspaceId, async () => {
    const rows = await db.clawAgentPrincipal.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
    return rows.map(toView);
  });
}

/** Look up a principal across workspaces (service paths: token issuance, event routing). */
export async function findPrincipal(id: string): Promise<PrincipalView | null> {
  const row = await runAsSystem(() => db.clawAgentPrincipal.findUnique({ where: { id } }));
  return row ? toView(row) : null;
}

export async function findPrincipalByAgent(clawAgentId: string, workspaceId: string): Promise<PrincipalView | null> {
  const row = await runAsSystem(() =>
    db.clawAgentPrincipal.findUnique({ where: { clawAgentId_workspaceId: { clawAgentId, workspaceId } } })
  );
  return row ? toView(row) : null;
}

/** Active principals for one Claw agent, across workspaces. */
export async function findActivePrincipalsForAgent(clawAgentId: string): Promise<PrincipalView[]> {
  const rows = await runAsSystem(() =>
    db.clawAgentPrincipal.findMany({ where: { clawAgentId, status: PRINCIPAL_ACTIVE, revokedAt: null }, take: 50 })
  );
  return rows.map(toView);
}

export async function findPrincipalByBotUser(botUserId: string): Promise<PrincipalView | null> {
  const row = await runAsSystem(() => db.clawAgentPrincipal.findUnique({ where: { botUserId } }));
  return row ? toView(row) : null;
}

export function isActive(p: PrincipalView | null): p is PrincipalView {
  return !!p && p.status === PRINCIPAL_ACTIVE;
}

/** Disable a principal: no new tokens are issued and existing ones stop working (checked per request). */
export async function disablePrincipal(principal: PrincipalView, actorUserId: string): Promise<void> {
  await runAsServiceActor(actorUserId, principal.workspaceId, () =>
    db.clawAgentPrincipal.update({
      where: { id: principal.id },
      data: { status: PRINCIPAL_DISABLED, revokedAt: new Date() },
    })
  );
  logger.info('[ClawAgents] principal disabled', { principalId: principal.id, by: actorUserId });
}

/**
 * Add grants. `onBehalfOfUserId` null = agent grant (admin approves);
 * set = delegation from that user. Existing identical active grants are kept, not duplicated.
 */
export async function addGrants(args: {
  principal: PrincipalView;
  scopes: string[];
  grantedBy: string;
  onBehalfOfUserId: string | null;
  expiresAt?: Date | null;
}): Promise<string[]> {
  const { principal } = args;
  return runAsServiceActor(args.grantedBy, principal.workspaceId, async () => {
    const existing = await db.clawAgentGrant.findMany({
      where: {
        principalId: principal.id,
        onBehalfOfUserId: args.onBehalfOfUserId,
        status: GRANT_APPROVED,
        revokedAt: null,
      },
      select: { scope: true },
    });
    const have = new Set(existing.map((g) => g.scope));
    const add = args.scopes.filter((s) => !have.has(s));
    if (add.length) {
      await db.clawAgentGrant.createMany({
        data: add.map((scope) => ({
          workspaceId: principal.workspaceId,
          principalId: principal.id,
          scope,
          onBehalfOfUserId: args.onBehalfOfUserId,
          grantedBy: args.grantedBy,
          expiresAt: args.expiresAt ?? null,
        })),
      });
    }
    logger.info('[ClawAgents] grants added', {
      principalId: principal.id,
      onBehalfOf: args.onBehalfOfUserId ?? 'agent',
      added: add,
      by: args.grantedBy,
    });
    return add;
  });
}

export interface GrantView {
  id: string;
  scope: string;
  onBehalfOfUserId: string | null;
  grantedBy: string;
  expiresAt: Date | null;
  createdAt: Date;
}

/** Active grants of a principal. `onBehalfOfUserId` undefined = all; null = agent grants only. */
export async function listGrants(principal: PrincipalView, onBehalfOfUserId?: string | null): Promise<GrantView[]> {
  const now = new Date();
  const rows = await runAsSystem(() =>
    db.clawAgentGrant.findMany({
      where: {
        principalId: principal.id,
        status: GRANT_APPROVED,
        revokedAt: null,
        ...(onBehalfOfUserId !== undefined ? { onBehalfOfUserId } : {}),
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'asc' },
    })
  );
  return rows.map((g) => ({
    id: g.id,
    scope: g.scope,
    onBehalfOfUserId: g.onBehalfOfUserId,
    grantedBy: g.grantedBy,
    expiresAt: g.expiresAt,
    createdAt: g.createdAt,
  }));
}

/**
 * Revoke one grant. Agent grants: workspace admins. Delegations: the user who
 * gave them, or a workspace admin. Takes effect on the next token request.
 */
export async function revokeGrant(args: {
  principal: PrincipalView;
  grantId: string;
  actorUserId: string;
  actorIsAdmin: boolean;
}): Promise<void> {
  await runAsServiceActor(args.actorUserId, args.principal.workspaceId, async () => {
    const grant = await db.clawAgentGrant.findFirst({ where: { id: args.grantId, principalId: args.principal.id } });
    if (!grant) throw new ClawAgentError('grant not found', 404);
    const ownDelegation = grant.onBehalfOfUserId !== null && grant.onBehalfOfUserId === args.actorUserId;
    if (!args.actorIsAdmin && !ownDelegation) throw new ClawAgentError('not allowed to revoke this grant', 403);
    await db.clawAgentGrant.update({
      where: { id: grant.id },
      data: { status: GRANT_REVOKED, revokedAt: new Date() },
    });
  });
  logger.info('[ClawAgents] grant revoked', { principalId: args.principal.id, grantId: args.grantId, by: args.actorUserId });
}

/** Scopes the agent holds as itself. */
export async function agentScopes(principal: PrincipalView): Promise<string[]> {
  return [...new Set((await listGrants(principal, null)).map((g) => g.scope))].sort();
}

/**
 * Scopes the agent may use for `userId`: that user's delegation ∩ the agent's
 * own grants. `requireDelegation` false (a live, Spaces-vouched interaction with
 * the user) skips the stored-delegation requirement and uses the agent grants alone.
 */
export async function onBehalfOfScopes(
  principal: PrincipalView,
  userId: string,
  requireDelegation: boolean
): Promise<string[]> {
  const agent = new Set(await agentScopes(principal));
  if (!requireDelegation) return [...agent].sort();
  const delegated = (await listGrants(principal, userId)).map((g) => g.scope);
  return [...new Set(delegated.filter((s) => agent.has(s)))].sort();
}
