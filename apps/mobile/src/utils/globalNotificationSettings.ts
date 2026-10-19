import { NotificationLevel } from '@xyne/shared';

export type GlobalNotificationSettingsUpdate = {
  globalDesktopNotificationLevel?: NotificationLevel;
  globalMobileNotificationLevel?: NotificationLevel;
  threadReplyNotificationsEnabled?: boolean;
  channelWideMentionsEnabled?: boolean;
};

export type GlobalNotificationSettingsValues = {
  globalDesktopNotificationLevel: NotificationLevel;
  globalMobileNotificationLevel: NotificationLevel;
  threadReplyNotificationsEnabled: boolean;
  channelWideMentionsEnabled: boolean;
};

export type GlobalNotificationPreferenceRow = {
  globalDesktopNotificationLevel?: NotificationLevel | null;
  globalMobileNotificationLevel?: NotificationLevel | null;
  threadReplyNotificationsEnabled?: boolean | null;
  channelWideMentionsEnabled?: boolean | null;
};

export const hasGlobalNotificationSettingsCaughtUp = (
  pending: GlobalNotificationSettingsUpdate,
  row: GlobalNotificationPreferenceRow,
): boolean =>
  (pending.globalDesktopNotificationLevel === undefined ||
    row.globalDesktopNotificationLevel === pending.globalDesktopNotificationLevel) &&
  (pending.globalMobileNotificationLevel === undefined ||
    row.globalMobileNotificationLevel === pending.globalMobileNotificationLevel) &&
  (pending.threadReplyNotificationsEnabled === undefined ||
    row.threadReplyNotificationsEnabled === pending.threadReplyNotificationsEnabled) &&
  (pending.channelWideMentionsEnabled === undefined ||
    row.channelWideMentionsEnabled === pending.channelWideMentionsEnabled);

export function resolveDisplayedGlobalNotificationSettings(
  row: GlobalNotificationPreferenceRow | null | undefined,
  pending: GlobalNotificationSettingsUpdate | null,
): GlobalNotificationSettingsValues {
  return {
    globalDesktopNotificationLevel:
      pending?.globalDesktopNotificationLevel ??
      row?.globalDesktopNotificationLevel ??
      NotificationLevel.MENTIONS_ONLY,
    globalMobileNotificationLevel:
      pending?.globalMobileNotificationLevel ??
      row?.globalMobileNotificationLevel ??
      NotificationLevel.MENTIONS_ONLY,
    threadReplyNotificationsEnabled:
      pending?.threadReplyNotificationsEnabled ?? row?.threadReplyNotificationsEnabled ?? true,
    channelWideMentionsEnabled:
      pending?.channelWideMentionsEnabled ?? row?.channelWideMentionsEnabled ?? true,
  };
}
