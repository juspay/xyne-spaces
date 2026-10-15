import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView } from 'expo-glass-effect';

import { SUPPORTS_LIQUID_GLASS } from '@/src/utils/platform';
import { callGlass } from '../callTheme';

interface GlassPanelProps {
  /** Carries the size and `borderRadius`; the glass shapes itself from it. */
  style?: StyleProp<ViewStyle>;
  /** Blur strength (1–100) on the BlurView path. */
  intensity?: number;
  /** Set when the panel is decoration only (e.g. sits behind buttons) so it never takes touches. */
  decorative?: boolean;
  children?: React.ReactNode;
}

/**
 * Frosted glass for the call UI. On iOS 26 it is a real UIGlassEffect; elsewhere it is the app's
 * usual recipe — BlurView + a dark tint + a ring — matching the dashboard's
 * `bg-black/50-60 backdrop-blur ring-white/15-20 shadow` chips.
 *
 * The shadow lives on the outer view, `style` applied to it exactly as callers pass it (so
 * existing padding/sizing at every call site keeps working unchanged); only the blur/tint sit in
 * a separate absolute-fill inner layer with `overflow:'hidden'`, since RN doesn't render a shadow
 * on a view that also clips its children — a shadow on the clipped layer itself would just be
 * invisible on iOS. That inner layer borrows `style`'s own `borderRadius` so its clip matches the
 * outer shape exactly.
 *
 * Use it for surfaces floating over video or a photo; on a flat background there is nothing to
 * blur and a plain View is better.
 */
export function GlassPanel({
  style,
  intensity = callGlass.intensity,
  decorative = false,
  children,
}: GlassPanelProps): React.ReactElement {
  const borderRadius = StyleSheet.flatten(style)?.borderRadius;
  const clipShape = borderRadius === undefined ? undefined : { borderRadius };
  const outerProps = decorative ? { pointerEvents: 'none' as const } : {};

  if (SUPPORTS_LIQUID_GLASS) {
    return (
      <View style={[styles.shadow, style]} {...outerProps}>
        <View style={[StyleSheet.absoluteFill, styles.clip, clipShape]}>
          <GlassView
            glassEffectStyle='regular'
            colorScheme='dark'
            style={StyleSheet.absoluteFill}
          />
        </View>
        {children}
      </View>
    );
  }

  return (
    <View style={[styles.shadow, style]} {...outerProps}>
      <View style={[StyleSheet.absoluteFill, styles.clip, clipShape]}>
        <BlurView
          intensity={intensity}
          tint='dark'
          blurMethod='dimezisBlurView'
          style={StyleSheet.absoluteFill}
          pointerEvents='none'
        />
        <View
          pointerEvents='none'
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor:
                Platform.OS === 'android' ? callGlass.overlayAndroid : callGlass.overlay,
            },
          ]}
        />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    borderWidth: 1,
    borderColor: callGlass.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8,
  },
  clip: {
    overflow: 'hidden',
  },
});
