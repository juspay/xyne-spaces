/**
 * Activities Operation Registry
 *
 * The current user's activity feed: mentions, thread replies, reactions, and
 * missed calls, plus the read-state operations that clear them.
 *
 * Every operation here is implicitly scoped to the authenticated user by the
 * underlying query — there is no user id parameter to pass, and none to spoof.
 */

import { query, mutator } from './types.js';
import { newId, now } from '../core/ids.js';
import type { Activity } from '../types/index.js';

/** Page cursor for the paginated activity feed. */
export interface ActivityCursor {
  id: string;
  updatedAt: number;
}

export const activitiesOperations = {
  // ----- Reads -----

  /**
   * The full activity feed.
   * Maps to: Zero query 'userActivitiesV2'
   */
  list: query<void, Activity[]>('userActivitiesV2'),

  /**
   * The activity feed, paginated.
   * Maps to: Zero query 'userActivitiesPaginatedV2'
   */
  listPaginated: query<
    { limit?: number; start?: ActivityCursor; types?: string[] },
    Activity[]
  >('userActivitiesPaginatedV2', {
    // `types` is required server-side and was never sent, so this paged read always
    // failed validation. Empty means "no type filter".
    mapArgs: (args) => ({
      limit: args.limit ?? 50,
      start: args.start ?? null,
      types: args.types ?? [],
    }),
  }),

  /**
   * Unread activities only.
   * Maps to: Zero query 'userUnreadActivities'
   */
  listUnread: query<void, Activity[]>('userUnreadActivities'),

  /**
   * Unread activities from subscribed threads.
   * Maps to: Zero query 'userUnreadThreadActivities'
   */
  listUnreadThreads: query<void, Activity[]>('userUnreadThreadActivities'),

  /**
   * Missed calls.
   * Maps to: Zero query 'userMissedCalls'
   */
  listMissedCalls: query<void, Activity[]>('userMissedCalls'),

  /**
   * The current user's bookmarks.
   * Maps to: Zero query 'userBookmarks'
   */
  listBookmarks: query<void, unknown[]>('userBookmarks'),

  // ----- Writes -----

  /**
   * Mark one activity read.
   * Maps to: Zero mutator 'activities.markAsRead'
   */
  markAsRead: mutator<{ activityId: string }, void>('activities.markAsRead'),

  /**
   * Mark one activity unread again.
   * Maps to: Zero mutator 'activities.markAsUnread'
   */
  markAsUnread: mutator<{ activityId: string }, void>('activities.markAsUnread', {
    mapArgs: (args) => ({ activityId: args.activityId, timestamp: now() }),
  }),

  /**
   * Mark every activity in a thread read, optionally preserving a draft.
   * Maps to: Zero mutator 'activities.markThreadActivitiesAsReadV2'
   */
  markThreadAsRead: mutator<{ conversationId: string; draftMessage?: string }, void>(
    'activities.markThreadActivitiesAsReadV2',
    {
      mapArgs: (args) => ({
        conversationId: args.conversationId,
        draftMessage: args.draftMessage ?? '',
        draftMessageId: newId(),
        timestamp: now(),
        participantId: newId(),
      }),
    }
  ),

  /**
   * Clear the missed-call badge.
   * Maps to: Zero mutator 'activities.markMissedCallsAsRead'
   */
  markMissedCallsAsRead: mutator<void, void>('activities.markMissedCallsAsRead', {
    mapArgs: () => ({}),
  }),

  /**
   * Mark activities seen up to a given message.
   * Maps to: Zero mutator 'activities.markActivitiesSeenByMessageId'
   */
  markSeenByMessage: mutator<{ messageId: string }, void>(
    'activities.markActivitiesSeenByMessageId'
  ),

  /**
   * Dismiss a nudge.
   * Maps to: Zero mutator 'nudges.dismiss'
   */
  dismissNudge: mutator<{ nudgeId: string }, void>('nudges.dismiss', {
    mapArgs: (args) => ({ nudgeId: args.nudgeId, timestamp: now() }),
  }),

  /**
   * Act on a nudge.
   * Maps to: Zero mutator 'nudges.act'
   */
  actOnNudge: mutator<{ nudgeId: string; actionResult?: unknown }, void>('nudges.act', {
    mapArgs: (args) => ({
      nudgeId: args.nudgeId,
      ...(args.actionResult !== undefined ? { actionResult: args.actionResult } : {}),
      timestamp: now(),
    }),
  }),
  /**
   * Mark every activity matching a filter as read — for example all reactions,
   * or everything of one classification.
   * Maps to: Zero mutator 'activities.markAsReadByFilter'
   */
  markAsReadByFilter: mutator<
    { actorAction?: string; classification?: string },
    void
  >('activities.markAsReadByFilter', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),
} as const;
