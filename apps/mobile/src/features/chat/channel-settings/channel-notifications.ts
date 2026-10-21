import { NotificationLevel } from '@xyne/shared';

export type ChannelNotificationGlobalDefaults = {
  globalDesktopNotificationLevel: NotificationLevel;
  globalMobileNotificationLevel: NotificationLevel;
  threadReplyNotificationsEnabled: boolean;
  channelWideMentionsEnabled: boolean;
};

export type ChannelNotificationStoredOverrides = {
  desktopNotificationLevel?: string | null;
  mobileNotificationLevel?: string | null;
  threadReplyNotificationsEnabled?: boolean | null;
  channelWideMentionsEnabled?: boolean | null;
};

export function toNotificationLevel(raw: string | null | undefined): NotificationLevel | null {
  if (
    raw === NotificationLevel.ALL ||
    raw === NotificationLevel.MENTIONS_ONLY ||
    raw === NotificationLevel.THREADS_ONLY ||
    raw === NotificationLevel.NONE
  ) {
    return raw;
  }
  return null;
}

/** Channel toggle ON writes inherit (`null`); OFF writes an explicit mute. */
export function nextChannelOverrideLevel(enabled: boolean): NotificationLevel | null {
  return enabled ? null : NotificationLevel.NONE;
}

export type ChannelNotificationViewState = {
  desktopEnabled: boolean;
  mobileEnabled: boolean;
  pickedDesktopLevel: NotificationLevel;
  pickedMobileLevel: NotificationLevel;
  displayedThreadReply: boolean;
  displayedChannelWideMentions: boolean;
  splitDeliveryHint: 'Desktop only' | 'Mobile only' | undefined;
};

export function resolveChannelNotificationViewState(args: {
  isGroupDM: boolean;
  stored: ChannelNotificationStoredOverrides | null;
  global: ChannelNotificationGlobalDefaults;
}): ChannelNotificationViewState {
  const storedDesktopLevel = toNotificationLevel(args.stored?.desktopNotificationLevel);
  const storedMobileLevel = toNotificationLevel(args.stored?.mobileNotificationLevel);
  const storedThreadReply = args.stored?.threadReplyNotificationsEnabled ?? null;
  const storedChannelWideMentions = args.stored?.channelWideMentionsEnabled ?? null;

  const desktopEnabled = storedDesktopLevel !== NotificationLevel.NONE;
  const mobileEnabled = storedMobileLevel !== NotificationLevel.NONE;

  const inheritDesktopLevel = args.isGroupDM
    ? NotificationLevel.ALL
    : args.global.globalDesktopNotificationLevel;
  const inheritMobileLevel = args.isGroupDM
    ? NotificationLevel.ALL
    : args.global.globalMobileNotificationLevel;

  const pickedDesktopLevel =
    storedDesktopLevel && storedDesktopLevel !== NotificationLevel.NONE
      ? storedDesktopLevel
      : inheritDesktopLevel;
  const pickedMobileLevel =
    storedMobileLevel && storedMobileLevel !== NotificationLevel.NONE
      ? storedMobileLevel
      : inheritMobileLevel;

  const effectiveThreadReply =
    storedThreadReply !== null ? storedThreadReply : args.global.threadReplyNotificationsEnabled;
  const effectiveChannelWideMentions =
    storedChannelWideMentions !== null
      ? storedChannelWideMentions
      : args.global.channelWideMentionsEnabled;

  const hasAnyDeliveryEnabled = desktopEnabled || mobileEnabled;

  return {
    desktopEnabled,
    mobileEnabled,
    pickedDesktopLevel,
    pickedMobileLevel,
    displayedThreadReply: hasAnyDeliveryEnabled && effectiveThreadReply,
    displayedChannelWideMentions: hasAnyDeliveryEnabled && effectiveChannelWideMentions,
    splitDeliveryHint:
      desktopEnabled !== mobileEnabled
        ? desktopEnabled
          ? 'Desktop only'
          : 'Mobile only'
        : undefined,
  };
}
