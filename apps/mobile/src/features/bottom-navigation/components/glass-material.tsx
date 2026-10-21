import { type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { ChromeBlur } from '@/src/ui/chrome-blur';

import { SURFACE_OUTLINE_WIDTH, useTabBarPalette } from '../constants';

export type GlassMaterialProps = {
  children: ReactNode;
  style?: ComponentProps<typeof Animated.View>['style'];
  borderRadius?: number | SharedValue<number>;
};

function isSharedRadius(value: number | SharedValue<number>): value is SharedValue<number> {
  return typeof value === 'object' && 'get' in value;
}

/**
 * The bar's surface — the pill, the menu panel it opens into, and the search
 * button. Liquid glass with Xyne Blur where the device can draw it, frosted
 * elsewhere: the screen behind it shows through under the bar's own colour.
 * The glass follows the surface's corner radius, animated or not.
 *
 * The blur sits inside the clip, so it takes the surface's animated rounded
 * shape; the shadow stays on the outer view, outside it.
 *
 * Edged as Telegram edges its floating tabs: a 0.4pt hairline drawn over the
 * surface, lighter along the top half and darker along the bottom, plus a
 * tight shadow. The hairline is an overlay rather than a border because a
 * border takes layout space: it shrank the clip by a hairline on every side
 * while the icon row kept its full height, so the row sat a hairline low and
 * the active highlight's top and bottom gaps came out unequal.
 */
export function GlassMaterial({
  children,
  style,
  borderRadius = 12,
}: GlassMaterialProps): ReactElement {
  const palette = useTabBarPalette();
  const animated = isSharedRadius(borderRadius);
  const staticRadius = animated ? undefined : borderRadius;

  const radiusStyle = useAnimatedStyle(() => {
    const radius = animated ? borderRadius.get() : staticRadius;
    return { borderRadius: radius };
  });

  return (
    <Animated.View
      collapsable={false}
      style={[{ boxShadow: palette.surfaceShadow, borderRadius: staticRadius }, radiusStyle, style]}
    >
      <Animated.View
        pointerEvents='box-none'
        style={[StyleSheet.absoluteFill, styles.clip, radiusStyle]}
      >
        <ChromeBlur variant='bar' color={palette.background} cornerRadius={borderRadius} />
        {children}
      </Animated.View>
      <OutlineHalf edge='top' color={palette.outlineTop} radiusStyle={radiusStyle} />
      <OutlineHalf edge='bottom' color={palette.outlineBottom} radiusStyle={radiusStyle} />
    </Animated.View>
  );
}

type OutlineHalfProps = {
  edge: 'top' | 'bottom';
  color: string;
  radiusStyle: ComponentProps<typeof Animated.View>['style'];
};

/**
 * One half of the hairline: the whole rounded outline, clipped to the top or
 * bottom half of the surface — Telegram's two clipped stroke passes.
 */
function OutlineHalf({ edge, color, radiusStyle }: OutlineHalfProps): ReactElement {
  return (
    <View pointerEvents='none' style={[styles.half, edge === 'top' ? styles.top : styles.bottom]}>
      <Animated.View
        style={[
          styles.outline,
          edge === 'top' ? styles.top : styles.bottom,
          { borderColor: color },
          radiusStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
  half: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: '50%',
    overflow: 'hidden',
  },
  // Twice the half's height, so it spans the whole surface from its edge.
  outline: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: '200%',
    borderWidth: SURFACE_OUTLINE_WIDTH,
  },
  top: { top: 0 },
  bottom: { bottom: 0 },
});
