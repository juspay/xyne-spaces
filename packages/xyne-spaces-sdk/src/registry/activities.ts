/**
 * Activities Operation Registry
 *
 * The current user's activity feed: mentions, thread replies, reactions, and
 * missed calls, plus the read-state operations that clear them.
 *
 * Every operation here is implicitly scoped to the authenticated user by the
 * underlying query — there is no user id parameter to pass, and none to spoof.
 */

import { op } from './types.js';
import type {
  Activity,
  Bookmark,
} from '../types/index.js';

/** Page cursor for the paginated activity feed. */
export interface ActivityCursor {
  id: string;
  updatedAt: number;
}

export const activitiesOperations = {
  // ----- Reads -----

  /**
   * The full activity feed.
   */
  list: op<void, Activity[]>('activities.list', 'query'),

  /**
   * The activity feed, paginated.
   */
  listPaginated: op<{ limit?: number; start?: ActivityCursor; types?: string[] }, Activity[]>('activities.listPaginated', 'query'),

  /**
   * Unread activities only.
   */
  listUnread: op<void, Activity[]>('activities.listUnread', 'query'),

  /**
   * Unread activities from subscribed threads.
   */
  listUnreadThreads: op<void, Activity[]>('activities.listUnreadThreads', 'query'),

  /**
   * Missed calls.
   */
  listMissedCalls: op<void, Activity[]>('activities.listMissedCalls', 'query'),

  /**
   * The current user's bookmarks.
   */
  listBookmarks: op<void, Bookmark[]>('activities.listBookmarks', 'query'),

  // ----- Writes -----

  /**
   * Mark one activity read.
   */
  markAsRead: op<{ activityId: string }, void>('activities.markAsRead', 'mutator'),

  /**
   * Mark one activity unread again.
   */
  markAsUnread: op<{ activityId: string }, void>('activities.markAsUnread', 'mutator'),

  /**
   * Mark every activity in a thread read, optionally preserving a draft.
   */
  markThreadAsRead: op<{ conversationId: string; draftMessage?: string }, void>('activities.markThreadAsRead', 'mutator'),

  /**
   * Clear the missed-call badge.
   */
  markMissedCallsAsRead: op<void, void>('activities.markMissedCallsAsRead', 'mutator'),

  /**
   * Mark activities seen up to a given message.
   */
  markSeenByMessage: op<{ messageId: string }, void>('activities.markSeenByMessage', 'mutator'),

  /**
   * Dismiss a nudge.
   */
  dismissNudge: op<{ nudgeId: string }, void>('activities.dismissNudge', 'mutator'),

  /**
   * Act on a nudge.
   */
  actOnNudge: op<{ nudgeId: string; actionResult?: unknown }, void>('activities.actOnNudge', 'mutator'),
  /**
   * Mark every activity matching a filter as read — for example all reactions,
   * or everything of one classification.
   */
  markAsReadByFilter: op<{ actorAction?: string; classification?: string }, void>('activities.markAsReadByFilter', 'mutator'),
} as const;
