import { DatabaseClient } from '@/database/client';
import { NotificationLevel, NotificationType } from '@prisma/client';

const prisma = DatabaseClient.getInstance();

// System fallback for regular channels when no preference exists.
const DEFAULT_CHANNEL_NOTIFICATION_LEVEL = NotificationLevel.MENTIONS_ONLY;
// 1:1 DMs always notify unless explicitly muted.
const DEFAULT_DM_NOTIFICATION_LEVEL: NotificationLevel = NotificationLevel.ALL;

// ── Pre-fetch types ───────────────────────────────────────────────────────────

type ChannelStatusRow = {
  desktopNotificationLevel: NotificationLevel | null;
  mobileNotificationLevel: NotificationLevel | null;
  threadReplyNotificationsEnabled: boolean | null;
  channelWideMentionsEnabled: boolean | null;
};

type UserPreferenceRow = {
  globalDesktopNotificationLevel: NotificationLevel;
  globalMobileNotificationLevel: NotificationLevel;
  threadReplyNotificationsEnabled: boolean;
  channelWideMentionsEnabled: boolean;
  notificationKeywords?: string[];
};

/**
 * Pre-fetched notification data for a set of users + channel.
 * Pass to filterUsers to skip redundant DB queries when multiple notification
 * calls cover disjoint subsets of the same channel participants.
 */
export type PrefetchedFilterData = {
  channelStatuses: Map<string, ChannelStatusRow>;
  presences:       Map<string, Date | null>;
  preferences:     Map<string, UserPreferenceRow>;
};

/**
 * Fetch channelUserStatus, userPresence, and userPreference for all userIds in
 * one parallel round-trip. Pass the result to filterUsers as prefetchedData so
 * multiple notification calls for the same channel share a single DB fetch.
 */
export async function prefetchFilterData(
  userIds: string[],
  channelId: string,
): Promise<PrefetchedFilterData> {
  if (userIds.length === 0) {
    return { channelStatuses: new Map(), presences: new Map(), preferences: new Map() };
  }

  const [statuses, presences, prefs] = await Promise.all([
    prisma.channelUserStatus.findMany({
      where: { channelId, userId: { in: userIds } },
      select: {
        userId: true,
        desktopNotificationLevel: true,
        mobileNotificationLevel: true,
        threadReplyNotificationsEnabled: true,
        channelWideMentionsEnabled: true,
      },
    }),
    prisma.userPresence.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, notificationsPausedUntil: true },
    }),
    prisma.userPreference.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        globalDesktopNotificationLevel: true,
        globalMobileNotificationLevel: true,
        threadReplyNotificationsEnabled: true,
        channelWideMentionsEnabled: true,
        notificationKeywords: true,
      },
    }),
  ]);

  return {
    channelStatuses: new Map(statuses.map(({ userId, ...rest }) => [userId, rest])),
    presences:       new Map(presences.map(p => [p.userId, p.notificationsPausedUntil])),
    preferences:     new Map(prefs.map(({ userId, ...rest }) => [userId, rest])),
  };
}

/**
 * The type of notification being delivered, used to gate which NotificationLevel
 * values allow the notification through in Layer 3 of the evaluation.
 *
 * - 'channel_message' → passes only for ALL
 * - 'mention'         → passes for ALL, MENTIONS_ONLY, and THREADS_ONLY (legacy)
 * - 'thread_reply'    → NOT evaluated here; gated solely by the thread reply toggle +
 *                       NONE check (see filterUsers regular channel path)
 * - 'thread_mention'  → passes for ALL, MENTIONS_ONLY, and THREADS_ONLY (legacy)
 */
export type NotificationContext =
  | 'channel_message'
  | 'mention'
  | 'thread_reply'
  | 'thread_mention';

interface UserNotificationSettings {
  userId: string;
  desktopNotificationLevel: NotificationLevel;
  mobileNotificationLevel: NotificationLevel | null;
  globalPausedUntil: Date | number | null;
}

/**
 * Global notification preferences fetched from UserPreference.
 * All fields default to MENTIONS_ONLY when no row exists.
 */
