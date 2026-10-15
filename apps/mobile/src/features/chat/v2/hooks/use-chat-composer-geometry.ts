import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { type LayoutChangeEvent } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';
import {
  cancelAnimation,
  Easing,
  type SharedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { shouldAnimateComposerHeight } from './chat-composer-geometry';

const COMPOSER_HEIGHT_ANIMATION_CONFIG = {
  duration: 160,
  easing: Easing.out(Easing.cubic),
};

export type ChatComposerGeometry = {
  minimumHeight: number;
  totalHeight: SharedValue<number>;
  extraHeight: SharedValue<number>;
  onComposerHeight: (height: number) => void;
  onComposerLayout: (event: LayoutChangeEvent) => void;
};

export { shouldAnimateComposerHeight } from './chat-composer-geometry';

export const useChatComposerGeometry = (
  minimumHeight: number,
  resetKey: string,
): ChatComposerGeometry => {
  const totalHeight = useSharedValue(minimumHeight);
  const extraHeight = useSharedValue(0);
  const measuredHeightRef = useRef<number | null>(null);
  const previousResetKeyRef = useRef(resetKey);

  // Read inside callbacks that must not be recreated when the safe area shifts.
  const minimumHeightRef = useRef(minimumHeight);
  minimumHeightRef.current = minimumHeight;

  // Single keyboard lifecycle: useKeyboardState flips true on willShow and
  // false on didHide, so "visible" covers the full IME transition. Snap
  // composer inset while true — animating contentInsetEndAdjustment races
  // KeyboardStickyView and flickers chat bubbles (esp. with twin dock height).
  const keyboardIsVisible = useKeyboardState(state => state.isVisible);
  const keyboardIsVisibleRef = useRef(keyboardIsVisible);
  keyboardIsVisibleRef.current = keyboardIsVisible;

  const applyComposerHeight = useCallback(
    (nextTotalHeight: number, animate: boolean): void => {
      const nextExtraHeight = nextTotalHeight - minimumHeightRef.current;
      cancelAnimation(totalHeight);
      cancelAnimation(extraHeight);
      if (animate) {
        totalHeight.value = withTiming(nextTotalHeight, COMPOSER_HEIGHT_ANIMATION_CONFIG);
        extraHeight.value = withTiming(nextExtraHeight, COMPOSER_HEIGHT_ANIMATION_CONFIG);
        return;
      }
      totalHeight.value = nextTotalHeight;
      extraHeight.value = nextExtraHeight;
    },
    [extraHeight, totalHeight],
  );

  // If a height animation was already in flight when the IME appeared, snap it.
  useLayoutEffect(() => {
    if (!keyboardIsVisible) return;
    const measuredHeight = measuredHeightRef.current;
    if (measuredHeight === null) return;
    applyComposerHeight(Math.max(minimumHeightRef.current, measuredHeight), false);
  }, [applyComposerHeight, keyboardIsVisible]);

  // Recompute both halves when the safe-area minimum changes. Keep the latest
  // measured composer height so an inset change does not collapse a multiline
  // composer or leave a stale extra inset behind.
  useLayoutEffect(() => {
    const didReset = previousResetKeyRef.current !== resetKey;
    if (didReset) {
      previousResetKeyRef.current = resetKey;
      measuredHeightRef.current = null;
    }

    const measuredHeight = measuredHeightRef.current;
    const nextTotalHeight =
      measuredHeight === null
        ? minimumHeightRef.current
        : Math.max(minimumHeightRef.current, measuredHeight);

    applyComposerHeight(
      nextTotalHeight,
      shouldAnimateComposerHeight(keyboardIsVisibleRef.current, didReset),
    );
  }, [applyComposerHeight, minimumHeight, resetKey]);

  const onComposerHeight = useCallback(
    (height: number): void => {
      const measuredHeight = Math.ceil(height);
      if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) return;
      if (measuredHeightRef.current === measuredHeight) return;

      const nextTotalHeight = Math.max(minimumHeightRef.current, measuredHeight);
      measuredHeightRef.current = measuredHeight;
      applyComposerHeight(
        nextTotalHeight,
        shouldAnimateComposerHeight(keyboardIsVisibleRef.current),
      );
    },
    [applyComposerHeight],
  );

  const onComposerLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      onComposerHeight(event.nativeEvent.layout.height);
    },
    [onComposerHeight],
  );

  return useMemo(
    () => ({
      minimumHeight,
      totalHeight,
      extraHeight,
      onComposerHeight,
      onComposerLayout,
    }),
    [extraHeight, minimumHeight, onComposerHeight, onComposerLayout, totalHeight],
  );
};
