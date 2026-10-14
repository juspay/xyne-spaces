import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const PULSE_DURATION_MS = 2000;
const PULSE_MAX_SCALE = 1.9;
const PULSE_START_OPACITY = 0.42;

function Ring({
  color,
  size,
  delay,
}: {
  color: string;
  size: number;
  delay: number;
}): React.ReactElement {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: PULSE_DURATION_MS, easing: Easing.out(Easing.quad) }),
        -1,
        false,
      ),
    );
    return (): void => cancelAnimation(progress);
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [PULSE_START_OPACITY, 0]),
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, PULSE_MAX_SCALE]) }],
  }));

  return (
    <Animated.View
      pointerEvents='none'
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: size / 2, borderColor: color },
        style,
      ]}
    />
  );
}

/**
 * Two staggered expanding-and-fading rings behind an avatar — the "call is ringing" pulse.
 * Mount it only while ringing; the parent must centre it over the avatar.
 */
export function RingPulse({ color, size }: { color: string; size: number }): React.ReactElement {
  return (
    <>
      <Ring color={color} size={size} delay={0} />
      <Ring color={color} size={size} delay={PULSE_DURATION_MS / 2} />
    </>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    borderWidth: 2,
  },
});
