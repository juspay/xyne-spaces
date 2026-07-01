import { NotificationLevel } from '@prisma/client';

export const USER_PREFERENCE_NOTIFICATION_DEFAULTS: {
  globalDesktopNotificationLevel: NotificationLevel;
  globalMobileNotificationLevel: NotificationLevel;
  threadReplyNotificationsEnabled: boolean;
  channelWideMentionsEnabled: boolean;
} = {
  globalDesktopNotificationLevel: NotificationLevel.MENTIONS_ONLY,
  globalMobileNotificationLevel: NotificationLevel.MENTIONS_ONLY,
  threadReplyNotificationsEnabled: true,
  channelWideMentionsEnabled: true,
};
