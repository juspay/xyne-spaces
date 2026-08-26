import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';

export type SummaryModelPreference = 'fast' | 'thinking';

export const useSummaryModelPreference = (): {
  summaryModelPreference: SummaryModelPreference;
  setSummaryModelPreference: (value: SummaryModelPreference) => void;
} => {
  const zero = useZero();
  const userPreference = useSelector(stateMachineActor, state => state.context.userPreference);

  // Default 'fast': the cheaper/faster model is used for all users unless they opt in.
  const summaryModelPreference: SummaryModelPreference =
    userPreference?.summaryModelPreference === 'thinking' ? 'thinking' : 'fast';

  const setSummaryModelPreference = (value: SummaryModelPreference): void => {
    void zero.mutate(
      mutators.userPreference.setSummaryModelPreference({
        id: userPreference?.id ?? crypto.randomUUID(),
        summaryModelPreference: value,
        timestamp: Date.now(),
      }),
    );
  };

  return { summaryModelPreference, setSummaryModelPreference };
};
