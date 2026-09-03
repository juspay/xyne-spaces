import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';
import { mixpanelService, EVENTS } from '../services/Analytics/mixpanelService';

export const useThreadBroadcastMentions = (): {
  allowThreadBroadcastMentions: boolean;
  setAllowThreadBroadcastMentions: (value: boolean) => void;
} => {
  const zero = useZero();
  const userPreference = useSelector(stateMachineActor, state => state.context.userPreference);

  const allowThreadBroadcastMentions = userPreference?.allowThreadBroadcastMentions ?? false;

  const setAllowThreadBroadcastMentions = (value: boolean): void => {
    void zero.mutate(
      mutators.userPreference.setAllowThreadBroadcastMentions({
        id: userPreference?.id ?? crypto.randomUUID(),
        allowThreadBroadcastMentions: value,
        timestamp: Date.now(),
      }),
    );
    mixpanelService.track(EVENTS.PREFERENCE_CHANGED, {
      preference: 'allowThreadBroadcastMentions',
      enabled: value,
    });
  };

  return { allowThreadBroadcastMentions, setAllowThreadBroadcastMentions };
};
