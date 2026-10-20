import { type ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { type SharedValue, useAnimatedProps } from 'react-native-reanimated';
import { useCSSVariable, useUniwind } from 'uniwind';

import { BlurSurface, isGlassSupported } from '@/modules/xyne-blur';

/**
 * How much of the surface's own colour lies over the blur.
 *
 * - Header: the header colour at alpha 216/255 in a light theme and 178/255 in
 *   a dark one. Dark is lighter-handed because dark content shows less through
 *   a dark tint.
 * - Bar: the bar colour at 76% over the frost, 85% over glass — glass shows
 *   the content far sharper, so it takes more tint to keep icons readable.
 */
const TINT_ALPHA = {
  header: { light: 216 / 255, dark: 178 / 255 },
  bar: { light: 0.76, dark: 0.76 },
} as const;

const GLASS_TINT_ALPHA = 0.85;

/**
 * Which surfaces are glass. The bar's floating pieces are; the header, which
 * spans the screen edge to edge, stays frosted — glass reads as a pane only
 * when its rounded rim is on show.
 */
const USES_GLASS = { header: false, bar: true } as const;

export type ChromeBlurVariant = keyof typeof TINT_ALPHA;

export type ChromeBlurProps = {
  variant: ChromeBlurVariant;
  /** The surface's own colour — what it was painted solid in before. */
  color: string;
  /** The corner radius of the surface this fills; glass bends light along it. */
  cornerRadius?: number | SharedValue<number>;
};

const AnimatedBlurSurface = Animated.createAnimatedComponent(BlurSurface);

function isSharedRadius(value: number | SharedValue<number>): value is SharedValue<number> {
  return typeof value === 'object' && 'get' in value;
}

/**
 * The frosted background for the Spaces header and bottom bar — liquid glass
 * for the bar, where the device can draw it. Lay it first inside the surface;
 * it fills it.
 *
 * Follows the theme by itself: the colours come from theme tokens, and a theme
 * switch hands the native surface new ones.
 *
 * Only shows content that sits inside a `BlurTarget` (Android). Wrap a
 * screen's list in one; never wrap the surface itself.
 */
export function ChromeBlur({ variant, color, cornerRadius = 0 }: ChromeBlurProps): ReactElement {
  const { theme } = useUniwind();
  const scheme = theme === 'dark' ? 'dark' : 'light';
  // What goes under the content: the screen's own background.
  const base = useCSSVariable('--color-spaces-background') as string;
  const isGlass = USES_GLASS[variant] && isGlassSupported;

  // A radius that animates (the pill opening into the menu) reaches the native
  // view on the UI thread, without a React render per frame. Which kind it is
  // gets settled here: the worklet below runs on the UI thread, where a plain
  // JS helper cannot be called.
  const sharedRadius = isSharedRadius(cornerRadius) ? cornerRadius : null;
  const staticRadius = sharedRadius ? 0 : (cornerRadius as number);
  const radiusProps = useAnimatedProps(() => ({
    cornerRadius: sharedRadius ? sharedRadius.get() : staticRadius,
  }));

  return (
    <AnimatedBlurSurface
      style={StyleSheet.absoluteFill}
      baseColor={base}
      tintColor={color}
      tintAlpha={isGlass ? GLASS_TINT_ALPHA : TINT_ALPHA[variant][scheme]}
      colorScheme={scheme}
      material={isGlass ? 'glass' : 'frost'}
      animatedProps={radiusProps}
    />
  );
}
