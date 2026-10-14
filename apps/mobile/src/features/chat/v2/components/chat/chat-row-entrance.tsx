import { memo, useEffect, type ReactElement, type ReactNode } from 'react';
import { View } from 'react-native';
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

type ChatRowEntranceProps = {
  children: ReactNode;
};

/**
 * Wraps a chat row and plays a smooth per-message entrance animation:
 * fade in + scale up + slide up. Disabled for reduced motion.
 */
export const ChatRowEntrance = memo(function ChatRowEntrance({
  children,
}: ChatRowEntranceProps): ReactElement {
  const isReducedMotion = useReducedMotion();
  const translateY = useSharedValue(isReducedMotion ? 0 : ENTRANCE_TRANSLATE_Y);
  const scale = useSharedValue(isReducedMotion ? 1 : ENTRANCE_SCALE);
  const opacity = useSharedValue(isReducedMotion ? 1 : 0);

  useEffect(() => {
    if (isReducedMotion) {
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

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { translateY: translateY.value }],
  }));

  return (
    <View style={{ overflow: 'hidden' }}>
      <Animated.View style={style}>{children}</Animated.View>
    </View>
  );
});
