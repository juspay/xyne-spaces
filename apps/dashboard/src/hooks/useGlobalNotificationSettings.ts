import { useSelector } from '@xstate/react';
import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { stateMachineActor } from '../machines/stateMachine';
import { NotificationLevel, MobileRoutingMode } from '@xyne/shared';

export interface GlobalNotificationSettings {
  globalDesktopNotificationLevel: NotificationLevel;
  globalMobileNotificationLevel: NotificationLevel;
  threadReplyNotificationsEnabled: boolean;
  channelWideMentionsEnabled: boolean;
  mobileRoutingMode: MobileRoutingMode;
  desktopInactivityThresholdMinutes: number;
  update: (fields: {
    globalDesktopNotificationLevel?: NotificationLevel;
    globalMobileNotificationLevel?: NotificationLevel;
    threadReplyNotificationsEnabled?: boolean;
    channelWideMentionsEnabled?: boolean;
    mobileRoutingMode?: MobileRoutingMode;
    desktopInactivityThresholdMinutes?: number;
  }) => void;
}

export const useGlobalNotificationSettings = (): GlobalNotificationSettings => {
  const zero = useZero();
  const userPreference = useSelector(stateMachineActor, state => state.context.userPreference);

  const globalDesktopNotificationLevel =
    userPreference?.globalDesktopNotificationLevel ?? NotificationLevel.MENTIONS_ONLY;
  const globalMobileNotificationLevel =
    userPreference?.globalMobileNotificationLevel ?? NotificationLevel.MENTIONS_ONLY;
  const threadReplyNotificationsEnabled = userPreference?.threadReplyNotificationsEnabled ?? true;
  const channelWideMentionsEnabled = userPreference?.channelWideMentionsEnabled ?? true;
  const mobileRoutingMode =
    userPreference?.mobileRoutingMode ?? MobileRoutingMode.WHEN_DESKTOP_INACTIVE;
  const desktopInactivityThresholdMinutes =
    userPreference?.desktopInactivityThresholdMinutes ?? 5;

  const update = (fields: {
    globalDesktopNotificationLevel?: NotificationLevel;
    globalMobileNotificationLevel?: NotificationLevel;
    threadReplyNotificationsEnabled?: boolean;
    channelWideMentionsEnabled?: boolean;
    mobileRoutingMode?: MobileRoutingMode;
    desktopInactivityThresholdMinutes?: number;
  }): void => {
    const {
      mobileRoutingMode: newMode,
      desktopInactivityThresholdMinutes: newThreshold,
      ...globalFields
    } = fields;
    if (
      newMode !== undefined ||
      newThreshold !== undefined ||
      Object.keys(globalFields).length > 0
    ) {
      void zero.mutate(
        mutators.userPreference.setGlobalNotificationSettings({
          id: userPreference?.id ?? crypto.randomUUID(),
          ...globalFields,
          timestamp: Date.now(),
        }),
      );
    }
    if (newMode !== undefined || newThreshold !== undefined) {
      void zero.mutate(
        mutators.userPreference.setMobileRoutingPreference({
          id: userPreference?.id ?? crypto.randomUUID(),
          ...(newMode !== undefined && { mobileRoutingMode: newMode }),
          ...(newThreshold !== undefined && {
            desktopInactivityThresholdMinutes: newThreshold,
          }),
          timestamp: Date.now(),
        }),
      );
    }
  };

  return {
    globalDesktopNotificationLevel,
    globalMobileNotificationLevel,
    threadReplyNotificationsEnabled,
    channelWideMentionsEnabled,
    mobileRoutingMode,
    desktopInactivityThresholdMinutes,
    update,
  };
};
