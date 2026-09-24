import { db } from '@/database/client';
import { UserStatus } from '@xyne/shared';
import { asSystem } from './base';

/**
 * Relocated from services/activity/activityService.ts's fillSdlcOwner. Stamps a conversation's
 * activity rows written before it had an owner.
 */
export function fillSdlcOwnerActivities(
  conversationId: string,
  canvasId: string | undefined,
  trackId: string | undefined,
  ticketId: string | undefined,
): Promise<{ count: number }> {
  return asSystem(
    ['Activity'],
    'stamps activity rows written before their conversation had an owner',
    () =>
      db.activity.updateMany({
        where: { conversationId, canvasId: null, trackId: null, ticketId: null },
        data: { canvasId, trackId, ticketId },
      }),
  );
}

/**
 * Relocated from services/activity/activityService.ts's getWorkspaceActivityCounts. Spans the
 * caller's own identities across workspaces.
 */
export function getWorkspaceActivityCountsQuery(memberId: string): Promise<
  Array<{
    workspaceId: string;
    userId: string;
    count: number;
  }>
> {
  return asSystem(
    ['User', 'Activity'],
    'spans the caller\'s own identities across every workspace they belong to',
    async () => {
      const users = await db.user.findMany({
        where: {
          orgMemberId: memberId,
          leftAt: null,
          status: UserStatus.ACTIVE,
        },
        select: {
          id: true,
          workspaceId: true,
        },
      });

      if (users.length === 0) {
        return [];
      }

      const userIds = users.map(u => u.id);

      const activityCounts = await db.activity.groupBy({
        by: ['userId'],
        where: {
          userId: { in: userIds },
          isRead: false,
        },
        _count: {
          id: true,
        },
      });

      const countMap = new Map<string, number>();
      for (const ac of activityCounts) {
        countMap.set(ac.userId, ac._count.id);
      }

      return users.map(u => ({
        workspaceId: u.workspaceId,
        userId: u.id,
        count: countMap.get(u.id) ?? 0,
      }));
    },
  );
}
