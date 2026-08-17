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

import { query, mutator } from './types.js';
import { now } from '../core/ids.js';
import type { UserProfile } from '../types/index.js';

export const preferencesOperations = {
  // ----- Reads -----

  /**
   * The current user's preference row.
   * Maps to: Zero query 'getCurrentUserPreference'
   */
  get: query<void, unknown>('getCurrentUserPreference', {
    // Declared as an empty object rather than no arguments.
    mapArgs: () => ({}),
  }),

  /**
   * The current user's bookmarks.
   * Maps to: Zero query 'userBookmarks'
   */
  listBookmarks: query<void, unknown[]>('userBookmarks'),

  /**
   * Saved filter views a user created.
   * Maps to: Zero query 'savedConfigsByUser'
   *
   * Takes an explicit `userId` — despite the old `void` signature suggesting it was
   * caller-scoped, the query has no `ctx` fallback, so it required an argument the
   * SDK never sent. Pass `me.id` from `sdk.users.me()` for your own views.
   */
  listSavedViews: query<{ userId: string }, unknown[]>('savedConfigsByUser'),

  // ----- Notification settings -----

  /**
   * Set global notification levels.
   * Maps to: Zero mutator 'userPreference.setGlobalNotificationSettings'
   */
  setNotificationSettings: mutator<
    {
      id: string;
      globalDesktopNotificationLevel?: string;
      globalMobileNotificationLevel?: string;
      threadReplyNotificationsEnabled?: boolean;
      channelWideMentionsEnabled?: boolean;
    },
    void
  >('userPreference.setGlobalNotificationSettings', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Set the words that trigger a notification when mentioned.
   * Maps to: Zero mutator 'userPreference.setNotificationKeywords'
   */
  setNotificationKeywords: mutator<{ id: string; keywords: string[] }, void>(
    'userPreference.setNotificationKeywords',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  /**
   * Override notification behaviour for one channel.
   * Maps to: Zero mutator 'notificationSettings.setChannelNotificationLevel'
   */
  setChannelNotifications: mutator<
    {
      channelId: string;
      desktopNotificationLevel?: string | null;
      mobileNotificationLevel?: string | null;
      threadReplyNotificationsEnabled?: boolean | null;
      channelWideMentionsEnabled?: boolean | null;
    },
    void
  >('notificationSettings.setChannelNotificationLevel', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  // ----- Interface preferences -----

  /**
   * Set how channels are ordered in the sidebar.
   * Maps to: Zero mutator 'userPreference.setChannelSortOrder'
   */
  setChannelSortOrder: mutator<{ id: string; channelSortOrder: string }, void>(
    'userPreference.setChannelSortOrder',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  /**
   * Set the filter and sort applied to one sidebar group.
   * Maps to: Zero mutator 'userPreference.setSidebarGroupPreference'
   *
   * `filterMode` is ACTIVE | UNREADS | MENTIONS | ALL.
   */
  setSidebarGroup: mutator<
    {
      id: string;
      group: 'starred' | 'channels' | 'dms';
      filterMode?: string;
      sortOrder?: string;
    },
    void
  >('userPreference.setSidebarGroupPreference', {
    mapArgs: (args) => ({
      id: args.id,
      group: args.group,
      ...(args.filterMode ? { filterMode: args.filterMode } : {}),
      ...(args.sortOrder ? { sortOrder: args.sortOrder } : {}),
      timestamp: now(),
    }),
  }),

  /**
   * Choose whether Enter sends a message or inserts a newline.
   * Maps to: Zero mutator 'userPreference.setEnterSendsMessage'
   */
  setEnterSendsMessage: mutator<{ id: string; enterSendsMessage: boolean }, void>(
    'userPreference.setEnterSendsMessage',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  /**
   * Show or hide thread tags.
   * Maps to: Zero mutator 'userPreference.setShowThreadTags'
   */
  setShowThreadTags: mutator<{ id: string; showThreadTags: boolean }, void>(
    'userPreference.setShowThreadTags',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  /**
   * Allow or block broadcast mentions inside threads.
   * Maps to: Zero mutator 'userPreference.setAllowThreadBroadcastMentions'
   */
  setAllowThreadBroadcastMentions: mutator<
    { id: string; allowThreadBroadcastMentions: boolean },
    void
  >('userPreference.setAllowThreadBroadcastMentions', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  // ----- Profile and presence -----

  /**
   * Update the current user's profile card.
   * Maps to: Zero mutator 'userProfile.upsert'
   */
  updateProfile: mutator<
    {
      profileId: string;
      displayName?: string;
      pronunciation?: string;
      team?: string;
      phoneNumber?: string;
      dob?: number;
      manager?: string;
    },
    void
  >('userProfile.upsert', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Set a status emoji, message, or availability window.
   * Maps to: Zero mutator 'userPresence.upsert'
   */
  updatePresence: mutator<
    {
      presenceId: string;
      statusEmoji?: string;
      statusContent?: string;
      statusExpiryAt?: number;
      assignmentUnavailableUntil?: number;
      notificationsPausedUntil?: number;
    },
    void
  >('userPresence.upsert', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  // ----- Bookmarks -----

  /**
   * Bookmark something.
   * Maps to: Zero mutator 'bookmark.add'
   */
  addBookmark: mutator<
    { bookmarkId: string; entityId: string; entityType: string; metadata?: unknown },
    void
  >('bookmark.add', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Remove a bookmark, or mark it done.
   * Maps to: Zero mutator 'bookmark.remove'
   */
  removeBookmark: mutator<
    { entityId: string; entityType: string; markAsDone?: boolean },
    void
  >('bookmark.remove', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Change a bookmark's metadata, such as a reminder time.
   * Maps to: Zero mutator 'bookmark.updateMetadata'
   */
  updateBookmark: mutator<
    { entityId: string; entityType: string; metadata: unknown },
    void
  >('bookmark.updateMetadata'),

  // ----- Saved views -----

  /**
   * Save a filter configuration for reuse.
   * Maps to: Zero mutator 'savedUserConfiguration.create'
   */
  createSavedView: mutator<
    {
      id: string;
      name: string;
      contextType: string;
      contextId: string;
      channelId: string;
      visibility: string;
      values: unknown;
    },
    void
  >('savedUserConfiguration.create', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Update a saved view.
   * Maps to: Zero mutator 'savedUserConfiguration.update'
   */
  updateSavedView: mutator<
    {
      configId: string;
      values: unknown;
      name?: string;
      visibility?: string;
      isStarred?: boolean;
    },
    void
  >('savedUserConfiguration.update', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Delete a saved view.
   * Maps to: Zero mutator 'savedUserConfiguration.delete'
   */
  deleteSavedView: mutator<{ configId: string }, void>('savedUserConfiguration.delete'),
} as const;

export type { UserProfile };
