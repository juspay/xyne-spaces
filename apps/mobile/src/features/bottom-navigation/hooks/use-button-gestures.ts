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

import { PILL_HEIGHT, SEARCH_BUTTON_SIZE, SPRING_BOUNCY } from '../constants';

export function useButtonGestures(onToggleSearch: () => void): {
  pressed: SharedValue<number>;
  overflowX: SharedValue<number>;
  overflowY: SharedValue<number>;
  touchX: SharedValue<number>;
  touchY: SharedValue<number>;
  glowProgress: SharedValue<number>;
  composedGesture: ComposedGesture;
} {
  const pressed = useSharedValue(0);
  const overflowX = useSharedValue(0);
  const overflowY = useSharedValue(0);
  const touchX = useSharedValue(SEARCH_BUTTON_SIZE / 2);
  const touchY = useSharedValue(PILL_HEIGHT / 2);
  const glowProgress = useSharedValue(0);

  const triggerHaptic = useCallback(() => {
    void haptics.buttonTap();
  }, []);

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .onBegin(() => {
          touchX.set(SEARCH_BUTTON_SIZE / 2);
          touchY.set(PILL_HEIGHT / 2);
          pressed.set(withTiming(1, { duration: 80 }));
          cancelAnimation(glowProgress);
          glowProgress.set(1);
        })
        .onFinalize(() => {
          pressed.set(withTiming(0, { duration: 150 }));
          glowProgress.set(withTiming(2, { duration: 300 }));
        })
        .onEnd(() => {
          scheduleOnRN(triggerHaptic);
          scheduleOnRN(onToggleSearch);
        }),
    [glowProgress, onToggleSearch, pressed, touchX, touchY, triggerHaptic],
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(10)
        .onStart(event => {
          cancelAnimation(overflowX);
          cancelAnimation(overflowY);
          cancelAnimation(glowProgress);
          touchX.set(event.x);
          touchY.set(event.y);
          pressed.set(withTiming(1, { duration: 80 }));
          glowProgress.set(1);
        })
        .onUpdate(event => {
          touchX.set(event.x);
          touchY.set(event.y);
          const nextOverflowX =
            event.x < 0 ? event.x : event.x > SEARCH_BUTTON_SIZE ? event.x - SEARCH_BUTTON_SIZE : 0;
          const nextOverflowY =
            event.y < 0 ? event.y : event.y > PILL_HEIGHT ? event.y - PILL_HEIGHT : 0;
          overflowX.set(nextOverflowX);
          overflowY.set(nextOverflowY);
        })
        .onEnd(() => {
          pressed.set(withTiming(0, { duration: 150 }));
          glowProgress.set(withTiming(2, { duration: 300 }));
          overflowX.set(withSpring(0, SPRING_BOUNCY));
          overflowY.set(withSpring(0, SPRING_BOUNCY));
        }),
    [glowProgress, overflowX, overflowY, pressed, touchX, touchY],
  );

  const composedGesture = useMemo(
    () => Gesture.Race(panGesture, tapGesture),
    [panGesture, tapGesture],
  );

  return { pressed, overflowX, overflowY, touchX, touchY, glowProgress, composedGesture };
}
