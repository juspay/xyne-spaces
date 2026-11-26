import { Prisma } from '@prisma/client';
import {
  ChannelScopeType,
  ChannelVisibility,
  DashboardSharePrincipal,
  DashboardShareRole,
  WorkspaceRole,
} from '@xyne/shared';
import { transaction } from '../base';
import { db } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import {
  getAnalyticsDashboardRole,
  roleAtLeast,
  type AnalyticsDashboardRole,
} from '@/database/acl/tables/analytics-dashboard-access';

/*
 * Sharing for legacy analytics dashboards (the `dashboards` table). Writes run here rather than
 * through Zero so channel and workspace-share rules are checked on the server. The tx is not
 * ACL-wrapped; every function checks the caller's role first.
 */

type Ctx = { userId: string; workspaceId: string };
type Tx = Prisma.TransactionClient;

export type ShareInput = {
  principalType: DashboardSharePrincipal;
  principalId?: string;
  role: DashboardShareRole;
};

const TABLES = ['Dashboard', 'DashboardShare', 'ChannelParticipant', 'Channel', 'User'] as const;

const notFound = (message: string) => new AppError(message, 404);
const forbidden = (message: string) => new AppError(message, 403);
const badRequest = (message: string) => new AppError(message, 400);

/**
 * Someone the dashboard is not shared with gets 404, the same as for a dashboard that does not
 * exist, so a link reveals nothing. Someone who can see it but lacks the role gets 403.
 */
async function assertRole(tx: Tx, dashboardId: string, ctx: Ctx, min: AnalyticsDashboardRole, message: string) {
  const dashboard = await tx.dashboard.findUnique({ where: { id: dashboardId } });
  if (!dashboard || dashboard.workspaceId !== ctx.workspaceId) throw notFound('Dashboard not found');
  const role = await getAnalyticsDashboardRole(tx, dashboard, ctx.userId);
  if (!role) throw notFound('Dashboard not found');
  if (!roleAtLeast(role, min)) throw forbidden(message);
  return { dashboard, role };
}

/** Resolves and checks one share's audience; returns the principal id to store. */
async function resolvePrincipal(
  tx: Tx,
  ctx: Ctx,
  dashboard: { createdBy: string },
  share: ShareInput,
  mayShareWithWorkspace: boolean,
): Promise<string> {
  switch (share.principalType) {
    case DashboardSharePrincipal.USER: {
      const user = share.principalId
        ? await tx.user.findUnique({ where: { id: share.principalId }, select: { workspaceId: true, role: true } })
        : null;
      // Guests and community members cannot use dashboards; people elsewhere are not found.
      if (
        !user ||
        user.workspaceId !== ctx.workspaceId ||
        user.role === WorkspaceRole.GUEST ||
        user.role === WorkspaceRole.COMMUNITY_MEMBER
      ) {
        throw notFound('User not found');
      }
      if (share.principalId === dashboard.createdBy) throw badRequest('The owner already has this dashboard');
      return share.principalId!;
    }
    case DashboardSharePrincipal.CHANNEL: {
      if (share.role !== DashboardShareRole.VIEWER) throw badRequest('Channels can only be given view access');
      const channelId = share.principalId;
      const channel = channelId
        ? await tx.channel.findUnique({
            where: { id: channelId },
            select: { workspaceId: true, visibility: true, isArchived: true, scopeType: true },
          })
        : null;
      // Only channels the sharer can see themselves; anything else is "not found" so a private
      // channel's existence is not revealed.
      const canSee =
        channel !== null &&
        channel.workspaceId === ctx.workspaceId &&
        !channel.isArchived &&
        channel.scopeType !== ChannelScopeType.DM &&
        channel.scopeType !== ChannelScopeType.GROUP_DM &&
        (channel.visibility === ChannelVisibility.PUBLIC ||
          (await tx.channelParticipant.findFirst({
            where: { channelId: channelId!, userId: ctx.userId },
            select: { id: true },
          })) !== null);
      if (!canSee) throw notFound('Channel not found');
      return channelId!;
    }
    case DashboardSharePrincipal.WORKSPACE: {
      if (share.role !== DashboardShareRole.VIEWER) throw badRequest('The workspace can only be given view access');
      if (!mayShareWithWorkspace) {
        throw forbidden('Only analytics admins can share a dashboard with the whole workspace');
      }
      return ctx.workspaceId;
    }
  }
}