interface GlobalUserPreferences {
  globalDesktopNotificationLevel: NotificationLevel;
  globalMobileNotificationLevel: NotificationLevel;
  threadReplyNotificationsEnabled: boolean;
  channelWideMentionsEnabled: boolean;
}

const DEFAULT_GLOBAL_PREFS: GlobalUserPreferences = {
  globalDesktopNotificationLevel: NotificationLevel.MENTIONS_ONLY,
  globalMobileNotificationLevel: NotificationLevel.MENTIONS_ONLY,
  threadReplyNotificationsEnabled: true,
  channelWideMentionsEnabled: true,
};

/**
 * Parse a timestamp value (Date or number) into milliseconds, returns null if absent.
 */
function parseTimestamp(value: Date | number | null | undefined): number | null {
  if (value == null) return null;
  return typeof value === 'number' ? value : new Date(value).getTime();
}

/**
 * Determine whether a given NotificationLevel allows a notification through for
 * the specified context.
 *
 * NotificationLevel semantics:
 *   ALL           – every notification type passes (channel posts + mentions)
 *   MENTIONS_ONLY – only explicit @mentions, tickets, canvas, and workflows pass
 *   THREADS_ONLY  – legacy value; treated identically to MENTIONS_ONLY
 *   NONE          – nothing passes (explicit mute)
 *
 * Note: 'thread_reply' context is NOT evaluated here. Thread replies are gated
 * solely by the thread reply toggle + NONE check in the filter loop.
 */
function isLevelAllowed(level: NotificationLevel, context: NotificationContext): boolean {
  switch (context) {
    case 'channel_message':
      // Top-level channel messages only notify users who have opted into ALL.
      return level === NotificationLevel.ALL;
    case 'mention':
    case 'thread_mention':
      // Mentions, tickets, canvas, and workflow notifications pass for everything
      // except NONE. THREADS_ONLY is a legacy value treated like MENTIONS_ONLY.
      return (
        level === NotificationLevel.ALL ||
        level === NotificationLevel.MENTIONS_ONLY ||
        level === NotificationLevel.THREADS_ONLY
      );
    default:
      return true;
  }
}

/**
 * Check if a user should receive a notification on specific devices.
 *
 * Priority layers (highest → lowest):
 * 1. Global pause (UserPresence.notificationsPausedUntil) — suppresses ALL notifications if active.
 * 2. Per-device notification level filtered by notification context:
 *    - 'channel_message': ALL passes.
 *    - 'mention':         ALL, MENTIONS_ONLY, or THREADS_ONLY (legacy) passes.
 *    - 'thread_reply':    ALL or THREADS_ONLY (legacy) passes; MENTIONS_ONLY blocks.
 *    - 'thread_mention':  ALL, MENTIONS_ONLY, or THREADS_ONLY (legacy) passes.
 */
function evaluateNotificationSettings(
  settings: UserNotificationSettings,
  context: NotificationContext,
): { shouldNotifyDesktop: boolean; shouldNotifyMobile: boolean; reason?: string } {
  const {
    desktopNotificationLevel,
    mobileNotificationLevel,
    globalPausedUntil,
  } = settings;

  const now = Date.now();

  // ─── Layer 1: Global pause ───────────────────────────────────────────────
  const globalPausedTs = parseTimestamp(globalPausedUntil);
  const isGloballyPaused = globalPausedTs !== null && globalPausedTs > now;
  if (isGloballyPaused) {
    return {
      shouldNotifyDesktop: false,
      shouldNotifyMobile: false,
      reason: `Globally paused until ${new Date(globalPausedTs!).toISOString()}`,
    };
  }

  // ─── Layer 2 & 3: Per-device notification level (gated by notification context) ─
  // Effective mobile level: use mobileNotificationLevel override if set, otherwise fall back to desktopNotificationLevel
  const effectiveMobileLevel = mobileNotificationLevel ?? desktopNotificationLevel;

  const shouldNotifyDesktop = isLevelAllowed(desktopNotificationLevel, context);
  const shouldNotifyMobile = isLevelAllowed(effectiveMobileLevel, context);

  return {
    shouldNotifyDesktop,
    shouldNotifyMobile,
  };
}

/**
 * Options for filterUsers — extend the base call with type-specific gating context.
 */
