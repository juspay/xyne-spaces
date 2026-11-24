import { memo, type ReactElement } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { BUBBLE_BEHIND_DEPTHS, BUBBLE_SHADOW, BUBBLE_SIZE } from '../../constants';

type BubbleBehindProps = {
  /** 1 is the card right behind the bubble. */
  depth: number;
  /** Every card's top-left, as flat [x1, y1, x2, y2, …] pairs. */
  trail: SharedValue<number[]>;
  /** 0 folded (only the first card shows), 1 spread out behind a drag. */
  spread: SharedValue<number>;
};

/**
 * Figma "Bubble / Behind": one more parked thread under the front bubble, a
 * step smaller and dimmer per depth. At rest only the first shows; the rest
 * fade in to trail a drag.
 */
export const BubbleBehind = memo(function BubbleBehind({
  depth,
  trail,
  spread,
}: BubbleBehindProps): ReactElement {
  const look =
    BUBBLE_BEHIND_DEPTHS[Math.min(depth, BUBBLE_BEHIND_DEPTHS.length) - 1] ??
    BUBBLE_BEHIND_DEPTHS[0];
  const index = (depth - 1) * 2;

  const style = useAnimatedStyle(() => {
    const positions = trail.get();
    return {
      opacity: depth === 1 ? 1 : spread.get(),
      transform: [{ translateX: positions[index] ?? 0 }, { translateY: positions[index + 1] ?? 0 }],
    };
  });

  return (
    <Animated.View
      pointerEvents='none'
      importantForAccessibility='no-hide-descendants'
      accessibilityElementsHidden
      style={[
        { position: 'absolute', left: 0, top: 0, width: BUBBLE_SIZE, height: BUBBLE_SIZE },
        style,
      ]}
    >
      <View
        className='bg-spaces-surface-raised'
        style={{
          position: 'absolute',
          left: look.inset,
          top: look.inset,
          width: BUBBLE_SIZE - look.inset * 2,
          height: BUBBLE_SIZE - look.inset * 2,
          borderRadius: look.radius,
          opacity: look.opacity,
          boxShadow: BUBBLE_SHADOW,
        }}
      />
    </Animated.View>
  );
});
