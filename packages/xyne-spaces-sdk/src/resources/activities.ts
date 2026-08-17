/**
 * Activities Resource
 *
 * The authenticated user's activity feed and its read state. Every method here
 * acts on the caller's own feed; there is no user parameter.
 */

import { Resource } from './base.js';
import { activitiesOperations, type ActivityCursor } from '../registry/activities.js';
import type { Activity } from '../types/index.js';

export class ActivitiesResource extends Resource {
  /**
   * List the full activity feed.
   *
   * @example
   * const activities = await sdk.activities.list();
   */
  list(): Promise<Activity[]> {
    return this.call(activitiesOperations.list, undefined);
  }

  /**
   * List the activity feed a page at a time.
   *
   * @param options.start - Cursor from the last item of the previous page
   */
  listPaginated(options?: {
    limit?: number;
    start?: ActivityCursor;
    types?: string[];
  }): Promise<Activity[]> {
    return this.call(activitiesOperations.listPaginated, options ?? {});
  }

  /** List unread activities. */
  listUnread(): Promise<Activity[]> {
    return this.call(activitiesOperations.listUnread, undefined);
  }

  /** List unread activities from threads you are subscribed to. */
  listUnreadThreads(): Promise<Activity[]> {
    return this.call(activitiesOperations.listUnreadThreads, undefined);
  }

  /** List missed calls. */
  listMissedCalls(): Promise<Activity[]> {
    return this.call(activitiesOperations.listMissedCalls, undefined);
  }

  /** List the current user's bookmarks. */
  listBookmarks(): Promise<unknown[]> {
    return this.call(activitiesOperations.listBookmarks, undefined);
  }

  /** Mark a single activity read. */
  markAsRead(activityId: string): Promise<void> {
    return this.call(activitiesOperations.markAsRead, { activityId });
  }

  /** Mark a single activity unread again. */
  markAsUnread(activityId: string): Promise<void> {
    return this.call(activitiesOperations.markAsUnread, { activityId });
  }

  /**
   * Mark every activity in a thread read.
   *
   * @param options.draftMessage - Preserve an unsent draft while marking read
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

  /** Clear the missed-call badge. */
  markMissedCallsAsRead(): Promise<void> {
    return this.call(activitiesOperations.markMissedCallsAsRead, undefined);
  }

  /** Mark activities seen up to a given message. */
  markSeenByMessage(messageId: string): Promise<void> {
    return this.call(activitiesOperations.markSeenByMessage, { messageId });
  }

  /** Dismiss a nudge without acting on it. */
  dismissNudge(nudgeId: string): Promise<void> {
    return this.call(activitiesOperations.dismissNudge, { nudgeId });
  }

  /** Act on a nudge. */
  actOnNudge(nudgeId: string, actionResult?: unknown): Promise<void> {
    return this.call(activitiesOperations.actOnNudge, { nudgeId, actionResult });
  }

  /**
   * Mark every activity matching a filter as read.
   *
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
