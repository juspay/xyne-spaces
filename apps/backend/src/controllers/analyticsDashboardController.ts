import type { Request, Response } from 'express';
import { z } from 'zod';
import { ActivityClassification, DashboardSharePrincipal, DashboardShareRole } from '@xyne/shared';
import { activityService } from '@/services/activity/activityService';
import { db } from '@/database/client';
import { hasResourceAdminAccess } from '@/database/acl/admin-access';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import { notificationService } from '@/services/notificationService';
import {
  addDashboardSharesTx,
  removeDashboardShareTx,
  updateDashboardShareRoleTx,
  type PersonShareChange,
} from '@/bypassAcl/transactions/analyticsDashboardShares';

/*
 * Sharing endpoints for legacy analytics dashboards (the `dashboards` table). Reading the share
 * list happens through Zero (dashboard_shares), limited to owners and editors by its read ACL.
 */

const addSharesBody = z.object({
  shares: z
    .array(
      z.object({
        principalType: z.nativeEnum(DashboardSharePrincipal),
        principalId: z.string().min(1).max(128).optional(),
        role: z.nativeEnum(DashboardShareRole),
      }),
    )
    .min(1)
    .max(50),
});

const updateRoleBody = z.object({ role: z.nativeEnum(DashboardShareRole) });

const ms = (d: Date) => d.getTime();

type ShareRow = Awaited<ReturnType<typeof addDashboardSharesTx>>['shares'][number];
const toShare = (s: ShareRow) => ({
  id: s.id,
  dashboardId: s.dashboardId,
  principalType: s.principalType,
  principalId: s.principalId,
  role: s.role,
  createdBy: s.createdBy,
  createdAt: ms(s.createdAt),
  updatedAt: ms(s.updatedAt),
});

function requireAuth(req: Request, res: Response): { userId: string; workspaceId: string } | null {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!userId || !workspaceId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return { userId, workspaceId };
}

function respondWithError(res: Response, e: unknown, tag: string): void {
  if (e instanceof AppError) {
    res.status(e.statusCode).json({ error: e.statusCode === 404 ? 'NotFound' : 'Error', message: e.message });
    return;
  }
  logger.error(`[AnalyticsDashboardShares] ${tag} failed:`, e);
  res.status(500).json({ error: 'InternalServerError', message: 'Request failed' });
}

const ACTOR_ACTION = {
  added: 'dashboard_shared',
  roleChanged: 'dashboard_access_changed',
  revoked: 'dashboard_access_revoked',
} as const;

/**
 * Tells people shared with by name what changed, after the change has committed: a notification
 * plus an activity in their feed (as canvas sharing does). Best effort: a failure here is logged
 * and never fails the share.
 */
async function notifyPeople(
  ctx: { userId: string; workspaceId: string },
  dashboardId: string,
  dashboardName: string,
  changes: PersonShareChange[],
): Promise<void> {
  const recipients = changes.filter(c => c.userId !== ctx.userId);
  if (recipients.length === 0) return;
  try {
    const actor = await db.user.findUnique({
      where: { id: ctx.userId },
      select: { name: true, displayName: true },
    });
    const actorName = actor?.displayName || actor?.name || 'Someone';

    // One notification call per (action, access) pair, since the text differs.
    const groups = new Map<string, { change: PersonShareChange['change']; access: 'view' | 'edit'; userIds: string[] }>();
    for (const c of recipients) {
      const access = c.change !== 'revoked' && c.role === DashboardShareRole.EDITOR ? 'edit' : 'view';
      const key = `${c.change}:${access}`;
      const group = groups.get(key) ?? { change: c.change, access, userIds: [] };
      group.userIds.push(c.userId);
      groups.set(key, group);
    }
    await Promise.all(
      [...groups.values()].map(g =>
        notificationService.createDashboardSharedNotifications(
          g.userIds,
          dashboardId,
          dashboardName,
          ctx.userId,
          actorName,
          ACTOR_ACTION[g.change],
          g.access,
          ctx.workspaceId,
        ),
      ),
    );

    await activityService.createActivities(
      recipients.map(c => ({
        userId: c.userId,
        workspaceId: ctx.workspaceId,
        actorAction: ACTOR_ACTION[c.change],
        actionSource: 'dashboard_shares',
        actionSourceId: dashboardId,
        dashboardId,
        actorId: ctx.userId,
        classification: ActivityClassification.ACTIONABLE,
      })),
    );
  } catch (e) {
    logger.error('[AnalyticsDashboardShares] notifying people failed:', e);
  }
}

export const AnalyticsDashboardController = {
  // POST /api/analytics-dashboards/:id/shares
  addShares: async (req: Request, res: Response): Promise<void> => {
    const ctx = requireAuth(req, res);
    if (!ctx) return;
    const parsed = addSharesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'BadRequest', message: parsed.error.issues.map(i => i.message).join(', ') });
      return;
    }
    try {
      const wantsWorkspace = parsed.data.shares.some(s => s.principalType === DashboardSharePrincipal.WORKSPACE);
      // Sharing with the whole workspace needs ANALYTICS admin.
      const mayShareWithWorkspace = wantsWorkspace ? await hasResourceAdminAccess(db, ctx.userId, 'ANALYTICS') : false;
      const dashboardId = req.params.id!;
      const result = await addDashboardSharesTx(dashboardId, ctx, parsed.data.shares, mayShareWithWorkspace);
      res.json({ shares: result.shares.map(toShare) });
      void notifyPeople(ctx, dashboardId, result.dashboardName, result.personChanges);
    } catch (e) {
      respondWithError(res, e, 'addShares');
    }
  },

  // PATCH /api/analytics-dashboards/:id/shares/:shareId
  updateShareRole: async (req: Request, res: Response): Promise<void> => {
    const ctx = requireAuth(req, res);
    if (!ctx) return;
    const parsed = updateRoleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'BadRequest', message: 'role must be EDITOR or VIEWER' });
      return;
    }
    try {
      const dashboardId = req.params.id!;
      const result = await updateDashboardShareRoleTx(dashboardId, req.params.shareId!, ctx, parsed.data.role);
      res.json({ share: toShare(result.share) });
      if (result.roleChanged && result.share.principalType === DashboardSharePrincipal.USER) {
        void notifyPeople(ctx, dashboardId, result.dashboardName, [
          { userId: result.share.principalId, role: parsed.data.role, change: 'roleChanged' },
        ]);
      }
    } catch (e) {
      respondWithError(res, e, 'updateShareRole');
    }
  },

  // DELETE /api/analytics-dashboards/:id/shares/:shareId
  removeShare: async (req: Request, res: Response): Promise<void> => {
    const ctx = requireAuth(req, res);
    if (!ctx) return;
    try {
      const dashboardId = req.params.id!;
      const result = await removeDashboardShareTx(dashboardId, req.params.shareId!, ctx);
      res.json({ success: true });
      if (result.revokedUserId) {
        void notifyPeople(ctx, dashboardId, result.dashboardName, [
          { userId: result.revokedUserId, change: 'revoked' },
        ]);
      }
    } catch (e) {
      respondWithError(res, e, 'removeShare');
    }
  },
};
