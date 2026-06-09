import { useSelector } from '@xstate/react';
import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { stateMachineActor } from '../machines/stateMachine';
import { NotificationLevel } from '@xyne/shared';

export interface GlobalNotificationSettings {
  globalDesktopNotificationLevel: NotificationLevel;
  globalMobileNotificationLevel: NotificationLevel;
  threadReplyNotificationsEnabled: boolean;
  channelWideMentionsEnabled: boolean;
  update: (fields: {
    globalDesktopNotificationLevel?: NotificationLevel;
    globalMobileNotificationLevel?: NotificationLevel;
    threadReplyNotificationsEnabled?: boolean;
    channelWideMentionsEnabled?: boolean;
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

  const update = (fields: {
    globalDesktopNotificationLevel?: NotificationLevel;
    globalMobileNotificationLevel?: NotificationLevel;
    threadReplyNotificationsEnabled?: boolean;
    channelWideMentionsEnabled?: boolean;
  }): void => {
    void zero.mutate(
      mutators.userPreference.setGlobalNotificationSettings({
        id: userPreference?.id ?? crypto.randomUUID(),
        ...fields,
        timestamp: Date.now(),
      }),
    );
  };

  return {
    globalDesktopNotificationLevel,
    globalMobileNotificationLevel,
    threadReplyNotificationsEnabled,
    channelWideMentionsEnabled,
    update,
  };
};
