import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';

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
  };

  return { allowThreadBroadcastMentions, setAllowThreadBroadcastMentions };
};