/** What changed for people shared with by name, so they can be notified. */
export type PersonShareChange =
  | { userId: string; role: DashboardShareRole; change: 'added' | 'roleChanged' }
  | { userId: string; change: 'revoked' };

/** Adds shares, or changes the role of an existing one. Owners and editors only. */
export function addDashboardSharesTx(dashboardId: string, ctx: Ctx, shares: ShareInput[], mayShareWithWorkspace: boolean) {
  return transaction([...TABLES], 'addDashboardShares: role check, audience checks and share upserts must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const { dashboard } = await assertRole(tx, dashboardId, ctx, 'EDITOR', 'Only the owner or editors can share this dashboard');
    const personChanges: PersonShareChange[] = [];
    for (const share of shares) {
      const principalId = await resolvePrincipal(tx, ctx, dashboard, share, mayShareWithWorkspace);
      if (share.principalType === DashboardSharePrincipal.USER) {
        const before = await tx.dashboardShare.findUnique({
          where: {
            dashboardId_principalType_principalId: { dashboardId, principalType: share.principalType, principalId },
          },
          select: { role: true },
        });
        if (!before) personChanges.push({ userId: principalId, role: share.role, change: 'added' });
        else if (before.role !== share.role) personChanges.push({ userId: principalId, role: share.role, change: 'roleChanged' });
      }
      await tx.dashboardShare.upsert({
        where: {
          dashboardId_principalType_principalId: { dashboardId, principalType: share.principalType, principalId },
        },
        update: { role: share.role },
        create: {
          workspaceId: ctx.workspaceId,
          dashboardId,
          principalType: share.principalType,
          principalId,
          role: share.role,
          createdBy: ctx.userId,
        },
      });
    }
    const all = await tx.dashboardShare.findMany({ where: { dashboardId }, orderBy: { createdAt: 'asc' } });
    return { shares: all, personChanges, dashboardName: dashboard.name };
  });
}

/** Changes a person's role. Owners and editors only. */
export function updateDashboardShareRoleTx(dashboardId: string, shareId: string, ctx: Ctx, role: DashboardShareRole) {
  return transaction([...TABLES], 'updateDashboardShareRole: role check plus share update must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    await assertRole(tx, dashboardId, ctx, 'EDITOR', 'Only the owner or editors can change access');
    const share = await tx.dashboardShare.findUnique({ where: { id: shareId } });
    if (!share || share.dashboardId !== dashboardId) throw notFound('Share not found');
    if (share.principalType !== DashboardSharePrincipal.USER && role !== DashboardShareRole.VIEWER) {
      throw badRequest('Channels and the workspace can only be given view access');
    }
    const updated = await tx.dashboardShare.update({ where: { id: shareId }, data: { role } });
    const dashboard = await tx.dashboard.findUniqueOrThrow({ where: { id: dashboardId }, select: { name: true } });
    return { share: updated, roleChanged: share.role !== role, dashboardName: dashboard.name };
  });
}

/** Removes a share. Owners and editors may remove any; anyone may remove their own (leave). */
export function removeDashboardShareTx(dashboardId: string, shareId: string, ctx: Ctx) {
  return transaction([...TABLES], 'removeDashboardShare: role check plus share delete must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const { role } = await assertRole(tx, dashboardId, ctx, 'VIEWER', 'Not allowed');
    const share = await tx.dashboardShare.findUnique({ where: { id: shareId } });
    if (!share || share.dashboardId !== dashboardId) throw notFound('Share not found');
    const ownRow = share.principalType === DashboardSharePrincipal.USER && share.principalId === ctx.userId;
    if (!ownRow && !roleAtLeast(role, 'EDITOR')) {
      throw forbidden('Only the owner or editors can change who this dashboard is shared with');
    }
    await tx.dashboardShare.delete({ where: { id: shareId } });
    const dashboard = await tx.dashboard.findUniqueOrThrow({ where: { id: dashboardId }, select: { name: true } });
    // Someone else removed a person: they're told. Leaving yourself, or removing a channel or the
    // workspace, tells no one.
    const revokedUserId = share.principalType === DashboardSharePrincipal.USER && !ownRow ? share.principalId : null;
    return { revokedUserId, dashboardName: dashboard.name };
  });
}
