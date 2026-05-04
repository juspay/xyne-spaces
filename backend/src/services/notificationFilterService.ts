import { DatabaseClient } from '@/database/client';
import { NotificationLevel } from '@prisma/client';

const prisma = DatabaseClient.getInstance();

/**
 * The type of notification being delivered, used to gate which NotificationLevel
 * values allow the notification through in Layer 3 of the evaluation.
 *
 * - 'channel_message' → passes only for ALL
 * - 'mention'         → passes for ALL and MENTIONS_ONLY; blocked by THREADS_ONLY
 * - 'thread_reply'    → passes for ALL and THREADS_ONLY; blocked by MENTIONS_ONLY
 * - 'thread_mention'  → passes for ALL, MENTIONS_ONLY, and THREADS_ONLY (a direct @mention
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
 *   MENTIONS_ONLY – only explicit @mentions pass; thread replies are suppressed even if subscribed
 *   THREADS_ONLY  – only thread replies the user is subscribed to pass; standalone mentions are suppressed
 */
function isLevelAllowed(level: NotificationLevel, context: NotificationContext): boolean {
  switch (context) {
    case 'channel_message':
      // Top-level channel posts should only notify users explicitly set to ALL.
      return level === NotificationLevel.ALL;
    case 'mention':
      // Mentions pass for ALL and MENTIONS_ONLY; THREADS_ONLY blocks them
      return level === NotificationLevel.ALL || level === NotificationLevel.MENTIONS_ONLY;
    case 'thread_reply':
      // Thread replies pass for ALL and THREADS_ONLY; MENTIONS_ONLY blocks them
      return level === NotificationLevel.ALL || level === NotificationLevel.THREADS_ONLY;
    case 'thread_mention':
      // A direct @mention inside a thread is relevant to both mention and thread subscribers.
      // It passes for ALL, MENTIONS_ONLY, and THREADS_ONLY.
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
 * 1. Global pause (UserPresence.notificationsPausedUntil) — suppresses ALL notifications if active;
 *    user receives nothing on any device while paused.
 * 2. Per-device notification level filtered by notification context:
 *    - 'channel_message': ALL passes.
 *    - 'mention':         ALL or MENTIONS_ONLY passes; THREADS_ONLY blocks.
 *    - 'thread_reply':    ALL or THREADS_ONLY passes; MENTIONS_ONLY blocks (even for subscribed threads).
 *    - 'thread_mention':  ALL, MENTIONS_ONLY, or THREADS_ONLY passes.
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
 *        'mention'         → ALL or MENTIONS_ONLY passes; THREADS_ONLY blocks.
 *        'thread_reply'    → ALL or THREADS_ONLY passes; MENTIONS_ONLY blocks (even for subscribed threads).
 * 3. Thread subscription state has the lowest priority and is evaluated upstream
 *    (callers should only pass subscribed-thread recipients for 'thread_reply' context).
 *
 * @param userIds     - List of user IDs to filter.
 * @param channelId   - The channel ID (used for fetching channel-specific settings).
 * @param isDMChannel - If true, only global pause applies (notification level is skipped).
 * @param context     - The type of notification being sent. Controls which NotificationLevel values
 *                      allow the notification through. Ignored when isDMChannel is true.
 *                      Use 'thread_mention' when an @mention occurs inside a thread reply so that
 *                      users with THREADS_ONLY are also notified. Defaults to 'mention'.
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

    // No channel-specific settings found → default to allowing all, but still check global pause
    if (!channelStatus) {
      const globalPausedTs = parseTimestamp(globalPausedUntil);
      const isGloballyPaused = globalPausedTs !== null && globalPausedTs > Date.now();
      if (!isGloballyPaused) {
        desktopUsers.push(userId);
        mobileUsers.push(userId);
      }
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
      desktopNotificationLevel: channelStatus.desktopNotificationLevel ?? NotificationLevel.MENTIONS_ONLY,
      mobileNotificationLevel: channelStatus.mobileNotificationLevel ?? NotificationLevel.MENTIONS_ONLY,
      globalPausedUntil,
    };

    const result = evaluateNotificationSettings(settings, context);
    if (result.shouldNotifyDesktop) desktopUsers.push(userId);
    if (result.shouldNotifyMobile) mobileUsers.push(userId);
  }

  return { desktopUsers, mobileUsers };
}
