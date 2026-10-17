import { type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { ChromeBlur } from '@/src/ui/chrome-blur';

import { TAB_BAR_SHADOW, useTabBarPalette } from '../constants';

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
 * button. Frosted with Xyne Blur: the screen behind it shows through blurred,
 * under the bar's own colour.
 *
 * The blur sits inside the clip, so it takes the surface's animated rounded
 * shape; the shadow and hairline stay on the outer view, outside it.
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
      style={[
        styles.surface,
        {
          borderColor: palette.surfaceBorder,
          borderRadius: staticRadius,
        },
        radiusStyle,
        style,
      ]}
    >
      <Animated.View
        pointerEvents='box-none'
        style={[StyleSheet.absoluteFill, styles.clip, radiusStyle]}
      >
        <ChromeBlur variant='bar' color={palette.background} />
        {children}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  surface: {
    boxShadow: TAB_BAR_SHADOW,
    borderWidth: StyleSheet.hairlineWidth,
  },
  clip: {
    overflow: 'hidden',
  },
});
