import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useMemo, type ReactElement } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useUniwind } from 'uniwind';

import { TAB_BAR_BLUR_ALPHA, TAB_BAR_SCRIM_ALPHA } from '../constants';

type TabBarBackdropProps = {
  height: number;
  /** Share of the band, measured from the bottom, that stays at full strength. */
  startOffset: number;
  /**
   * Whether the iOS blur layer may be live.
   *
   * Only the blur is gated, never the gradient. The gradient is what reads as
   * the fade, and unmounting it with focus made it vanish before a push
   * animation started and reappear a frame after the pop — out of step with the
   * bar, which stays mounted throughout.
   */
  isBlurEnabled?: boolean;
};

/** A smoothstep-shaped ramp, so the fade has no visible banding edge. */
const RAMP_STOPS = [0, 0.3, 0.55, 0.75, 0.9, 1] as const;
const RAMP_ALPHAS = [0, 0.08, 0.3, 0.62, 0.88, 1] as const;

const SCRIM_RGB = { light: '255, 255, 255', dark: '10, 10, 10' } as const;

type Ramp = {
  colors: readonly [string, string, ...string[]];
  locations: readonly [number, number, ...number[]];
};

function ramp(rgb: string, peak: number, fadeEnd: number): Ramp {
  const colors = RAMP_ALPHAS.map(alpha => `rgba(${rgb}, ${alpha * peak})`);
  const locations = RAMP_STOPS.map(stop => stop * fadeEnd);
  return {
    // The extra pinned stop holds full strength across the solid band under the pill.
    colors: [...colors, `rgba(${rgb}, ${peak})`] as unknown as Ramp['colors'],
    locations: [...locations, 1] as unknown as Ramp['locations'],
  };
}

/**
 * Full-width progressive fade along the bottom edge: strongest behind the tab
 * bar, clear above it.
 *
 * The blur runs at `intensity={100}` on purpose. Anything below 100 is faked
 * with a paused `UIViewPropertyAnimator`, and UIKit finishes those on its own
 * — at launch, on backgrounding, when snapshotting for the app switcher — which
 * snaps the material to full strength across the window as a white wash. At 100
 * the completed state *is* the intended state, so there is nothing to blow out;
 * the mask below is what makes the effect subtle.
 *
 * Android gets the gradient alone. Every Android blur backend works by
 * snapshotting and blurring the window each frame, and at this strength the
 * gradient is indistinguishable from the result while costing nothing.
 */
export const TabBarBackdrop = memo(function TabBarBackdrop({
  height,
  startOffset,
  isBlurEnabled = true,
}: TabBarBackdropProps): ReactElement | null {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const fadeEnd = 1 - Math.min(Math.max(startOffset, 0), 1);

  const scrim = useMemo(
    () =>
      ramp(
        isDark ? SCRIM_RGB.dark : SCRIM_RGB.light,
        isDark ? TAB_BAR_SCRIM_ALPHA.dark : TAB_BAR_SCRIM_ALPHA.light,
        fadeEnd,
      ),
    [fadeEnd, isDark],
  );

  const mask = useMemo(() => ramp('0, 0, 0', TAB_BAR_BLUR_ALPHA, fadeEnd), [fadeEnd]);

  if (Platform.OS === 'web') return null;

  const scrimLayer = (
    <LinearGradient
      colors={scrim.colors}
      locations={scrim.locations}
      style={StyleSheet.absoluteFill}
    />
  );

  if (Platform.OS === 'android') {
    return (
      <View pointerEvents='none' style={[styles.band, { height }]}>
        {scrimLayer}
      </View>
    );
  }

  return (
    <View pointerEvents='none' style={[styles.band, { height }]}>
      {/*
        Dropped while the screen is not focused so UIKit has no live blur to
        finish during a push or a pop. The gradient below stays, so the band
        does not disappear — it just loses the material for the moment nobody
        is looking at it.
      */}
      {isBlurEnabled ? (
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <LinearGradient
              colors={mask.colors}
              locations={mask.locations}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          <BlurView
            intensity={100}
            tint={isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
            style={StyleSheet.absoluteFill}
          />
        </MaskedView>
      ) : null}
      {scrimLayer}
    </View>
  );
});

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
