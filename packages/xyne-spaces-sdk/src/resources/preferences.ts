/**
 * Preferences Resource
 *
 * The current user's own settings: notifications, interface behaviour, profile
 * card, presence, bookmarks, and saved views.
 *
 * Several operations write to a single preference row. Its id is generated on
 * first use and can be passed back on later calls; read it from `get()` if you
 * want to reuse the same row explicitly.
 */

import { Resource } from './base.js';
import { preferencesOperations } from '../registry/preferences.js';
import { newId } from '../core/ids.js';

export class PreferencesResource extends Resource {
  /** Get the current user's preference row. */
  get(): Promise<unknown> {
    return this.call(preferencesOperations.get, undefined);
  }

  // ----- Notifications -----

  /**
   * Set global notification levels.
   *
   * @example
   * await sdk.preferences.setNotificationSettings({
   *   globalDesktopNotificationLevel: 'MENTIONS_ONLY',
   * });
   */
  setNotificationSettings(data: {
    id?: string;
    globalDesktopNotificationLevel?: string;
    globalMobileNotificationLevel?: string;
    threadReplyNotificationsEnabled?: boolean;
    channelWideMentionsEnabled?: boolean;
  }): Promise<void> {
    return this.call(preferencesOperations.setNotificationSettings, {
      ...data,
      id: data.id ?? newId(),
    });
  }

  /** Set the words that trigger a notification when mentioned. */
  setNotificationKeywords(keywords: string[], options?: { id?: string }): Promise<void> {
    return this.call(preferencesOperations.setNotificationKeywords, {
      keywords,
      id: options?.id ?? newId(),
    });
  }

  /**
   * Override notification behaviour for one channel.
   *
   * Pass `null` for a level to clear the override and fall back to the global
   * setting.
   */
  setChannelNotifications(
    channelId: string,
    data: {
      desktopNotificationLevel?: string | null;
      mobileNotificationLevel?: string | null;
      threadReplyNotificationsEnabled?: boolean | null;
      channelWideMentionsEnabled?: boolean | null;
    }
  ): Promise<void> {
    return this.call(preferencesOperations.setChannelNotifications, {
      channelId,
      ...data,
    });
  }

  // ----- Interface -----

  /** Set how channels are ordered in the sidebar. */
  setChannelSortOrder(channelSortOrder: string, options?: { id?: string }): Promise<void> {
    return this.call(preferencesOperations.setChannelSortOrder, {
      channelSortOrder,
      id: options?.id ?? newId(),
    });
  }

  /** Choose whether Enter sends a message or inserts a newline. */
  setEnterSendsMessage(enterSendsMessage: boolean, options?: { id?: string }): Promise<void> {
    return this.call(preferencesOperations.setEnterSendsMessage, {
      enterSendsMessage,
      id: options?.id ?? newId(),
    });
  }

  /** Show or hide thread tags. */
  setShowThreadTags(showThreadTags: boolean, options?: { id?: string }): Promise<void> {
    return this.call(preferencesOperations.setShowThreadTags, {
      showThreadTags,
      id: options?.id ?? newId(),
    });
  }

  /** Allow or block broadcast mentions inside threads. */
  setAllowThreadBroadcastMentions(
    allowThreadBroadcastMentions: boolean,
    options?: { id?: string }
  ): Promise<void> {
    return this.call(preferencesOperations.setAllowThreadBroadcastMentions, {
      allowThreadBroadcastMentions,
      id: options?.id ?? newId(),
    });
  }

  // ----- Profile and presence -----

  /**
   * Update the current user's profile card.
   *
   * @returns The profile row id
   */
  async updateProfile(data: {
    profileId?: string;
    displayName?: string;
    pronunciation?: string;
    team?: string;
    phoneNumber?: string;
    dob?: number;
    manager?: string;
  }): Promise<{ profileId: string }> {
    const profileId = data.profileId ?? newId();
    await this.call(preferencesOperations.updateProfile, { ...data, profileId });
    return { profileId };
  }

  /**
   * Set a status emoji, message, or availability window.
   *
   * @param data.statusExpiryAt - When the status clears, epoch milliseconds
   * @param data.assignmentUnavailableUntil - Pause ticket assignment until then
   * @returns The presence row id
   *
   * @example
   * await sdk.preferences.updatePresence({
   *   statusEmoji: 'palm_tree',
   *   statusContent: 'On leave',
   *   statusExpiryAt: Date.now() + 86_400_000,
   * });
   */
  async updatePresence(data: {
    presenceId?: string;
    statusEmoji?: string;
    statusContent?: string;
    statusExpiryAt?: number;
    assignmentUnavailableUntil?: number;
    notificationsPausedUntil?: number;
  }): Promise<{ presenceId: string }> {
    const presenceId = data.presenceId ?? newId();
    await this.call(preferencesOperations.updatePresence, { ...data, presenceId });
    return { presenceId };
  }

  // ----- Bookmarks -----

  /** List the current user's bookmarks. */
  listBookmarks(): Promise<unknown[]> {
    return this.call(preferencesOperations.listBookmarks, undefined);
  }

  /**
   * Bookmark something.
   *
   * @returns The bookmark id
   */
  async addBookmark(data: {
    entityId: string;
    entityType: string;
    metadata?: unknown;
  }): Promise<{ bookmarkId: string }> {
    const bookmarkId = newId();
    await this.call(preferencesOperations.addBookmark, { bookmarkId, ...data });
    return { bookmarkId };
  }

  /**
   * Remove a bookmark.
   *
   * @param options.markAsDone - Complete it rather than deleting it outright
   */
  removeBookmark(
    entityId: string,
    entityType: string,
    options?: { markAsDone?: boolean }
  ): Promise<void> {
    return this.call(preferencesOperations.removeBookmark, {
      entityId,
      entityType,
      ...options,
    });
  }

  /** Change a bookmark's metadata, such as a reminder time. */
  updateBookmark(entityId: string, entityType: string, metadata: unknown): Promise<void> {
    return this.call(preferencesOperations.updateBookmark, {
      entityId,
      entityType,
      metadata,
    });
  }

  // ----- Saved views -----

  /** List the saved filter views the current user created. */
  listSavedViews(): Promise<unknown[]> {
    return this.call(preferencesOperations.listSavedViews, undefined);
  }

  /**
   * Save a filter configuration for reuse.
   *
   * @returns The saved view id
   */
  async createSavedView(data: {
    name: string;
    contextType: string;
    contextId: string;
    channelId: string;
    visibility: string;
    values: unknown;
  }): Promise<{ id: string }> {
    const id = newId();
    await this.call(preferencesOperations.createSavedView, { id, ...data });
    return { id };
  }

  /** Update a saved view. */
  updateSavedView(
    configId: string,
    data: { values: unknown; name?: string; visibility?: string; isStarred?: boolean }
  ): Promise<void> {
    return this.call(preferencesOperations.updateSavedView, { configId, ...data });
  }

  /** Delete a saved view. */
  deleteSavedView(configId: string): Promise<void> {
    return this.call(preferencesOperations.deleteSavedView, { configId });
  }
}
