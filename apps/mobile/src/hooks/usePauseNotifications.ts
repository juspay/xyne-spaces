import { useCallback, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { useSelf } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import { writeNotificationsPausedUntil } from '@/src/notifications/pausePreference';
import {
  collectPauseUntilCandidates,
  resolveNotificationsPausedUntil,
  type PauseFields,
} from '@/src/utils/pauseNotifications';
import { awaitMutation } from '@/src/zero/awaitMutation';
import { mutators } from '@/src/zero/mutators';

export type PauseNotifications = {
  pausedUntil: number | undefined;
  isPaused: boolean;
  setPausedUntil: (until: number | null) => Promise<void>;
};

export function usePauseNotifications(): PauseNotifications {
  const zero = useZero();
  const user = useSelf() as PauseFields | undefined;
  const [nowTick, setNowTick] = useState(0);

  const pausedUntil = resolveNotificationsPausedUntil(...collectPauseUntilCandidates(user));
  const isPaused = Boolean(pausedUntil);

  useEffect(() => {
    writeNotificationsPausedUntil(pausedUntil ?? null);
  }, [pausedUntil]);

  useEffect(() => {
    if (!pausedUntil) return;
    const remaining = pausedUntil - Date.now();
    if (remaining <= 0) return;
    const timeout = setTimeout(() => setNowTick(tick => tick + 1), Math.min(remaining, 30_000));
    return () => clearTimeout(timeout);
  }, [pausedUntil, nowTick]);

  const setPausedUntil = useCallback(
    async (until: number | null): Promise<void> => {
      await awaitMutation(
        zero.mutate(
          mutators.userPresence.upsert({
            notificationsPausedUntil: until,
            timestamp: Date.now(),
            presenceId: uuidv4(),
          }),
        ),
      );
      writeNotificationsPausedUntil(until);
    },
    [zero],
  );

  return { pausedUntil, isPaused, setPausedUntil };
}
