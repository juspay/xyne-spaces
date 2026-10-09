import { type ReactElement } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useIsDark } from '@/src/design-system';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

type ScrimProps = { isOpen: SharedValue<boolean> };

/**
 * The dim behind the menu, and what closes it.
 *
 * Grok's split, for grok's reason: iOS animates a real blur, Android fades a
 * flat scrim because `BlurView` there is unpredictable enough that a list
 * behind it can stutter. The tint follows the theme rather than being fixed
 * dark — the design dims a light screen.
 *
 * `pointerEvents` is animated alongside the fade, and that is not optional.
 * Hit testing ignores opacity: a scrim at `opacity: 0` is still a full-screen
 * touch target, and this one is portalled above the tab bar, so leaving it
 * live swallows every tap on the app — the list, the bar, everything.
 *
 * Grok gets this for free by gating its whole menu container. This menu
 * cannot, because its button lives in that container and has to stay
 * pressable while the menu is shut, so the gate belongs here instead.
 */
export function FabBackdrop({ isOpen }: ScrimProps): ReactElement {
  const isDark = useIsDark();

  const blurProps = useAnimatedProps(() => {
    if (Platform.OS !== 'ios') return { intensity: 0 };
    return { intensity: withTiming(isOpen.get() ? 60 : 0) };
  });

  const containerStyle = useAnimatedStyle(() => {
    const open = isOpen.get();
    return {
      pointerEvents: open ? 'auto' : 'none',
      // iOS draws its dim with the blur, so only Android fades this.
      opacity: Platform.OS === 'android' ? withTiming(open ? 1 : 0) : 1,
    };
  });

  const close = (): void => {
    isOpen.set(false);
  };

  if (Platform.OS === 'android') {
    return (
      <AnimatedPressable
        onPress={close}
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(23,23,28,0.28)' },
          containerStyle,
        ]}
      />
    );
  }

  return (
    <AnimatedPressable style={[StyleSheet.absoluteFill, containerStyle]} onPress={close}>
      <AnimatedBlurView
        tint={isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
        animatedProps={blurProps}
      />
    </AnimatedPressable>
  );
}

/**
 * The second iOS blur, on top.
 *
 * Reads backwards and is meant to: it is clear while the menu is open and
 * blurs as it closes, so the screen softens for the moment the pills are
 * folding away. The 150ms delay on the fade-out is what lets them get out
 * first.
 */
export function FabOverlay({ isOpen }: ScrimProps): ReactElement | null {
  const isDark = useIsDark();

  const containerStyle = useAnimatedStyle(() => {
    if (Platform.OS !== 'ios') return { opacity: 0 };
    return { opacity: isOpen.get() ? withTiming(1) : withDelay(150, withTiming(0)) };
  });

  const blurProps = useAnimatedProps(() => {
    if (Platform.OS !== 'ios') return { intensity: 0 };
    return { intensity: withTiming(isOpen.get() ? 0 : 40, { duration: 200 }) };
  });

  if (Platform.OS !== 'ios') return null;

  return (
    <Animated.View pointerEvents='none' style={[StyleSheet.absoluteFill, containerStyle]}>
      <AnimatedBlurView
        tint={isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
        animatedProps={blurProps}
      />
    </Animated.View>
  );
}
