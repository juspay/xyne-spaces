import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { mutators } from '@/src/zero/mutators';

import { useZero } from './useZero';

export function useClearOwnStatus(): () => void {
  const zero = useZero();

  return useCallback((): void => {
    zero.mutate(
      mutators.userPresence.upsert({
        statusEmoji: null,
        statusContent: null,
        statusExpiryAt: null,
        timestamp: Date.now(),
        presenceId: uuidv4(),
      }),
    );
  }, [zero]);
}
