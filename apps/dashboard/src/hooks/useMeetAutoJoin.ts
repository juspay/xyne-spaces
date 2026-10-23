import { useSelector } from '@xstate/react';
import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { stateMachineActor } from '../machines/stateMachine';

/** Which of my Google Meet calendar events Xyne Automatic joins by itself. */
export type MeetAutoJoinMode = 'off' | 'organized' | 'all';

/**
 * Synced through `user_preferences.meetAutoJoin` (null = off). The backend worker
 * reads it every minute and sends the bot to matching meetings as they start.
 */
export const useMeetAutoJoin = (): {
  meetAutoJoin: MeetAutoJoinMode;
  setMeetAutoJoin: (mode: MeetAutoJoinMode) => void;
} => {
  const zero = useZero();
  const userPreference = useSelector(stateMachineActor, state => state.context.userPreference);
  const stored = userPreference?.meetAutoJoin;

  const setMeetAutoJoin = (mode: MeetAutoJoinMode): void => {
    void zero.mutate(
      mutators.userPreference.setMeetAutoJoin({
        id: userPreference?.id ?? crypto.randomUUID(),
        meetAutoJoin: mode === 'off' ? null : mode,
        timestamp: Date.now(),
      }),
    );
  };

  return {
    meetAutoJoin: stored === 'organized' || stored === 'all' ? stored : 'off',
    setMeetAutoJoin,
  };
};
