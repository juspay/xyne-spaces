import { type ReactElement, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { GlassView } from 'expo-glass-effect';

import { SUPPORTS_LIQUID_GLASS } from '@/src/utils/platform';

type GlassSurfaceProps = {
  /**
   * Fill used on Android and pre-iOS-26. Pass the exact colour the surface
   * used before — the fallback must stay pixel-identical.
   */
  fallbackColor: string;
  /** Must carry the surface's own size and borderRadius; GlassView shapes itself from it. */
  style?: StyleProp<ViewStyle>;
  /** Media overlays sit on dark content, so this defaults to 'dark'. */
  colorScheme?: 'light' | 'dark';
  /**
   * Tints the glass. Use for surfaces whose colour carries meaning — a brand
   * or user-chosen accent — so the material reads as glass without discarding
   * the colour. Omit for neutral chrome.
   */
  tintColor?: string;
  /**
   * Enables the native press lensing. Set this when the surface sits inside a
   * Pressable — the glass must be a *child* of the touch target, not its
   * parent, or UIKit distorts the content instead of the surface.
   */
  interactive?: boolean;
  children?: ReactNode;
};

/**
 * A translucent surface that floats over media. On iOS 26 it becomes a real
 * UIGlassEffect; everywhere else it falls back to the flat rgba fill it
 * replaced.
 *
 * Use this only where there is genuine content behind the surface — video, a
 * photo, a participant feed. Over an opaque background the glass has nothing
 * to refract and renders as a flat disc, so a plain View is the better choice
 * there.
 */
export const GlassSurface = ({
  fallbackColor,
  style,
  colorScheme = 'dark',
  tintColor,
  interactive = false,
  children,
}: GlassSurfaceProps): ReactElement =>
  SUPPORTS_LIQUID_GLASS ? (
    <GlassView
      isInteractive={interactive}
      glassEffectStyle='regular'
      colorScheme={colorScheme}
      {...(tintColor ? { tintColor } : {})}
      style={style}
    >
      {children}
    </GlassView>
  ) : (
    <View style={[style, { backgroundColor: fallbackColor }]}>{children}</View>
  );
