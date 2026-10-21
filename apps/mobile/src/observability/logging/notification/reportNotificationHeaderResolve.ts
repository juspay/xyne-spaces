import { ReactNativeStartupClock } from '../startup/reactNativeColdStart';
import {
  getPendingNotificationHeaderResolveTarget,
  observeNotificationHeaderResolve,
  type NotificationHeaderTitleStatus,
} from './notificationHeaderResolve';

const clock = new ReactNativeStartupClock();

export function reportNotificationHeaderResolve(input: {
  channelId: string;
  headerStatus: NotificationHeaderTitleStatus;
  channelPresentInVisibleChannels: boolean;
  visibleChannelListPublished: boolean;
  userDirectoryPublished: boolean;
  scopeType: string | null;
}): void {
  const target = getPendingNotificationHeaderResolveTarget();
  if (target === null || target.channelId !== input.channelId) {
    return;
  }

  void clock.nowUptimeMs().then(now => {
    if (now === null) {
      return;
    }

    const current = getPendingNotificationHeaderResolveTarget();
    if (current === null || current.channelId !== input.channelId) {
      return;
    }

    observeNotificationHeaderResolve({
      ...input,
      atUptimeMs: now,
    });
  });
}
