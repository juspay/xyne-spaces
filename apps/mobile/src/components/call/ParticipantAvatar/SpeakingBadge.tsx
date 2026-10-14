import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { callColors } from '../callTheme';

const BAR_DELAYS_MS = [0, 180, 90];
const BOUNCE_MS = 450;

function Bar({ delay }: { delay: number }): React.ReactElement {
  const scale = useSharedValue(0.35);

  useEffect(() => {
    scale.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: BOUNCE_MS, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.35, { duration: BOUNCE_MS, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
      ),
    );
  }, [delay, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: scale.value }] }));
  return <Animated.View style={[styles.bar, style]} />;
}

/**
 * Small "someone is talking" badge: three bouncing bars on a coloured disc — the dashboard's
 * Meet-style equaliser (WhatsApp shows the same idea) — instead of a pulsing ring, so a
 * speaking avatar doesn't read as an incoming call.
 */
export function SpeakingBadge({ size }: { size: number }): React.ReactElement {
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2 }]}>
      {BAR_DELAYS_MS.map((delay, i) => (
        <Bar key={i} delay={delay} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: callColors.speakingBadge,
  },
  bar: {
    width: 3,
    height: 10,
    borderRadius: 2,
    backgroundColor: callColors.onColor,
  },
});
