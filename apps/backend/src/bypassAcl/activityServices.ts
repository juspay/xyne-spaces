import type { Activity } from '@prisma/client';
import { db } from '@/database/client';
import {
  ActivityClassification,
  ActivityClassificationJobType,
  ChannelScopeType,
  DESK_CHANNEL_TYPES,
  UserStatus,
  BELL_COUNT_RULES,
  BELL_EXCLUDED_ACTOR_ACTIONS,
  BELL_EXCLUDED_CLASSIFICATIONS,
  BELL_EXCLUDED_LEGACY_DIRECT_MESSAGE_ACTIONS,
  DM_SHELF_CHANNEL_SCOPES,
  DM_SHELF_MENTION_ACTOR_ACTIONS,
} from '@xyne/shared';
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
 *
 * `count` = dmCount + bellCount + callCount (the unread badge invariant — every event lands in
 * exactly one shelf; the dock renders the sum over all workspaces):
 * - dmCount   = Σ channel_user_status.unreadCount over the user's open DM/GROUP_DM channels,
 *               minus unread top-level mention activities in GROUP_DM channels (mention wins the
 *               bucket), floored at 0 per channel.
 * - bellCount = COUNT(unread activities) per the shared BELL_COUNT_RULES.
 * - callCount = COUNT(unread missed_call activities) — same semantics as the Calls rail's
 *               `userMissedCalls` Zero query.
 *
 * Rows are merged server-side per workspaceId, so a member holding two identities in one
 * workspace sums instead of racing last-write-wins on the client.
 */
export function getWorkspaceActivityCountsQuery(memberId: string): Promise<
  Array<{
    workspaceId: string;
    count: number;
  }>
