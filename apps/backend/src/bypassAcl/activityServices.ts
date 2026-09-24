import type { Activity } from '@prisma/client';
import { db } from '@/database/client';
import { ActivityClassification, ActivityClassificationJobType, UserStatus } from '@xyne/shared';
import { asSystem, rawQuery } from './base';

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

/**
 * Relocated from activityClassificationWorkerService. Claims a whole special-mention audience
 * batch atomically with FOR UPDATE SKIP LOCKED; the worker sweeps every workspace, so there
 * is no single tenant to scope to. SQL unchanged.
 */
export async function claimSpecialMentionAudienceActivitiesQuery() {
  return rawQuery(
    ['Activity'],
    'activity classification worker: FOR UPDATE SKIP LOCKED claim so competing workers cannot double-process a batch',
    () => db.$queryRaw<Activity[]>`
      WITH batch AS (
        SELECT "actionSourceId", "channelId"
        FROM "activities"
        WHERE "classification" = ${ActivityClassification.PENDING}
          AND "classificationJobType" = ${ActivityClassificationJobType.SPECIAL_MENTION_AUDIENCE}
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      ),
      claimed AS (
        SELECT "id"
        FROM "activities" a
        JOIN batch b
          ON a."actionSourceId" = b."actionSourceId"
         AND a."channelId" = b."channelId"
        WHERE a."classification" = ${ActivityClassification.PENDING}
          AND a."classificationJobType" = ${ActivityClassificationJobType.SPECIAL_MENTION_AUDIENCE}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "activities" a
      SET "classification" = ${ActivityClassification.PROCESSING}
      FROM claimed
      WHERE a."id" = claimed."id"
      RETURNING a.*;
    `,
  );
}

/**
 * Relocated from activityClassificationWorkerService. Claims one batch of pending activities
 * atomically with FOR UPDATE SKIP LOCKED; the worker sweeps every workspace, so there is no
 * single tenant to scope to. SQL unchanged.
 */
export async function claimSingleActivitiesQuery(limit: number) {
  return rawQuery(
    ['Activity'],
    'activity classification worker: FOR UPDATE SKIP LOCKED claim so competing workers cannot double-process a row',
    () => db.$queryRaw<Activity[]>`
      WITH cte AS (
        SELECT "id"
        FROM "activities"
        WHERE "classification" = ${ActivityClassification.PENDING}
          AND ("classificationJobType" IS NULL OR "classificationJobType" = ${ActivityClassificationJobType.SINGLE})
        ORDER BY "createdAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "activities" a
      SET "classification" = ${ActivityClassification.PROCESSING}
      FROM cte
      WHERE a."id" = cte."id"
      RETURNING a.*;
    `,
  );
}
