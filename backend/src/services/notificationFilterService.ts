import { DatabaseClient } from '@/database/client';
import { NotificationLevel } from '@prisma/client';

const prisma = DatabaseClient.getInstance();

// Regular channel UI "Default" is persisted as THREADS_ONLY for compatibility.
// Product meaning: notify for mentions and subscribed thread replies, but not
// every top-level channel message.
const DEFAULT_CHANNEL_NOTIFICATION_LEVEL = NotificationLevel.THREADS_ONLY;
const DEFAULT_DM_NOTIFICATION_LEVEL: NotificationLevel = NotificationLevel.ALL;

/**
 * The type of notification being delivered, used to gate which NotificationLevel
 * values allow the notification through in Layer 3 of the evaluation.
 *
 * - 'channel_message' → passes only for ALL
 * - 'mention'         → passes for ALL, MENTIONS_ONLY, and THREADS_ONLY (UI Default)
 * - 'thread_reply'    → passes for ALL and THREADS_ONLY (UI Default); blocked by MENTIONS_ONLY
 * - 'thread_mention'  → passes for ALL, MENTIONS_ONLY, and THREADS_ONLY (UI Default) (a direct @mention
 *                       inside a thread — relevant to both mention and thread subscribers)
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
 *   ALL           – every notification type passes (channel posts + mentions + thread replies)
 *   THREADS_ONLY  – UI Default for regular channels: explicit mentions and subscribed
 *                   thread replies pass; top-level channel posts are suppressed
 *   MENTIONS_ONLY – only explicit @mentions pass; thread replies are suppressed even if subscribed
 */
function isLevelAllowed(level: NotificationLevel, context: NotificationContext): boolean {
  switch (context) {
    case 'channel_message':
      // A normal top-level channel message is noisy, so only "All notifications"
      // users receive it. UI "Default" (stored as THREADS_ONLY) does not.
      return level === NotificationLevel.ALL;
    case 'mention':
    case 'thread_mention':
      // Direct mentions notify all enabled mention audiences:
      // - ALL: receives everything.
      // - MENTIONS_ONLY: receives direct mentions, including mentions inside threads.
      // - UI Default: persisted as THREADS_ONLY, receives mentions + subscribed thread replies.
      return (
        level === NotificationLevel.ALL ||
        level === NotificationLevel.MENTIONS_ONLY ||
        level === DEFAULT_CHANNEL_NOTIFICATION_LEVEL
      );
    case 'thread_reply':
      // A normal thread reply has no direct @mention. It should notify users who
      // chose ALL or UI Default (stored as THREADS_ONLY), but not MENTIONS_ONLY.
      return level === NotificationLevel.ALL || level === DEFAULT_CHANNEL_NOTIFICATION_LEVEL;
    default:
      return true;
  }
}

/**
 * Check if a user should receive a notification on specific devices.
 *
 * Priority layers (highest → lowest):
 * 1. Global pause (UserPresence.notificationsPausedUntil) — suppresses ALL notifications if active;
 *    user receives nothing on any device while paused.
 * 2. Per-device notification level filtered by notification context:
 *    - 'channel_message': ALL passes.
 *    - 'mention':         ALL, MENTIONS_ONLY, or THREADS_ONLY (UI Default) passes.
 *    - 'thread_reply':    ALL or THREADS_ONLY (UI Default) passes; MENTIONS_ONLY blocks.
 *    - 'thread_mention':  ALL, MENTIONS_ONLY, or THREADS_ONLY (UI Default) passes.
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

  // ─── Layer 2: Per-device notification level (gated by notification context) ─
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
 * Filter a list of user IDs based on global pause and notification level settings.
 * Returns two lists: users who should receive desktop notifications and users who should receive mobile notifications.
 *
 * Priority (highest → lowest):
 * 1. Global pause — if active, user is excluded from both lists entirely.
 * 2. Channel-level settings:
 *    - desktopNotificationLevel filtered by `context`:
 *        'channel_message' → ALL passes.
 *        'mention'         → ALL, MENTIONS_ONLY, or THREADS_ONLY (UI Default) passes.
 *        'thread_reply'    → ALL or THREADS_ONLY (UI Default) passes; MENTIONS_ONLY blocks.
 * 3. Thread subscription state has the lowest priority and is evaluated upstream
 *    (callers should only pass subscribed-thread recipients for 'thread_reply' context).
 *
 * @param userIds     - List of user IDs to filter.
 * @param channelId   - The channel ID (used for fetching channel-specific settings).
 * @param isDMChannel - If true, only global pause applies (notification level is skipped).
 * @param context     - The type of notification being sent. Controls which NotificationLevel values
 *                      allow the notification through. Ignored when isDMChannel is true.
 *                      Use 'thread_mention' when an @mention occurs inside a thread reply.
 *                      Defaults to 'mention'.
 */
