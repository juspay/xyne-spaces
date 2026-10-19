import { useCallback, useState } from 'react';
import { cancelAnimation, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { TICKETS_DRAWER_SPRING } from '../constants';

export function useTicketsMailboxDrawer() {
  const progress = useSharedValue(0);
  const [isMounted, setIsMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    setIsMounted(true);
    setIsOpen(true);
    cancelAnimation(progress);
    progress.value = withSpring(1, TICKETS_DRAWER_SPRING);
  }, [progress]);

  const close = useCallback(() => {
    setIsOpen(false);
    cancelAnimation(progress);
    progress.value = withSpring(0, TICKETS_DRAWER_SPRING, finished => {
      if (finished) scheduleOnRN(setIsMounted, false);
    });
  }, [progress]);

  return { isMounted, isOpen, progress, open, close };
}
