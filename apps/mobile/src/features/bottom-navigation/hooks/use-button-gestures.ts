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
  composedGesture: ComposedGesture;
} {
  const pressed = useSharedValue(0);
  const overflowX = useSharedValue(0);
  const overflowY = useSharedValue(0);

  const triggerHaptic = useCallback(() => {
    void haptics.buttonTap();
  }, []);

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .onBegin(() => {
          pressed.set(withTiming(1, { duration: 80 }));
        })
        .onFinalize(() => {
          pressed.set(withTiming(0, { duration: 150 }));
        })
        .onEnd(() => {
          scheduleOnRN(triggerHaptic);
          scheduleOnRN(onToggleSearch);
        }),
    [onToggleSearch, pressed, triggerHaptic],
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(10)
        .onStart(() => {
          cancelAnimation(overflowX);
          cancelAnimation(overflowY);
          pressed.set(withTiming(1, { duration: 80 }));
        })
        .onUpdate(event => {
          const nextOverflowX =
            event.x < 0 ? event.x : event.x > SEARCH_BUTTON_SIZE ? event.x - SEARCH_BUTTON_SIZE : 0;
          const nextOverflowY =
            event.y < 0 ? event.y : event.y > PILL_HEIGHT ? event.y - PILL_HEIGHT : 0;
          overflowX.set(nextOverflowX);
          overflowY.set(nextOverflowY);
        })
        .onEnd(() => {
          pressed.set(withTiming(0, { duration: 150 }));
          overflowX.set(withSpring(0, SPRING_BOUNCY));
          overflowY.set(withSpring(0, SPRING_BOUNCY));
        }),
    [overflowX, overflowY, pressed],
  );

  const composedGesture = useMemo(
    () => Gesture.Race(panGesture, tapGesture),
    [panGesture, tapGesture],
  );

  return { pressed, overflowX, overflowY, composedGesture };
}
