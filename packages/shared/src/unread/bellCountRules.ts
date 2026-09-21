/**
 * Unread badge count rules — the single source of truth for what counts as a
 * "bell-shelf" unread activity and what the "dm shelf" subtracts.
 *
 * Imported by BOTH the dashboard hooks (Zero-synced rail badges) and the
 * backend endpoint (polled dock/switcher counts), each adapting the rules to
 * its own query builder. Parity tests assert both adapters return the same
 * set on golden fixtures — see the unread badge unification plan (§3.1).
 *
 * Invariant: workspace count = dmCount + bellCount + callCount. Every event
 * lands in exactly one shelf; the dock renders the sum over all workspaces.
 */

/** Actor actions never counted in the bell shelf. */
export const BELL_EXCLUDED_ACTOR_ACTIONS = ['added_v2', 'removed'] as const;

/** Calls shelf owns missed calls — the bell excludes them. */
export const BELL_EXCLUDED_CALL_ACTOR_ACTION = 'missed_call';

/**
 * Classifications excluded from the bell count. ERROR and PENDING are counted:
 * an LLM failure must not lose potentially important counts.
 */
export const BELL_EXCLUDED_CLASSIFICATIONS = ['SKIP'] as const;

/**
 * Legacy `direct_message` activity rows are dm-shelf content — fully excluded
 * from the bell count.
 */
export const BELL_EXCLUDED_LEGACY_DIRECT_MESSAGE_ACTIONS = ['direct_message'] as const;

/** Channel scopes whose unreads belong to the dm shelf. */
export const DM_SHELF_CHANNEL_SCOPES = ['DM', 'GROUP_DM'] as const;

/**
 * GROUP_DM unread top-level mention activities belong to the bell shelf
 * ("mention wins the bucket"), so the dm shelf subtracts them per channel.
 * Actor actions of the rows it subtracts:
 */
export const DM_SHELF_MENTION_ACTOR_ACTIONS = ['mentioned_user', 'group_mention'] as const;

/** Bell count rules, assembled (see the individual constants above). */
export const BELL_COUNT_RULES = {
  excludedActorActions: BELL_EXCLUDED_ACTOR_ACTIONS,
  excludedCalls: { actionSource: 'call', actorAction: BELL_EXCLUDED_CALL_ACTOR_ACTION },
  excludedClassifications: BELL_EXCLUDED_CLASSIFICATIONS,
  /** Legacy `direct_message` rows are dm-shelf content, never bell. */
  excludedLegacyDirectMessageActions: BELL_EXCLUDED_LEGACY_DIRECT_MESSAGE_ACTIONS,
  /** Closed channels are excluded via a per-user pair filter, not this list. */
  excludeClosedChannels: true,
  dmShelf: {
    channelScopes: DM_SHELF_CHANNEL_SCOPES,
    mentionActorActions: DM_SHELF_MENTION_ACTOR_ACTIONS,
  },
} as const;

/**
 * The window event fired after read mutations so the poll-fed badges (dock,
 * workspace switcher) refresh immediately instead of waiting up to the poll
 * interval. Dispatched by the Zero client wrapper after these mutators
 * complete — one chokepoint, so no call site can miss it.
 */
export const UNREAD_REFETCH_EVENT_NAME = 'unread:refetch';

/**
 * Zero mutators (dot-separated registry names) whose success changes unread
 * counts — each triggers {@link UNREAD_REFETCH_EVENT_NAME}.
 */
export const UNREAD_COUNT_MUTATORS = [
  'channel.markChannelAsViewed',
  'channel.markChannelUnreadFrom',
  'channel.closeDm',
  'channel.reopenDm',
  'activities.markAsRead',
  'activities.markAsReadByFilter',
  'activities.markMissedCallsAsRead',
] as const;

/** Fire the unread refetch event (no-op outside a DOM environment). */
export const emitUnreadRefetch = (): void => {
  // Guard both window and CustomEvent: this module is imported by the shared
  // useZero hook, which non-browser consumers (e.g. React Native) also use.
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UNREAD_REFETCH_EVENT_NAME));
};
