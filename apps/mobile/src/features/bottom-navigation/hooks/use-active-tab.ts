import { useCallback, useEffect } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useLatest } from './use-latest';

export type ActiveTab = {
  activeTab: SharedValue<number>;
  hoveredTab: SharedValue<number>;
  /** Worklet. Moves the highlight to `index` and navigates there. */
  commitTab: (index: number) => void;
  /** Worklet. Drops the press highlight, leaving the active tab alone. */
  releaseHover: () => void;
};

/**
 * Owns which tab reads as active. The value lives on the UI thread so a tap can
 * move the highlight on the frame the finger lifts, instead of waiting for React
 * to commit behind the mount of the screen being navigated to.
 */
export function useActiveTab(
  activeIndex: number,
  onTabChange: (index: number) => void,
  /**
   * Per pill, whether tapping it switches tab.
   *
   * Canvas, Recordings and Report issue can be dragged into the pills, and
   * those push a screen instead — the tab underneath does not change. Moving
   * the highlight for them was a promise navigation never kept: `activeIndex`
   * stayed put, so the effect below never re-ran to correct it and the pill
   * stayed lit over a screen the user was no longer on.
   */
  switchesTab: readonly boolean[],
): ActiveTab {
  const activeTab = useSharedValue(activeIndex);
  const hoveredTab = useSharedValue(-1);
  const requestedTab = useSharedValue(-1);
  const onTabChangeRef = useLatest(onTabChange);

  // Navigation is the source of truth. A committed tap sets the same index
  // optimistically, so by the time this lands the value already agrees; when
  // navigation goes somewhere else, it still wins.
  useEffect(() => {
    activeTab.set(activeIndex);
  }, [activeIndex, activeTab]);

  const navigateToRequestedTab = useCallback(() => {
    const index = requestedTab.get();
    if (index < 0) return;
    requestedTab.set(-1);
    onTabChangeRef.current(index);
  }, [onTabChangeRef, requestedTab]);

  const commitTab = useCallback(
    (index: number) => {
      'worklet';
      // Both writes land in the same frame, so the highlight is never handed
      // over through a frame where neither tab is lit. Skipped entirely for a
      // pill that only pushes: there is no handover, so an optimistic move
      // would be a lie nothing later corrects.
      if (switchesTab[index] === true) activeTab.set(index);
      hoveredTab.set(-1);
      requestedTab.set(index);
      scheduleOnRN(navigateToRequestedTab);
    },
    [activeTab, hoveredTab, navigateToRequestedTab, requestedTab, switchesTab],
  );

  const releaseHover = useCallback(() => {
    'worklet';
    hoveredTab.set(-1);
  }, [hoveredTab]);

  return { activeTab, hoveredTab, commitTab, releaseHover };
}
