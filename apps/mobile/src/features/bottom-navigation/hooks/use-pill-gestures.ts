import { useCallback, useMemo } from 'react';
import { Gesture, type ComposedGesture } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { haptics } from '@/src/utils/haptics';

import {
  MAX_SWITCHABLE_TAB,
  MENU_DRAG_THRESHOLD,
  MENU_TAB_INDEX,
  PILL_HEIGHT,
  PILL_WIDTH,
  SPRING_BOUNCY,
  TAB_ZONE_WIDTH,
  TABS_END,
  TABS_START,
  menuItemAtY,
} from '../constants';
import type { ActiveTab } from './use-active-tab';

function detectAnyTab(x: number): number {
  'worklet';
  if (x >= TABS_START && x < TABS_END) {
    return Math.min(MENU_TAB_INDEX, Math.floor((x - TABS_START) / TAB_ZONE_WIDTH));
  }
  return -1;
}

type PillGestures = {
  pillPressed: SharedValue<number>;
  overflowX: SharedValue<number>;
  overflowY: SharedValue<number>;
  touchX: SharedValue<number>;
  touchY: SharedValue<number>;
  glowProgress: SharedValue<number>;
  panGesture: ComposedGesture;
};

export function usePillGestures(
  { hoveredTab, commitTab, releaseHover }: ActiveTab,
  searchProgress: SharedValue<number>,
  menuProgress: SharedValue<number>,
  toggleMenu: () => void,
  hoveredMenuItem: SharedValue<number>,
  commitMenuItem: (index: number) => void,
  menuItemCount: number,
): PillGestures {
  const pillPressed = useSharedValue(0);
  const overflowX = useSharedValue(0);
  const overflowY = useSharedValue(0);
  const touchX = useSharedValue(PILL_WIDTH / 2);
  const touchY = useSharedValue(PILL_HEIGHT / 2);
  const glowProgress = useSharedValue(0);
  const menuTriggeredByDrag = useSharedValue(false);

  const triggerHaptic = useCallback(() => {
    void haptics.buttonTap();
  }, []);

  const panGesture = useMemo(() => {
    /**
     * Runs however the touch ends — completed, failed or cancelled — so a
     * dropped `onEnd` can never leave the pill pressed or a tab highlighted.
     * It only clears press state; the active tab is `commitTab`'s to move.
     */
    const settle = (): void => {
      'worklet';
      menuTriggeredByDrag.set(false);
      pillPressed.set(withTiming(0, { duration: 150 }));
      glowProgress.set(withTiming(2, { duration: 300 }));
      overflowX.set(withSpring(0, SPRING_BOUNCY));
      overflowY.set(withSpring(0, SPRING_BOUNCY));
      releaseHover();
      // `onEnd` has already read and acted on this; clearing here covers the
      // touches that are cancelled instead of ended.
      hoveredMenuItem.set(-1);
    };

    const longPress = Gesture.LongPress()
      .minDuration(0)
      .onStart(event => {
        cancelAnimation(overflowX);
        cancelAnimation(overflowY);
        cancelAnimation(glowProgress);
        touchX.set(event.x);
        touchY.set(event.y);
        pillPressed.set(withTiming(1, { duration: 80 }));
        glowProgress.set(1);
        if (searchProgress.get() < 0.5) hoveredTab.set(detectAnyTab(event.x));
      })
      .onFinalize(settle);

    const pan = Gesture.Pan()
      .minDistance(10)
      .onStart(event => {
        cancelAnimation(overflowX);
        cancelAnimation(overflowY);
        cancelAnimation(glowProgress);
        touchX.set(event.x);
        touchY.set(event.y);
        pillPressed.set(withTiming(1, { duration: 80 }));
        glowProgress.set(1);
      })
      .onUpdate(event => {
        touchX.set(event.x);
        touchY.set(event.y);

        const nextOverflowX =
          event.x < 0 ? event.x : event.x > PILL_WIDTH ? event.x - PILL_WIDTH : 0;
        const nextOverflowY =
          event.y < 0 ? event.y : event.y > PILL_HEIGHT ? event.y - PILL_HEIGHT : 0;
        overflowX.set(nextOverflowX);
        overflowY.set(nextOverflowY);

        if (searchProgress.get() >= 0.5) return;

        if (
          nextOverflowY < MENU_DRAG_THRESHOLD &&
          !menuTriggeredByDrag.get() &&
          menuProgress.get() < 0.5
        ) {
          menuTriggeredByDrag.set(true);
          hoveredTab.set(-1);
          scheduleOnRN(toggleMenu);
          scheduleOnRN(triggerHaptic);
          overflowX.set(withSpring(0, SPRING_BOUNCY));
          overflowY.set(withSpring(0, SPRING_BOUNCY));
          pillPressed.set(withTiming(0, { duration: 150 }));
          return;
        }

        // A drag that opened the menu keeps steering it. Waiting for the open
        // spring to settle keeps the highlight off the rows while the panel is
        // still growing and the coordinate space is still moving.
        if (menuProgress.get() > 0.9) {
          const nextItem = menuItemAtY(event.x, event.y, menuItemCount);
          if (nextItem !== hoveredMenuItem.get()) {
            hoveredMenuItem.set(nextItem);
            if (nextItem >= 0) scheduleOnRN(triggerHaptic);
          }
          return;
        }

        if (menuTriggeredByDrag.get()) return;

        if (nextOverflowX === 0 && nextOverflowY === 0) {
          const nextTab = detectAnyTab(event.x);
          if (nextTab !== hoveredTab.get()) {
            hoveredTab.set(nextTab);
            scheduleOnRN(triggerHaptic);
          }
          return;
        }

        if (hoveredTab.get() !== -1) hoveredTab.set(-1);
      })
      .onEnd(() => {
        if (menuProgress.get() > 0.5) {
          const item = hoveredMenuItem.get();
          if (item >= 0) {
            scheduleOnRN(commitMenuItem, item);
            scheduleOnRN(triggerHaptic);
          }
          return;
        }

        if (menuTriggeredByDrag.get() || searchProgress.get() >= 0.5) return;

        const target = hoveredTab.get();
        if (target >= 0 && target <= MAX_SWITCHABLE_TAB) {
          commitTab(target);
          scheduleOnRN(triggerHaptic);
          return;
        }

        if (target === MENU_TAB_INDEX) {
          scheduleOnRN(toggleMenu);
          scheduleOnRN(triggerHaptic);
        }
      })
      .onFinalize(settle);

    return Gesture.Simultaneous(longPress, pan);
  }, [
    commitTab,
    glowProgress,
    hoveredTab,
    menuProgress,
    menuTriggeredByDrag,
    overflowX,
    overflowY,
    pillPressed,
    releaseHover,
    searchProgress,
    toggleMenu,
    touchX,
    touchY,
    triggerHaptic,
    commitMenuItem,
    hoveredMenuItem,
    menuItemCount,
  ]);

  return {
    pillPressed,
    overflowX,
    overflowY,
    touchX,
    touchY,
    glowProgress,
    panGesture,
  };
}
