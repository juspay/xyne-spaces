import { useCallback, useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { View } from 'react-native';
import { useRecyclingEffect } from '@legendapp/list/react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const ENTRANCE_TRANSLATE_Y = 12;
const ENTRANCE_SCALE = 0.88;
const ENTRANCE_OPACITY_DURATION = 250;
const ENTRANCE_TRANSFORM_DURATION = 280;
const ENTRANCE_OPACITY_EASING = Easing.out(Easing.quad);
const ENTRANCE_TRANSFORM_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

type RowEntranceProps = {
  conversationId: string;
  enabled: boolean;
  children: ReactNode;
};

/**
 * Recycle-safe tail-append entrance. First paint uses `useEffect`; recycled
 * cells use `useRecyclingEffect` (that hook skips the first paint). Transform
 * only — does not change reserved height.
 */
export function RowEntrance({
  conversationId: _conversationId,
  enabled,
  children,
}: RowEntranceProps): ReactElement {
  const isReducedMotion = useReducedMotion();
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  void _conversationId;

  const playOrReset = useCallback((): void => {
    if (!enabledRef.current || isReducedMotion) {
      translateY.value = 0;
      scale.value = 1;
      opacity.value = 1;
      return;
    }
    translateY.value = ENTRANCE_TRANSLATE_Y;
    scale.value = ENTRANCE_SCALE;
    opacity.value = 0;
    opacity.value = withTiming(1, {
      duration: ENTRANCE_OPACITY_DURATION,
      easing: ENTRANCE_OPACITY_EASING,
    });
    scale.value = withTiming(1, {
      duration: ENTRANCE_TRANSFORM_DURATION,
      easing: ENTRANCE_TRANSFORM_EASING,
    });
    translateY.value = withTiming(0, {
      duration: ENTRANCE_TRANSFORM_DURATION,
      easing: ENTRANCE_TRANSFORM_EASING,
    });
  }, [isReducedMotion, opacity, scale, translateY]);

  useEffect(() => {
    playOrReset();
  }, [enabled, playOrReset]);

  useRecyclingEffect(playOrReset);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { translateY: translateY.value }],
  }));

  return (
    <View>
      <Animated.View style={style}>{children}</Animated.View>
    </View>
  );
}
