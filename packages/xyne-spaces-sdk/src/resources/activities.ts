/**
 * Activities Resource
 *
 * The authenticated user's activity feed and its read state. Every method here
 * acts on the caller's own feed; there is no user parameter.
 */

import { Resource } from './base.js';
import { activitiesOperations, type ActivityCursor } from '../registry/activities.js';
import type { Activity, Bookmark } from '../types/index.js';

export class ActivitiesResource extends Resource {
  /**
   * List the caller's full activity feed.
   *
   * @returns Every activity, read and unread.
   * @example
   * const activities = await sdk.activities.list();
   */
  list(): Promise<Activity[]> {
    return this.call(activitiesOperations.list, undefined);
  }

  /**
   * List the activity feed a page at a time.
   *
   * @param options - Paging window and type filter.
   * @param options.limit - Page size.
   * @param options.start - Cursor from the last item of the previous page.
   * @param options.types - Restrict to these activity types. Omit for all.
   * @returns One page of activities, newest first.
   * @example
   * const page = await sdk.activities.listPaginated({ limit: 20 });
   */
  listPaginated(options?: {
    limit?: number;
    start?: ActivityCursor;
    types?: string[];
  }): Promise<Activity[]> {
    return this.call(activitiesOperations.listPaginated, options ?? {});
  }

  /**
   * List the caller's unread activities.
   *
   * @returns Activities not yet marked read.
   * @example
   * const unread = await sdk.activities.listUnread();
   */
  listUnread(): Promise<Activity[]> {
    return this.call(activitiesOperations.listUnread, undefined);
  }

  /**
   * List unread activities from threads the caller is subscribed to.
   *
   * @returns Unread activities scoped to subscribed threads.
   * @example
   * const threads = await sdk.activities.listUnreadThreads();
   */
  listUnreadThreads(): Promise<Activity[]> {
    return this.call(activitiesOperations.listUnreadThreads, undefined);
  }

  /**
   * List the caller's missed calls.
   *
   * @returns Missed-call activities.
   * @example
   * const missed = await sdk.activities.listMissedCalls();
   */
  listMissedCalls(): Promise<Activity[]> {
    return this.call(activitiesOperations.listMissedCalls, undefined);
  }

  /**
   * List the caller's bookmarks.
   *
   * @returns Saved references to messages, threads, tickets and canvases.
   * @example
   * const bookmarks = await sdk.activities.listBookmarks();
   */
  listBookmarks(): Promise<Bookmark[]> {
    return this.call(activitiesOperations.listBookmarks, undefined);
  }

  /**
   * Mark a single activity read.
   *
   * @param activityId - Id of the activity.
   * @example
   * await sdk.activities.markAsRead('activity-1');
   */
  markAsRead(activityId: string): Promise<void> {
    return this.call(activitiesOperations.markAsRead, { activityId });
  }

  /**
   * Mark a single activity unread again.
   *
   * @param activityId - Id of the activity.
   * @example
   * await sdk.activities.markAsUnread('activity-1');
   */
  markAsUnread(activityId: string): Promise<void> {
    return this.call(activitiesOperations.markAsUnread, { activityId });
  }

  /**
   * Mark every activity in a thread read.
   *
   * @param conversationId - Thread whose activities to clear.
   * @param options.draftMessage - Unsent draft to preserve while marking read.
   * @example
   * await sdk.activities.markThreadAsRead('conv-1');
   */
  markThreadAsRead(
    conversationId: string,
    options?: { draftMessage?: string }
  ): Promise<void> {
    return this.call(activitiesOperations.markThreadAsRead, {
      conversationId,
      ...options,
    });
  }

  /**
   * Clear the caller's missed-call badge.
   *
   * @example
   * await sdk.activities.markMissedCallsAsRead();
   */
  markMissedCallsAsRead(): Promise<void> {
    return this.call(activitiesOperations.markMissedCallsAsRead, undefined);
  }

  /**
   * Mark activities seen up to and including a given message.
   *
   * @param messageId - The most recent message the caller has seen.
   * @example
   * await sdk.activities.markSeenByMessage('message-1');
   */
  markSeenByMessage(messageId: string): Promise<void> {
    return this.call(activitiesOperations.markSeenByMessage, { messageId });
  }

  /**
   * Dismiss a nudge without acting on it.
   *
   * @param nudgeId - Id of the nudge.
   * @example
   * await sdk.activities.dismissNudge('nudge-1');
   */
  dismissNudge(nudgeId: string): Promise<void> {
    return this.call(activitiesOperations.dismissNudge, { nudgeId });
  }

  /**
   * Record that a nudge was acted on.
   *
   * @param nudgeId - Id of the nudge.
   * @param actionResult - What the action produced, e.g. the id of a created ticket.
   * @example
   * await sdk.activities.actOnNudge('nudge-1', { ticketId: 'ticket-9' });
   */
  actOnNudge(nudgeId: string, actionResult?: unknown): Promise<void> {
    return this.call(activitiesOperations.actOnNudge, { nudgeId, actionResult });
  }

  /**
   * Mark every activity matching a filter as read.
   *
   * @param filter - Which activities to clear.
   * @param filter.actorAction - Restrict to one kind of action, e.g. `'REACTION'`.
   * @param filter.classification - Restrict to one classification.
   * @example
   * await sdk.activities.markAsReadByFilter({ actorAction: 'REACTION' });
   */
  markAsReadByFilter(filter: {
    actorAction?: string;
    classification?: string;
  }): Promise<void> {
    return this.call(activitiesOperations.markAsReadByFilter, filter);
  }
}
