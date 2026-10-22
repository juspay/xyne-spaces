import { type ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

export type GlowOverlayProps = {
  size: number;
  id: string;
  touchX: SharedValue<number>;
  touchY: SharedValue<number>;
  glowProgress: SharedValue<number>;
};

/** The soft light that follows a touch across the glass, then spreads and fades on release. */
export function GlowOverlay({
  size,
  id,
  touchX,
  touchY,
  glowProgress,
}: GlowOverlayProps): ReactElement {
  const half = size / 2;

  const glowStyle = useAnimatedStyle(() => {
    const progress = glowProgress.get();
    const opacity =
      progress <= 1 ? progress * 0.2 : interpolate(progress, [1, 2], [0.2, 0], 'clamp');
    const scale = progress <= 1 ? 1 : interpolate(progress, [1, 2], [1, 4], 'clamp');

    return {
      opacity,
      transform: [
        { translateX: touchX.get() - half },
        { translateY: touchY.get() - half },
        { scale },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents='none'
      style={[styles.glow, { width: size, height: size }, glowStyle]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx='50%' cy='50%' r='50%'>
            <Stop offset='0%' stopColor='#fff' stopOpacity={1} />
            <Stop offset='100%' stopColor='#fff' stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={size} height={size} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
