import { type ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { useCSSVariable, useUniwind } from 'uniwind';

import { BlurSurface } from '@/modules/xyne-blur';

/**
 * How much of the surface's own colour lies over the blur.
 *
 * - Header: the header colour at alpha 216/255 in a light theme and 178/255 in
 *   a dark one. Dark is lighter-handed because dark content shows less through
 *   a dark tint.
 * - Bar: the bar colour at 76%.
 */
const TINT_ALPHA = {
  header: { light: 216 / 255, dark: 178 / 255 },
  bar: { light: 0.76, dark: 0.76 },
} as const;

export type ChromeBlurVariant = keyof typeof TINT_ALPHA;

export type ChromeBlurProps = {
  variant: ChromeBlurVariant;
  /** The surface's own colour — what it was painted solid in before. */
  color: string;
};

/**
 * The frosted background for the Spaces header and bottom bar. Lay it first
 * inside the surface; it fills it.
 *
 * Follows the theme by itself: the colours come from theme tokens, and a theme
 * switch hands the native surface new ones.
 *
 * Only shows content that sits inside a `BlurTarget` (Android). Wrap a
 * screen's list in one; never wrap the surface itself.
 */
export function ChromeBlur({ variant, color }: ChromeBlurProps): ReactElement {
  const { theme } = useUniwind();
  const scheme = theme === 'dark' ? 'dark' : 'light';
  // What goes under the content: the screen's own background.
  const base = useCSSVariable('--color-spaces-background') as string;

  return (
    <BlurSurface
      style={StyleSheet.absoluteFill}
      baseColor={base}
      tintColor={color}
      tintAlpha={TINT_ALPHA[variant][scheme]}
      colorScheme={scheme}
    />
  );
}
