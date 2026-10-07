import { DatabaseClient } from '@/database/client';
import { UserStatus, NotificationStatus } from '@xyne/shared';
import { asSystem } from './base';

const prisma = DatabaseClient.getInstance();

/**
 * Relocated from services/notificationService.ts's getWorkspaceNotificationCounts. Spans the
 * caller's own identities across workspaces.
 */
export function getWorkspaceNotificationCountsQuery(memberId: string): Promise<
  Array<{
    workspaceId: string;
    userId: string;
    count: number;
  }>
> {
  return asSystem(
    ['User', 'Notification'],
    'spans the caller\'s own identities across every workspace they belong to',
    async () => {
      // Step 1: Get all active users for this member across workspaces
      const users = await prisma.user.findMany({
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

      // Step 2: Count unread+delivered notifications per user
      const notificationCounts = await prisma.notification.groupBy({
        by: ['userId'],
        where: {
          userId: { in: userIds },
          status: { in: [NotificationStatus.UNREAD, NotificationStatus.DELIVERED] },
          readAt: null,
          dismissedAt: null,
        },
        _count: {
          id: true,
        },
      });

      // Build a map: userId -> count
      const countMap = new Map<string, number>();
      for (const nc of notificationCounts) {
        countMap.set(nc.userId, nc._count.id);
      }

      // Step 3: Merge users with their counts
      return users.map(u => ({
        workspaceId: u.workspaceId,
        userId: u.id,
        count: countMap.get(u.id) ?? 0,
      }));
    },
  );
}