export interface FilterUsersOptions {
  /**
   * The Prisma NotificationType being delivered. Used to gate Layer 4 type-specific
   * toggles (huddle, thread reply).
   */
  notificationType?: NotificationType;
  /**
   * For @channel / @here mentions — the raw mentionType string from the message.
   * When set to '@channel' or '@here', gated by UserPreference.channelWideMentionsEnabled.
   */
  mentionType?: '@channel' | '@here';
}

/**
 * Filter a list of user IDs based on notification settings.
 * Returns two lists: users who should receive desktop notifications and users who should receive mobile notifications.
 *
 * Priority layers (highest → lowest):
 * 1. Global pause — if active, user is excluded from both lists entirely (applies to DMs too).
 * 2. DM shortcut — if `isDMChannel=true`, only the per-channel NONE check applies.
 *    DMs are exempt from the level picker (MENTIONS_ONLY still delivers DMs) and from
 *    type-specific toggles (thread reply toggle does not apply inside DMs).
 * 3. Layer 4 type-specific gates (regular channels only, channel override ?? UserPreference global):
 *    - THREAD_REPLY  → threadReplyNotificationsEnabled toggle
 *    - @channel/@here → channelWideMentionsEnabled toggle
 * 4. Effective notification level (channel override ?? global level ?? system default):
 *    - Channel-level (ChannelUserStatus) takes priority when set.
 *    - null channel level → inherits UserPreference global level.
 *    - 'channel_message' → ALL passes only.
 *    - 'mention'         → ALL, MENTIONS_ONLY, or THREADS_ONLY passes.
 *    - 'thread_reply'    → level is irrelevant; gated solely by toggle (step 3) + NONE check.
 *
 * @param userIds        - List of user IDs to filter.
 * @param channelId      - The channel ID (used for fetching channel-specific settings).
 * @param isDMChannel    - If true, only global pause + NONE check applies (1:1 DM shortcut).
 * @param context        - The type of notification being sent.
 * @param options        - Optional type-specific gating context.
 * @param prefetchedData - Pre-fetched maps from prefetchFilterData(). When provided the three DB
 *                         queries are skipped entirely.
 * @param isGroupDM      - If true, skips the global preference in the level cascade and falls back
 *                         to DEFAULT_DM_NOTIFICATION_LEVEL (ALL). GROUP_DMs behave like 1:1 DMs —
 *                         always notify unless the user explicitly sets a per-channel override.
 */
