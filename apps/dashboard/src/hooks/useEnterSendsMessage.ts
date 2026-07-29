import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';

export const useEnterSendsMessage = (): {
  enterSendsMessage: boolean;
  setEnterSendsMessage: (value: boolean) => void;
} => {
  const zero = useZero();
  const userPreference = useSelector(stateMachineActor, state => state.context.userPreference);

  // Default true: Enter sends, Shift+Enter = new line
  const enterSendsMessage = userPreference?.enterSendsMessage ?? true;

  const setEnterSendsMessage = (value: boolean): void => {
    void zero.mutate(
      mutators.userPreference.setEnterSendsMessage({
        id: userPreference?.id ?? crypto.randomUUID(),
        enterSendsMessage: value,
        timestamp: Date.now(),
      }),
    );
  };

  return { enterSendsMessage, setEnterSendsMessage };
};