> {
  return asSystem(
    ['User', 'ChannelUserStatus', 'Activity'],
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

      // dmCount: open DM/GROUP_DM channel_user_status.unreadCount per user.
      const dmStatuses = await db.channelUserStatus.findMany({
        where: {
          userId: { in: userIds },
          isClosed: false,
          isDeleted: false,
          channel: {
            scopeType: { in: [...DM_SHELF_CHANNEL_SCOPES] },
          },
        },
        select: {
          userId: true,
          unreadCount: true,
          channel: {
            select: {
              id: true,
              scopeType: true,
            },
          },
        },
      });

      // dm shelf subtraction: unread top-level mention activities in GROUP_DM
      // channels (mentioned_user / group_mention) are counted by the bell, so
      // they must not also inflate the dm shelf's unreadCount totals.
      // Activity has no Prisma relation to Channel (only Zero does), so scope
      // via channelId set derived from the open GROUP_DM statuses above —
      // dmCount only sums open channels, so the subtraction only matters there.
      const groupDmChannelIds = dmStatuses
        .filter(s => s.channel?.scopeType === ChannelScopeType.GROUP_DM)
        .map(s => s.channel.id);

      const groupDmMentionCounts =
        groupDmChannelIds.length > 0
          ? await db.activity.groupBy({
              by: ['userId', 'channelId'],
              where: {
                userId: { in: userIds },
                isRead: false,
                actorAction: { in: [...DM_SHELF_MENTION_ACTOR_ACTIONS] },
                actionSource: 'message',
                // { not: true } (IS DISTINCT FROM TRUE) matches false AND null
                // rows — parity with the client predicate's `!== true`, which
                // treats legacy null rows as top-level mentions.
                isThreadActivity: { not: true },
                channelId: { in: groupDmChannelIds },
              },
              _count: {
                id: true,
              },
            })
          : [];

      // channelId -> userId -> mention rows, for per-channel subtraction.
      const groupDmMentions = new Map<string, Map<string, number>>();
      for (const row of groupDmMentionCounts) {
        if (!row.channelId) continue;
        let byUser = groupDmMentions.get(row.channelId);
        if (!byUser) {
          byUser = new Map();
          groupDmMentions.set(row.channelId, byUser);
        }
        byUser.set(row.userId, row._count.id);
      }

      // bellCount per the shared rules (excludes added_v2/removed, missed_call,
      // SKIP, legacy direct_message). The dashboard bell only lists activities in the
      // user's *visible* channels (userVisibleChannelsV3): a status row that is not
      // closed/deleted, on a channel that is not a desk type (email, Slack, app, call,
      // social). The count must use the same rule or the switcher/dock show numbers the
      // bell can never clear. Activity has no Prisma relation to Channel, so group by
      // (userId, channelId) and post-filter against the visible pairs below.
      // channelId null (ticket activities) always counts.
      const bellChannelCounts = await db.activity.groupBy({
        by: ['userId', 'channelId'],
        where: {
          userId: { in: userIds },
          isRead: false,
          actorAction: {
            notIn: [
              ...BELL_EXCLUDED_ACTOR_ACTIONS,
              ...BELL_EXCLUDED_LEGACY_DIRECT_MESSAGE_ACTIONS,
            ],
          },
          NOT: {
            AND: [
              { actionSource: BELL_COUNT_RULES.excludedCalls.actionSource },
              { actorAction: BELL_COUNT_RULES.excludedCalls.actorAction },
            ],
          },
          classification: { notIn: [...BELL_EXCLUDED_CLASSIFICATIONS] },
        },
        _count: {
          id: true,
        },
      });

      // Visible (userId, channelId) pairs, limited to the channels that have unread
      // bell rows so this stays small however many channels the user has closed.
      const bellChannelIds = [
        ...new Set(
          bellChannelCounts
            .map(row => row.channelId)
            .filter((channelId): channelId is string => channelId !== null),
        ),
      ];
      const visibleStatuses =
        bellChannelIds.length > 0
          ? await db.channelUserStatus.findMany({
              where: {
                userId: { in: userIds },
                channelId: { in: bellChannelIds },
                isClosed: false,
                isDeleted: false,
                channel: { type: { notIn: [...DESK_CHANNEL_TYPES] } },
              },
              select: { userId: true, channelId: true },
            })
          : [];

      const visibleChannelsByUser = new Map<string, Set<string>>();
      for (const status of visibleStatuses) {
        let channels = visibleChannelsByUser.get(status.userId);
        if (!channels) {
          channels = new Set();
          visibleChannelsByUser.set(status.userId, channels);
        }
        channels.add(status.channelId);
      }

      const bellByUser = new Map<string, number>();
      for (const row of bellChannelCounts) {
        if (row.channelId && !visibleChannelsByUser.get(row.userId)?.has(row.channelId)) {
          continue;
        }
        bellByUser.set(row.userId, (bellByUser.get(row.userId) ?? 0) + row._count.id);
      }

      // callCount: unread missed_call activities, same semantics as the Calls
      // rail's userMissedCalls Zero query.
      const callCounts = await db.activity.groupBy({
        by: ['userId'],
        where: {
          userId: { in: userIds },
          isRead: false,
          actorAction: 'missed_call',
        },
        _count: {
          id: true,
        },
      });

      const callByUser = new Map<string, number>();
      for (const row of callCounts) {
        callByUser.set(row.userId, row._count.id);
      }

      // Merge identities per workspace (groupBy workspaceId, SUM).
      const countByWorkspace = new Map<string, number>();
      for (const u of users) {
        const dmCount = dmStatuses
          .filter(s => s.userId === u.id)
          .reduce((sum, status) => {
            const mentionRows =
              status.channel?.scopeType === ChannelScopeType.GROUP_DM
                ? (groupDmMentions.get(status.channel.id)?.get(u.id) ?? 0)
                : 0;
            return sum + Math.max(0, status.unreadCount - mentionRows);
          }, 0);
        const bellCount = bellByUser.get(u.id) ?? 0;
        const callCount = callByUser.get(u.id) ?? 0;
        countByWorkspace.set(
          u.workspaceId,
          (countByWorkspace.get(u.workspaceId) ?? 0) + dmCount + bellCount + callCount,
        );
      }

      return Array.from(countByWorkspace, ([workspaceId, count]) => ({
        workspaceId,
        count,
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
