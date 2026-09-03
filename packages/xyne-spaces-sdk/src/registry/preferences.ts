/**
 * Preferences Operation Registry
 *
 * The current user's own settings: notification behaviour, profile card,
 * presence, bookmarks, and saved filter views.
 *
 * Everything here is scoped to the caller. The `id` several mutators take is the
 * preference row's own id, not a user id — it is generated on first write and
 * reused after, so the resource methods accept it optionally.
 */

import { op } from './types.js';
import type { UserProfile } from '../types/index.js';

export const preferencesOperations = {
  // ----- Reads -----

  /**
   * The current user's preference row.
   */
  get: op<void, unknown>('preferences.get', 'query'),

  /**
   * The current user's bookmarks.
   */
  listBookmarks: op<void, unknown[]>('preferences.listBookmarks', 'query'),

  /**
   * Saved filter views a user created.
   *
   * Takes an explicit `userId` — despite the old `void` signature suggesting it was
   * caller-scoped, the query has no `ctx` fallback, so it required an argument the
   * SDK never sent. Pass `me.id` from `sdk.users.me()` for your own views.
   */
  listSavedViews: op<{ userId: string }, unknown[]>('preferences.listSavedViews', 'query'),

  // ----- Notification settings -----

  /**
   * Set global notification levels.
   */
  setNotificationSettings: op<{
      id: string;
      globalDesktopNotificationLevel?: string;
      globalMobileNotificationLevel?: string;
      threadReplyNotificationsEnabled?: boolean;
      channelWideMentionsEnabled?: boolean;
    }, void>('preferences.setNotificationSettings', 'mutator'),

  /**
   * Set the words that trigger a notification when mentioned.
   */
  setNotificationKeywords: op<{ id: string; keywords: string[] }, void>('preferences.setNotificationKeywords', 'mutator'),

  /**
   * Override notification behaviour for one channel.
   */
  setChannelNotifications: op<{
      channelId: string;
      desktopNotificationLevel?: string | null;
      mobileNotificationLevel?: string | null;
      threadReplyNotificationsEnabled?: boolean | null;
      channelWideMentionsEnabled?: boolean | null;
    }, void>('preferences.setChannelNotifications', 'mutator'),

  // ----- Interface preferences -----

  /**
   * Set how channels are ordered in the sidebar.
   */
  setChannelSortOrder: op<{ id: string; channelSortOrder: string }, void>('preferences.setChannelSortOrder', 'mutator'),

  /**
   * Set the filter and sort applied to one sidebar group.
   *
   * `filterMode` is ACTIVE | UNREADS | MENTIONS | ALL.
   */
  setSidebarGroup: op<{
      id: string;
      group: 'starred' | 'channels' | 'dms';
      filterMode?: string;
      sortOrder?: string;
    }, void>('preferences.setSidebarGroup', 'mutator'),

  /**
   * Choose whether Enter sends a message or inserts a newline.
   */
  setEnterSendsMessage: op<{ id: string; enterSendsMessage: boolean }, void>('preferences.setEnterSendsMessage', 'mutator'),

  /**
   * Show or hide thread tags.
   */
  setShowThreadTags: op<{ id: string; showThreadTags: boolean }, void>('preferences.setShowThreadTags', 'mutator'),

  /**
   * Allow or block broadcast mentions inside threads.
   */
  setAllowThreadBroadcastMentions: op<{ id: string; allowThreadBroadcastMentions: boolean }, void>('preferences.setAllowThreadBroadcastMentions', 'mutator'),

  // ----- Profile and presence -----

  /**
   * Update the current user's profile card.
   */
  updateProfile: op<{
      profileId: string;
      displayName?: string;
      pronunciation?: string;
      team?: string;
      phoneNumber?: string;
      dob?: number;
      manager?: string;
    }, void>('preferences.updateProfile', 'mutator'),

  /**
   * Set a status emoji, message, or availability window.
   */
  updatePresence: op<{
      presenceId: string;
      statusEmoji?: string;
      statusContent?: string;
      statusExpiryAt?: number;
      assignmentUnavailableUntil?: number;
      notificationsPausedUntil?: number;
    }, void>('preferences.updatePresence', 'mutator'),

  // ----- Bookmarks -----

  /**
   * Bookmark something.
   */
  addBookmark: op<{ bookmarkId: string; entityId: string; entityType: string; metadata?: unknown }, void>('preferences.addBookmark', 'mutator'),

  /**
   * Remove a bookmark, or mark it done.
   */
  removeBookmark: op<{ entityId: string; entityType: string; markAsDone?: boolean }, void>('preferences.removeBookmark', 'mutator'),

  /**
   * Change a bookmark's metadata, such as a reminder time.
   */
  updateBookmark: op<{ entityId: string; entityType: string; metadata: unknown }, void>('preferences.updateBookmark', 'mutator'),

  // ----- Saved views -----

  /**
   * Save a filter configuration for reuse.
   */
  createSavedView: op<{
      id: string;
      name: string;
      contextType: string;
      contextId: string;
      channelId: string;
      visibility: string;
      values: unknown;
    }, void>('preferences.createSavedView', 'mutator'),

  /**
   * Update a saved view.
   */
  updateSavedView: op<{
      configId: string;
      values: unknown;
      name?: string;
      visibility?: string;
      isStarred?: boolean;
    }, void>('preferences.updateSavedView', 'mutator'),

  /**
   * Delete a saved view.
   */
  deleteSavedView: op<{ configId: string }, void>('preferences.deleteSavedView', 'mutator'),
} as const;

export type { UserProfile };
