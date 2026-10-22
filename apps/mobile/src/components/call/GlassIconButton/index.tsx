import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { haptics } from '@/src/utils/haptics';
import { CircleRing } from '../CircleRing';
import { GlassPanel } from '../GlassPanel';
import { callGlass } from '../callTheme';

const SIZE = 40;

interface GlassIconButtonProps {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}

/** Round frosted button of the call chrome: minimise, add people, flip camera. */
export function GlassIconButton({
  label,
  onPress,
  children,
}: GlassIconButtonProps): React.ReactElement {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      hitSlop={6}
      onPress={() => {
        void haptics.buttonTap();
        onPress();
      }}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
    >
      <View style={styles.button}>
        {Platform.OS === 'android' ? (
          // Android has no blur to clip, so the disc is one antialiased fill with the ring drawn
          // on top — a GlassPanel border clipped to a circle shows up as dots (see CircleRing).
          <>
            <View pointerEvents='none' style={styles.androidFill} />
            <CircleRing size={SIZE} color={callGlass.border} />
          </>
        ) : (
          <View pointerEvents='none' style={styles.glassClip}>
            <GlassPanel decorative style={styles.glass} />
          </View>
        )}
        {children}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: SIZE / 2,
  },
  pressed: {
    opacity: 0.7,
  },
  button: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  androidFill: {
    ...StyleSheet.absoluteFill,
    borderRadius: SIZE / 2,
    backgroundColor: callGlass.fillAndroid,
  },
  glassClip: {
    ...StyleSheet.absoluteFill,
    borderRadius: SIZE / 2,
    overflow: 'hidden',
  },
  glass: {
    ...StyleSheet.absoluteFill,
    borderRadius: SIZE / 2,
  },
});