export async function filterUsers(
  userIds: string[],
  channelId: string,
  isDMChannel: boolean = false,
  context: NotificationContext = 'mention',
  options: FilterUsersOptions = {},
  prefetchedData?: PrefetchedFilterData,
  isGroupDM: boolean = false,
): Promise<{ desktopUsers: string[]; mobileUsers: string[] }> {
  const desktopUsers: string[] = [];
  const mobileUsers: string[] = [];

  if (userIds.length === 0) {
    return { desktopUsers, mobileUsers };
  }

  const { notificationType, mentionType } = options;

  let channelStatusMap: Map<string, ChannelStatusRow>;
  let globalPauseMap: Map<string, Date | null>;
  let userPrefMap: Map<string, UserPreferenceRow>;

  if (prefetchedData) {
    // Reuse caller-supplied maps — zero extra DB queries.
    channelStatusMap = prefetchedData.channelStatuses;
    globalPauseMap   = prefetchedData.presences;
    userPrefMap      = prefetchedData.preferences;
  } else {
    // Fetch all three tables in parallel for this user subset.
    const [channelStatuses, userPresences, userPreferences] = await Promise.all([
      prisma.channelUserStatus.findMany({
        where: { channelId, userId: { in: userIds } },
        select: {
          userId: true,
          desktopNotificationLevel: true,
          mobileNotificationLevel: true,
          threadReplyNotificationsEnabled: true,
          channelWideMentionsEnabled: true,
        },
      }),
      prisma.userPresence.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, notificationsPausedUntil: true },
      }),
      prisma.userPreference.findMany({
        where: { userId: { in: userIds } },
        select: {
          userId: true,
          globalDesktopNotificationLevel: true,
          globalMobileNotificationLevel: true,
          threadReplyNotificationsEnabled: true,
          channelWideMentionsEnabled: true,
        },
      }),
    ]);

    channelStatusMap = new Map(channelStatuses.map(({ userId, ...rest }) => [userId, rest]));
    globalPauseMap   = new Map(userPresences.map(p => [p.userId, p.notificationsPausedUntil]));
    userPrefMap      = new Map(userPreferences.map(({ userId, ...rest }) => [userId, rest]));
  }

  for (const userId of userIds) {
    const channelStatus = channelStatusMap.get(userId);
    const globalPausedUntil = globalPauseMap.get(userId) ?? null;
    const pref = userPrefMap.get(userId);

    // Resolve global preferences — fall back to schema defaults when no row exists
    const globalPrefs: GlobalUserPreferences = {
      globalDesktopNotificationLevel:
        pref?.globalDesktopNotificationLevel ?? DEFAULT_GLOBAL_PREFS.globalDesktopNotificationLevel,
      globalMobileNotificationLevel:
        pref?.globalMobileNotificationLevel ?? DEFAULT_GLOBAL_PREFS.globalMobileNotificationLevel,
      threadReplyNotificationsEnabled:
        pref?.threadReplyNotificationsEnabled ?? DEFAULT_GLOBAL_PREFS.threadReplyNotificationsEnabled,
      channelWideMentionsEnabled:
        pref?.channelWideMentionsEnabled ?? DEFAULT_GLOBAL_PREFS.channelWideMentionsEnabled,
    };

    // ─── Layer 1: Global pause ─────────────────────────────────────────────
    const globalPausedTs = parseTimestamp(globalPausedUntil);
    const isGloballyPaused = globalPausedTs !== null && globalPausedTs > Date.now();
    if (isGloballyPaused) {
      continue;
    }

    // ─── DM channel path: global pause + NONE check only ──────────────────
    // DMs are not gated by the level picker (they pass on MENTIONS_ONLY too —
    // label is "Mentions & DMs"). Thread-reply and @channel toggles do not
    // apply inside DM channels.
    if (isDMChannel) {
      const desktopLevel = channelStatus?.desktopNotificationLevel ?? DEFAULT_DM_NOTIFICATION_LEVEL;
      const mobileLevel  = channelStatus?.mobileNotificationLevel  ?? desktopLevel;

      if (desktopLevel !== NotificationLevel.NONE) desktopUsers.push(userId);
      if (mobileLevel  !== NotificationLevel.NONE) mobileUsers.push(userId);
      continue;
    }

    // ─── Layer 4: Type-specific gates (regular channels only) ─────────────

    // Gate: thread reply notifications — channel override ?? global
    // (still requires ConversationParticipant.isSubscribed, enforced upstream)
    const effectiveThreadReply =
      channelStatus?.threadReplyNotificationsEnabled ?? globalPrefs.threadReplyNotificationsEnabled;
    if (notificationType === NotificationType.THREAD_REPLY && !effectiveThreadReply) {
      continue;
    }

    // Gate: @channel / @here mentions — channel override ?? global
    const effectiveChannelWideMentions =
      channelStatus?.channelWideMentionsEnabled ?? globalPrefs.channelWideMentionsEnabled;
    if (mentionType && !effectiveChannelWideMentions) {
      continue;
    }

    // ─── Regular channel / GROUP_DM path: resolve effective level ────────
    // GROUP_DM: skip global pref — default to ALL like 1:1 DMs (users can still
    //   set a per-channel override to get MENTIONS_ONLY or NONE behaviour).
    // Regular channel: channel override ?? global pref ?? system default.
    const effectiveDesktop =
      channelStatus?.desktopNotificationLevel ??
      (isGroupDM
        ? DEFAULT_DM_NOTIFICATION_LEVEL
        : (globalPrefs.globalDesktopNotificationLevel ?? DEFAULT_CHANNEL_NOTIFICATION_LEVEL));

    const effectiveMobile =
      channelStatus?.mobileNotificationLevel ??
      (isGroupDM ? effectiveDesktop : (globalPrefs.globalMobileNotificationLevel ?? effectiveDesktop));

    // ─── Thread reply: level is irrelevant — toggle is the sole gate ───────
    // We already passed the toggle check in Layer 4 above. Only NONE (channel
    // explicitly muted) still blocks — ALL vs MENTIONS_ONLY does not.
    if (notificationType === NotificationType.THREAD_REPLY) {
      if (effectiveDesktop !== NotificationLevel.NONE) desktopUsers.push(userId);
      if (effectiveMobile  !== NotificationLevel.NONE) mobileUsers.push(userId);
      continue;
    }

    // ─── All other contexts: evaluate against level ────────────────────────
    const settings: UserNotificationSettings = {
      userId,
      desktopNotificationLevel: effectiveDesktop,
      mobileNotificationLevel: effectiveMobile,
      globalPausedUntil: null, // Already checked above
    };

    const result = evaluateNotificationSettings(settings, context);
    if (result.shouldNotifyDesktop) desktopUsers.push(userId);
    if (result.shouldNotifyMobile) mobileUsers.push(userId);
  }

  return { desktopUsers, mobileUsers };
}

