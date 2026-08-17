import { useSelector } from '@xstate/react';
import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { stateMachineActor } from '../machines/stateMachine';

/**
 * Whether to render thread classification chips in chat.
 *
 * Opt-in: tags are auto-applied by the classifier, so defaulting them on would put a chip
 * on every thread for people who never asked for them.
 */
export const useShowThreadTags = (): {
  showThreadTags: boolean;
  setShowThreadTags: (value: boolean) => void;
} => {
  const zero = useZero();
  const userPreference = useSelector(stateMachineActor, state => state.context.userPreference);

  const showThreadTags = userPreference?.showThreadTags ?? false;

  const setShowThreadTags = (value: boolean): void => {
    void zero.mutate(
      mutators.userPreference.setShowThreadTags({
        id: userPreference?.id ?? crypto.randomUUID(),
        showThreadTags: value,
        timestamp: Date.now(),
      }),
    );
  };

  return { showThreadTags, setShowThreadTags };
};
