import { memo, type ReactElement } from 'react';
import {
  GestureDetector,
  type ComposedGesture,
  type GestureType,
} from 'react-native-gesture-handler';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { ViewStyle } from 'react-native';
import { useCSSVariable } from 'uniwind';

import {
  BUBBLE_TAB_GLASS_OPACITY,
  BUBBLE_TAB_HEIGHT,
  BUBBLE_TAB_ICON_SIZE,
  BUBBLE_TAB_RADIUS,
  BUBBLE_TAB_WIDTH,
} from '../../constants';
import type { BubbleSide } from '../../model/bubbles';
import { colorOf } from '../../model/token-color';
import { BubbleGlass } from './bubble-glass';

type BubbleEdgeTabProps = {
  side: BubbleSide;
  /** Its place on the edge, driven by the stack. */
  style: AnimatedStyle<ViewStyle>;
  gesture: ComposedGesture | GestureType;
  onActivate: () => void;
};

/**
 * Figma "Bubble / Edge tab": what is left of the bubble pushed off a side
 * edge, a glass tab with a chevron pointing back in. Tapping it or pulling it
 * off the edge brings the bubble back; dragging it along the edge moves it.
 */
export const BubbleEdgeTab = memo(function BubbleEdgeTab({
  side,
  style,
  gesture,
  onActivate,
}: BubbleEdgeTabProps): ReactElement {
  const iconColor = colorOf(useCSSVariable('--color-spaces-background'));
  const Chevron = side === 'right' ? ChevronLeft : ChevronRight;
  const inner = side === 'right' ? 'Left' : 'Right';

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole='button'
        accessibilityLabel='Show parked threads'
        accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'activate') onActivate();
        }}
        className='absolute items-center justify-center overflow-hidden'
        style={[
          {
            top: 0,
            [side]: 0,
            width: BUBBLE_TAB_WIDTH,
            height: BUBBLE_TAB_HEIGHT,
            [`borderTop${inner}Radius`]: BUBBLE_TAB_RADIUS,
            [`borderBottom${inner}Radius`]: BUBBLE_TAB_RADIUS,
          },
          style,
        ]}
      >
        <BubbleGlass tintClassName='bg-spaces-foreground' tintOpacity={BUBBLE_TAB_GLASS_OPACITY} />
        <Chevron size={BUBBLE_TAB_ICON_SIZE} color={iconColor} />
      </Animated.View>
    </GestureDetector>
  );
});
