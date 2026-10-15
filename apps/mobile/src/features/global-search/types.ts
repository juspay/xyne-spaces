/**
 * The feature's own row and filter shapes, kept apart from the backend's
 * `DisplaySearchResult` so response shapes do not leak into row components.
 */

/** Local people row for Chats tab. */
export type SearchPersonItem = {
  id: string;
  title: string;
  subtitle?: string;
  statusEmoji?: string;
};

/** Local channel row for Channels tab. */
export type SearchChannelItem = {
  id: string;
  title: string;
  visibility?: string;
  unreadCount?: number;
  isStarred?: boolean;
};

/** Local Group DM conversation row for DMs tab. */
export type SearchGroupDmItem = {
  id: string;
  title: string;
  avatarUserIds: string[];
  isStarred?: boolean;
};

/** Dashboard-parity cmd+K filter chips (`from:` / `in:`). */
export type SearchFilterPrefix = 'from:' | 'in:';

export type SearchFilterChip = {
  /** User id (`from:`) or channel/DM id (`in:`). */
  id: string;
  /** Display name shown in the chip. */
  label: string;
  prefix: SearchFilterPrefix;
  entityType: 'user' | 'channel';
  /** Optional — private channel lock icon, etc. */
  visibility?: string;
  /**
   * Presentational only — `in:` covers channels *and* DMs, which `entityType`
   * cannot express (it stays `'channel'` for both so request building is
   * unaffected).
   */
  targetKind?: 'channel' | 'dm';
};

/** Target row for `in:` typeahead (channel or DM conversation). */
export type SearchInTargetItem = {
  id: string;
  title: string;
  kind: 'channel' | 'dm';
  visibility?: string;
  /** For DM rows — avatar user ids. */
  avatarUserIds?: string[];
};

/**
 * A conversation the search page is locked to, seeded from route params when
 * search is opened from a conversation's info screen. Unlike a SearchFilterChip
 * it never renders and cannot be removed — it only narrows the Vespa query.
 */
export type SearchScope = {
  channelId: string;
  label: string;
};
