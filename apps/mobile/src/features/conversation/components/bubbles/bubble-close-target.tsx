import { memo, type ReactElement } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { X } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import {
  BUBBLE_CLOSE_GAP,
  BUBBLE_CLOSE_GLASS_OPACITY,
  BUBBLE_CLOSE_HEIGHT,
  BUBBLE_CLOSE_ICON_SIZE,
  BUBBLE_CLOSE_OVER_OPACITY,
  BUBBLE_CLOSE_OVER_SCALE,
  BUBBLE_CLOSE_PADDING_X,
  BUBBLE_FOLD_MS,
} from '../../constants';
import { colorOf } from '../../model/token-color';
import { BubbleGlass } from './bubble-glass';

const MOTION = { duration: BUBBLE_FOLD_MS, reduceMotion: ReduceMotion.System } as const;

type BubbleCloseTargetProps = {
  /** 1 while the bubble is held or dragged. */
  shown: SharedValue<number>;
  /** 1 while the bubble is over it. */
  over: SharedValue<number>;
  bottom: number;
  onLayout: (event: LayoutChangeEvent) => void;
};

/**
 * Figma "Bubble / Close target": glass "Close" near the bottom, shown while the
 * bubble is held; it turns red and grows with the bubble over it, and letting
 * go there puts every parked thread down. Not a button: the drag is the input,
 * and screen readers get "Close all" on the bubble itself.
 */
export const BubbleCloseTarget = memo(function BubbleCloseTarget({
  shown,
  over,
  bottom,
  onLayout,
}: BubbleCloseTargetProps): ReactElement {
  const [backgroundToken, onAccentToken] = useCSSVariable([
    '--color-spaces-background',
    '--color-spaces-accent-foreground',
  ]);

  const frameStyle = useAnimatedStyle(() => ({
    opacity: withTiming(shown.get(), MOTION),
    transform: [{ scale: withTiming(over.get() ? BUBBLE_CLOSE_OVER_SCALE : 1, MOTION) }],
  }));
  const overStyle = useAnimatedStyle(() => ({ opacity: withTiming(over.get(), MOTION) }));

  const content = (color: string): ReactElement => (
    <>
      <X size={BUBBLE_CLOSE_ICON_SIZE} color={color} />
      <Text className='text-[14px] font-medium leading-[18px] tracking-[-0.14px]' style={{ color }}>
        Close
      </Text>
    </>
  );

  return (
    <View
      pointerEvents='none'
      importantForAccessibility='no-hide-descendants'
      accessibilityElementsHidden
      className='absolute left-0 right-0 items-center'
      style={{ bottom }}
    >
      <Animated.View
        onLayout={onLayout}
        className='flex-row items-center overflow-hidden'
        style={[
          frameStyle,
          {
            height: BUBBLE_CLOSE_HEIGHT,
            borderRadius: BUBBLE_CLOSE_HEIGHT / 2,
            paddingHorizontal: BUBBLE_CLOSE_PADDING_X,
            columnGap: BUBBLE_CLOSE_GAP,
          },
        ]}
      >
        <BubbleGlass
          tintClassName='bg-spaces-foreground'
          tintOpacity={BUBBLE_CLOSE_GLASS_OPACITY}
        />
        {content(colorOf(backgroundToken))}
        {/* "Over": red glass with white words, faded in over the default. */}
        <Animated.View
          className='absolute inset-0 flex-row items-center justify-center'
          style={[overStyle, { columnGap: BUBBLE_CLOSE_GAP }]}
        >
          <BubbleGlass tintClassName='bg-status-danger' tintOpacity={BUBBLE_CLOSE_OVER_OPACITY} />
          {content(colorOf(onAccentToken))}
        </Animated.View>
      </Animated.View>
    </View>
  );
});
