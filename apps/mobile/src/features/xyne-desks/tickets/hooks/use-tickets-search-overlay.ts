import { useCallback, useState } from 'react';
import {
  Easing,
  runOnJS,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { TICKETS_SEARCH_MORPH_MS } from '../constants';

const EASE = Easing.bezier(0.2, 0.9, 0.2, 1);

export type UseTicketsSearchOverlayReturn = {
  /** Mount overlay while open or closing (keeps exit animation). */
  isMounted: boolean;
  /** JS mirror of open state for focus / a11y. */
  isOpen: boolean;
  progress: SharedValue<number>;
  open: () => void;
  close: () => void;
};

export function useTicketsSearchOverlay(): UseTicketsSearchOverlayReturn {
  const progress = useSharedValue(0);
  const [isMounted, setIsMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    setIsMounted(true);
    setIsOpen(true);
    progress.value = withTiming(1, { duration: TICKETS_SEARCH_MORPH_MS, easing: EASE });
  }, [progress]);

  const close = useCallback(() => {
    setIsOpen(false);
    progress.value = withTiming(
      0,
      { duration: TICKETS_SEARCH_MORPH_MS, easing: EASE },
      finished => {
        if (finished) runOnJS(setIsMounted)(false);
      },
    );
  }, [progress]);

  return { isMounted, isOpen, progress, open, close };
}
