import { useCallback, useMemo } from 'react';
import { Gesture, type ComposedGesture } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { haptics } from '@/src/utils/haptics';

import {
  DRAG_SELECTOR_LINGER_MS,
  MAX_SWITCHABLE_TAB,
  MENU_DRAG_THRESHOLD,
  MENU_TAB_INDEX,
  PILL_HEIGHT,
  PILL_WIDTH,
  SPRING_BOUNCY,
  SPRING_DRAG_SELECTOR,
  TAB_ZONE_WIDTH,
  TABS_END,
  TABS_START,
  clampToTabCenters,
  menuItemAtY,
  tabCenterX,
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
  dragSelector: DragSelector;
  panGesture: ComposedGesture;
};

/**
 * The highlight a horizontal drag carries, as Telegram's tab bar draws it.
 *
 * While it shows, the tabs' own highlights stand down and this one is drawn at
 * `x + offset`. `x` is the finger, held between the first and last tab
 * centres; `offset` starts as the gap back to the tab that was lit and springs
 * to zero, so the highlight glides from that tab to the finger and then
 * tracks it. On release `x` springs to the tab chosen, and the tabs take back
 * over once it has landed.
 */
export type DragSelector = {
  /** 1 while the drag highlight is drawn, 0 when the tabs draw their own. */
  visible: SharedValue<number>;
  x: SharedValue<number>;
  offset: SharedValue<number>;
};

export function usePillGestures(
  { activeTab, hoveredTab, commitTab, releaseHover }: ActiveTab,
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
  const menuTriggeredByDrag = useSharedValue(false);
  const selectorVisible = useSharedValue(0);
  const selectorX = useSharedValue(tabCenterX(0));
  const selectorOffset = useSharedValue(0);

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
      overflowX.set(withSpring(0, SPRING_BOUNCY));
      overflowY.set(withSpring(0, SPRING_BOUNCY));
      releaseHover();
      // `onEnd` has already read and acted on this; clearing here covers the
      // touches that are cancelled instead of ended.
      hoveredMenuItem.set(-1);
    };

    /** Hands the highlight back to the tabs at once — the menu or search took over. */
    const dropSelector = (): void => {
      'worklet';
      cancelAnimation(selectorX);
      cancelAnimation(selectorOffset);
      selectorVisible.set(0);
    };

    /**
     * Lands the drag highlight on the tab now lit, then lets the tabs take over.
     * Read after any commit, so a pill that only pushes a screen — and leaves
     * the active tab where it was — lands back on that tab.
     */
    const landSelector = (): void => {
      'worklet';
      if (selectorVisible.get() === 0) return;
      selectorOffset.set(withSpring(0, SPRING_DRAG_SELECTOR));
      selectorX.set(withSpring(tabCenterX(activeTab.get()), SPRING_DRAG_SELECTOR));
      selectorVisible.set(withDelay(DRAG_SELECTOR_LINGER_MS, withTiming(0, { duration: 0 })));
    };

    const longPress = Gesture.LongPress()
      .minDuration(0)
      .onStart(event => {
        cancelAnimation(overflowX);
        cancelAnimation(overflowY);
        pillPressed.set(withTiming(1, { duration: 80 }));
        if (searchProgress.get() < 0.5) hoveredTab.set(detectAnyTab(event.x));
      })
      .onFinalize(settle);

    const pan = Gesture.Pan()
      .minDistance(10)
      .onStart(event => {
        cancelAnimation(overflowX);
        cancelAnimation(overflowY);
        pillPressed.set(withTiming(1, { duration: 80 }));

        if (searchProgress.get() >= 0.5 || menuProgress.get() > 0.01) return;
        // Starts on the tab that was lit and glides to the finger.
        const lit = hoveredTab.get() !== -1 ? hoveredTab.get() : activeTab.get();
        const x = clampToTabCenters(event.x);
        cancelAnimation(selectorX);
        selectorX.set(x);
        selectorOffset.set(tabCenterX(lit) - x);
        selectorOffset.set(withSpring(0, SPRING_DRAG_SELECTOR));
        cancelAnimation(selectorVisible);
        selectorVisible.set(1);
      })
      .onUpdate(event => {
        const nextOverflowX =
          event.x < 0 ? event.x : event.x > PILL_WIDTH ? event.x - PILL_WIDTH : 0;
        const nextOverflowY =
          event.y < 0 ? event.y : event.y > PILL_HEIGHT ? event.y - PILL_HEIGHT : 0;
        overflowX.set(nextOverflowX);
        overflowY.set(nextOverflowY);

        if (searchProgress.get() >= 0.5) return;

        if (selectorVisible.get() === 1 && !menuTriggeredByDrag.get()) {
          selectorX.set(clampToTabCenters(event.x));
        }

        if (
          nextOverflowY < MENU_DRAG_THRESHOLD &&
          !menuTriggeredByDrag.get() &&
          menuProgress.get() < 0.5
        ) {
          menuTriggeredByDrag.set(true);
          hoveredTab.set(-1);
          dropSelector();
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
          landSelector();
          scheduleOnRN(triggerHaptic);
          return;
        }

        if (target === MENU_TAB_INDEX) {
          dropSelector();
          scheduleOnRN(toggleMenu);
          scheduleOnRN(triggerHaptic);
        }
      })
      .onFinalize(() => {
        // Released off the pill, or cancelled: back to the tab that is lit.
        landSelector();
        settle();
      });

    return Gesture.Simultaneous(longPress, pan);
  }, [
    activeTab,
    selectorOffset,
    selectorVisible,
    selectorX,
    commitTab,
    hoveredTab,
    menuProgress,
    menuTriggeredByDrag,
    overflowX,
    overflowY,
    pillPressed,
    releaseHover,
    searchProgress,
    toggleMenu,
    triggerHaptic,
    commitMenuItem,
    hoveredMenuItem,
    menuItemCount,
  ]);

  return {
    pillPressed,
    overflowX,
    overflowY,
    dragSelector: { visible: selectorVisible, x: selectorX, offset: selectorOffset },
    panGesture,
  };
}
