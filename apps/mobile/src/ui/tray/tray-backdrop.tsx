import { type ReactElement } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { useTrayInternals } from './tray-context';

/** Dim behind the sheet. Fades with the same progress that drives the sheet. */
export function TrayBackdrop({ opacity = 0.45 }: { opacity?: number }): ReactElement {
  const { progress, close } = useTrayInternals();

  const style = useAnimatedStyle(() => ({ opacity: progress.get() * opacity }));

  return (
    <Animated.View style={[styles.backdrop, style]}>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='Close'
        onPress={close}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000',
  },
});