export async function filterUsers(
  userIds: string[],
  channelId: string,
  isDMChannel: boolean = false,
  context: NotificationContext = 'mention',
): Promise<{ desktopUsers: string[]; mobileUsers: string[] }> {
  const desktopUsers: string[] = [];
  const mobileUsers: string[] = [];

  if (userIds.length === 0) {
    return { desktopUsers, mobileUsers };
  }

  // Batch fetch all channel-level user settings in a single query
  const channelStatuses = await prisma.channelUserStatus.findMany({
    where: {
      channelId,
      userId: { in: userIds },
    },
    select: {
      userId: true,
      desktopNotificationLevel: true,
      mobileNotificationLevel: true,
    },
  });

  // Batch fetch global pause settings from UserPresence for all users
  const userPresences = await prisma.userPresence.findMany({
    where: {
      userId: { in: userIds },
    },
    select: {
      userId: true,
      notificationsPausedUntil: true,
    },
  });

  // Build lookup maps for O(1) access
  const channelStatusMap = new Map(channelStatuses.map(s => [s.userId, s]));
  const globalPauseMap = new Map(
    userPresences.map(p => [p.userId, p.notificationsPausedUntil]),
  );

  for (const userId of userIds) {
    const channelStatus = channelStatusMap.get(userId);
    const globalPausedUntil = globalPauseMap.get(userId) ?? null;

    // No channel-specific settings found → fall back to the persisted UI defaults.
    if (!channelStatus) {
      const defaultNotificationLevel = isDMChannel
        ? DEFAULT_DM_NOTIFICATION_LEVEL
        : DEFAULT_CHANNEL_NOTIFICATION_LEVEL;
      const result = evaluateNotificationSettings({
        userId,
        desktopNotificationLevel: defaultNotificationLevel,
        mobileNotificationLevel: defaultNotificationLevel,
        globalPausedUntil,
      }, context);
      if (result.shouldNotifyDesktop) desktopUsers.push(userId);
      if (result.shouldNotifyMobile) mobileUsers.push(userId);
      continue;
    }

    // For DM channels: apply global pause + simple NONE check (no context gating)
    if (isDMChannel) {
      const globalPausedTs = parseTimestamp(globalPausedUntil);
      const isGloballyPaused = globalPausedTs !== null && globalPausedTs > Date.now();
      if (isGloballyPaused) {
        continue;
      }

      // In DM channels, check if desktop notifications are enabled (level !== NONE)
      const desktopLevel = channelStatus.desktopNotificationLevel ?? NotificationLevel.ALL;
      const mobileLevel = channelStatus.mobileNotificationLevel ?? desktopLevel; // Fallback to desktop if not set

      // Desktop: notify if level is not NONE
      if (desktopLevel !== NotificationLevel.NONE) {
        desktopUsers.push(userId);
      }

      // Mobile: notify if level is not NONE (respects the mobile override or falls back to desktop)
      if (mobileLevel !== NotificationLevel.NONE) {
        mobileUsers.push(userId);
      }

      continue;
    }

    // For regular channels: apply global pause + notification level (gated by context)
    const settings: UserNotificationSettings = {
      userId,
      desktopNotificationLevel: channelStatus.desktopNotificationLevel ?? DEFAULT_CHANNEL_NOTIFICATION_LEVEL,
      mobileNotificationLevel: channelStatus.mobileNotificationLevel ?? DEFAULT_CHANNEL_NOTIFICATION_LEVEL,
      globalPausedUntil,
    };

    const result = evaluateNotificationSettings(settings, context);
    if (result.shouldNotifyDesktop) desktopUsers.push(userId);
    if (result.shouldNotifyMobile) mobileUsers.push(userId);
  }

  return { desktopUsers, mobileUsers };
}
