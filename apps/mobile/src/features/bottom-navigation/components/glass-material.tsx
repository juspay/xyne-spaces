import { type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { ChromeBlur } from '@/src/ui/chrome-blur';

import { SURFACE_EDGE_WIDTH, useTabBarPalette } from '../constants';

export type GlassMaterialProps = {
  children: ReactNode;
  style?: ComponentProps<typeof Animated.View>['style'];
  borderRadius?: number | SharedValue<number>;
};

function isSharedRadius(value: number | SharedValue<number>): value is SharedValue<number> {
  return typeof value === 'object' && 'get' in value;
}

/** Half the edge stroke: how far each stroke's shape is moved inward. */
const EDGE_HALF = SURFACE_EDGE_WIDTH / 2;

/**
 * The bar's surface — the pill, the menu panel it opens into, and the search
 * button. Liquid glass with Xyne Blur where the device can draw it, frosted
 * elsewhere: the screen behind it shows through under the bar's own colour.
 * The glass follows the surface's corner radius, animated or not.
 *
 * Edged without a border: a stroke along the top and a darker one along the
 * bottom, drawn inside the glass, plus a tight drop shadow. See `EdgeStroke`
 * for why the strokes fade out down the sides.
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

  // The strokes' shapes are half a stroke larger than the surface's.
  const edgeRadiusStyle = useAnimatedStyle(() => {
    const radius = (animated ? borderRadius.get() : staticRadius) ?? 0;
    return { borderRadius: radius + EDGE_HALF };
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
        {/* Part of the glass: under the tabs, over the blur. */}
        <EdgeStroke edge='top' color={palette.edgeTop} radiusStyle={edgeRadiusStyle} />
        <EdgeStroke edge='bottom' color={palette.edgeBottom} radiusStyle={edgeRadiusStyle} />
        {children}
      </Animated.View>
    </Animated.View>
  );
}

type EdgeStrokeProps = {
  edge: 'top' | 'bottom';
  color: string;
  radiusStyle: ComponentProps<typeof Animated.View>['style'];
};

/**
 * One of the glass's two edge strokes.
 *
 * The stroke runs around the surface's rounded shape moved half a stroke
 * inward from its edge (down for the top stroke, up for the bottom one) and
 * half a stroke wider on each side, and the glass clips it to its own shape.
 * Along that edge the whole stroke lands inside the glass; at the far left and
 * right it lands just outside and is clipped away; round the corners it goes
 * from one to the other. So it is a full stroke along the top or bottom that
 * thins to nothing down the rounded ends, rather than a border of one width.
 *
 * A border is drawn inside its view, so the view is the stroke's outer edge:
 * a full stroke past the surface on three sides and flush with it on the edge
 * it draws.
 */
function EdgeStroke({ edge, color, radiusStyle }: EdgeStrokeProps): ReactElement {
  return (
    <Animated.View
      pointerEvents='none'
      style={[
        styles.edge,
        edge === 'top' ? styles.edgeTop : styles.edgeBottom,
        { borderColor: color },
        radiusStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
  edge: {
    position: 'absolute',
    left: -SURFACE_EDGE_WIDTH,
    right: -SURFACE_EDGE_WIDTH,
    borderWidth: SURFACE_EDGE_WIDTH,
  },
  edgeTop: {
    top: 0,
    bottom: -SURFACE_EDGE_WIDTH,
  },
  edgeBottom: {
    top: -SURFACE_EDGE_WIDTH,
    bottom: 0,
  },
});