/**
 * Filter users for notifications that have no channel context (e.g. call notifications,
 * ticket assignments without a linked channel, workflow completions).
 *
 * Applies:
 *   1. Global pause
 *   2. Layer 4 type-specific gate (THREAD_REPLY toggle)
 *   3. Global notification level gated by `context` (desktop and mobile independently)
 *
 * @param userIds          - List of user IDs to filter.
 * @param notificationType - The NotificationType being delivered (used for Layer 4 gates).
 * @param context          - Notification context for global level evaluation.
 *                           Defaults to 'channel_message' so that MENTIONS_ONLY suppresses
 *                           non-mention global notifications (tickets, workflows, etc.).
 *                           Pass 'mention' to let MENTIONS_ONLY users through.
 */
export async function filterGlobalUsers(
  userIds: string[],
  notificationType: NotificationType,
  context: NotificationContext = 'channel_message',
): Promise<{ desktopUsers: string[]; mobileUsers: string[] }> {
  const desktopUsers: string[] = [];
  const mobileUsers: string[] = [];

  if (userIds.length === 0) {
    return { desktopUsers, mobileUsers };
  }

  // ── Batch fetch 1: Global pause ──────────────────────────────────────────
  const userPresences = await prisma.userPresence.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, notificationsPausedUntil: true },
  });

  // ── Batch fetch 2: Global notification preferences ───────────────────────
  const userPreferences = await prisma.userPreference.findMany({
    where: { userId: { in: userIds } },
    select: {
      userId: true,
      globalDesktopNotificationLevel: true,
      globalMobileNotificationLevel: true,
      threadReplyNotificationsEnabled: true,
    },
  });

  const globalPauseMap = new Map(
    userPresences.map(p => [p.userId, p.notificationsPausedUntil]),
  );
  const userPrefMap = new Map(userPreferences.map(p => [p.userId, p]));

  for (const userId of userIds) {
    // ─── Layer 1: Global pause ─────────────────────────────────────────────
    const globalPausedUntil = globalPauseMap.get(userId) ?? null;
    const globalPausedTs = parseTimestamp(globalPausedUntil);
    if (globalPausedTs !== null && globalPausedTs > Date.now()) {
      continue;
    }

    const pref = userPrefMap.get(userId);

    // ─── Layer 4: Type-specific gate ──────────────────────────────────────
    if (notificationType === NotificationType.THREAD_REPLY) {
      const threadReplyEnabled = pref?.threadReplyNotificationsEnabled ?? DEFAULT_GLOBAL_PREFS.threadReplyNotificationsEnabled;
      if (!threadReplyEnabled) continue;
    }

    // ─── Layer 3: Global notification level ───────────────────────────────
    const desktopLevel =
      pref?.globalDesktopNotificationLevel ?? DEFAULT_GLOBAL_PREFS.globalDesktopNotificationLevel;
    const mobileLevel =
      pref?.globalMobileNotificationLevel ?? pref?.globalDesktopNotificationLevel ?? DEFAULT_GLOBAL_PREFS.globalMobileNotificationLevel;

    if (isLevelAllowed(desktopLevel, context)) desktopUsers.push(userId);
    if (isLevelAllowed(mobileLevel, context)) mobileUsers.push(userId);
  }

  return { desktopUsers, mobileUsers };
}
