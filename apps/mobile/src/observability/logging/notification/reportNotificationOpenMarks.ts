import { ReactNativeStartupClock } from '../startup/reactNativeColdStart';
import {
  bufferNotificationOpenMark,
  getPendingNotificationOpenTarget,
  markNotificationChatSkeletonShown,
  markNotificationMessageHighlighted,
  markNotificationPhase,
  type NotificationOpenTarget,
} from './notificationOpen';

const clock = new ReactNativeStartupClock();

type TargetMatch = Readonly<{
  channelId?: string;
  messageId?: string;
}>;

function matchesPendingTarget(
  target: NotificationOpenTarget,
  match: TargetMatch | undefined,
): boolean {
  if (match?.channelId !== undefined && match.channelId !== target.channelId) {
    return false;
  }

  if (
    match?.messageId !== undefined &&
    target.messageId !== undefined &&
    match.messageId !== target.messageId
  ) {
    return false;
  }

  return true;
}

function withNow(
  match: TargetMatch | undefined,
  kind: 'skeleton' | 'list_ready' | 'highlighted',
  apply: (now: number) => void,
): void {
  const target = getPendingNotificationOpenTarget();
  if (target !== null && !matchesPendingTarget(target, match)) {
    return;
  }

  void clock.nowUptimeMs().then(now => {
    if (now === null) {
      return;
    }

    const current = getPendingNotificationOpenTarget();
    if (current !== null) {
      if (!matchesPendingTarget(current, match)) {
        return;
      }

      apply(now);
      return;
    }

    bufferNotificationOpenMark({
      kind,
      atUptimeMs: now,
      ...(match?.channelId ? { channelId: match.channelId } : {}),
      ...(match?.messageId ? { messageId: match.messageId } : {}),
    });
  });
}

export function reportNotificationChatSkeletonShown(match?: TargetMatch): void {
  withNow(match, 'skeleton', now => {
    markNotificationChatSkeletonShown(now);
  });
}

export function reportNotificationListReady(match?: TargetMatch): void {
  withNow(match, 'list_ready', now => {
    markNotificationPhase('list_ready', now);
  });
}

export function reportNotificationMessageHighlighted(match?: TargetMatch): void {
  withNow(match, 'highlighted', now => {
    markNotificationMessageHighlighted(now);
  });
}
