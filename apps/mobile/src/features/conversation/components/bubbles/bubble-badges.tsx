import { memo, useEffect, type ReactElement } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import {
  BUBBLE_READY_LEFT,
  BUBBLE_READY_RING,
  BUBBLE_READY_SIZE,
  BUBBLE_READY_TOP,
  BUBBLE_WORKING_DIM,
  BUBBLE_WORKING_DOT,
  BUBBLE_WORKING_DOT_GAP,
  BUBBLE_WORKING_LEFT,
  BUBBLE_WORKING_PADDING_X,
  BUBBLE_WORKING_PADDING_Y,
  BUBBLE_WORKING_RADIUS,
  BUBBLE_WORKING_SHADOW,
  BUBBLE_WORKING_STEP_MS,
  BUBBLE_WORKING_TOP,
} from '../../constants';

const DOTS = [0, 1, 2] as const;

const WorkingDot = memo(function WorkingDot({
  index,
  tick,
  still,
}: {
  index: number;
  tick: SharedValue<number>;
  still: boolean;
}): ReactElement {
  const style = useAnimatedStyle(() => ({
    opacity: still || Math.floor(tick.get()) % DOTS.length === index ? 1 : BUBBLE_WORKING_DIM,
  }));
  return (
    <Animated.View
      className='bg-spaces-muted'
      style={[
        style,
        { width: BUBBLE_WORKING_DOT, height: BUBBLE_WORKING_DOT, borderRadius: BUBBLE_WORKING_DOT },
      ]}
    />
  );
});

/**
 * Figma "Badge / Working" on its plate, the bubble's bottom-left corner: an
 * agent is still answering. The dots step one after another; with reduced
 * motion they hold still.
 */
export const BubbleWorkingBadge = memo(function BubbleWorkingBadge(): ReactElement {
  const still = useReducedMotion();
  const tick = useSharedValue(0);

  useEffect(() => {
    if (still) return undefined;
    tick.set(
      withRepeat(
        withTiming(DOTS.length, {
          duration: BUBBLE_WORKING_STEP_MS * DOTS.length,
          easing: Easing.linear,
        }),
        -1,
      ),
    );
    return (): void => cancelAnimation(tick);
  }, [still, tick]);

  return (
    <View
      className='absolute flex-row bg-spaces-surface-raised'
      style={{
        left: BUBBLE_WORKING_LEFT,
        top: BUBBLE_WORKING_TOP,
        borderRadius: BUBBLE_WORKING_RADIUS,
        paddingHorizontal: BUBBLE_WORKING_PADDING_X,
        paddingVertical: BUBBLE_WORKING_PADDING_Y,
        columnGap: BUBBLE_WORKING_DOT_GAP,
        boxShadow: BUBBLE_WORKING_SHADOW,
      }}
    >
      {DOTS.map(index => (
        <WorkingDot key={index} index={index} tick={tick} still={still} />
      ))}
    </View>
  );
});

/** Figma "Badge / Dot", Ready: an agent's answer is waiting, on the bubble's top-right corner. */
export function BubbleReadyDot(): ReactElement {
  return (
    <View
      className='absolute border-spaces-background bg-status-success'
      style={{
        left: BUBBLE_READY_LEFT - BUBBLE_READY_RING,
        top: BUBBLE_READY_TOP - BUBBLE_READY_RING,
        width: BUBBLE_READY_SIZE + BUBBLE_READY_RING * 2,
        height: BUBBLE_READY_SIZE + BUBBLE_READY_RING * 2,
        borderRadius: BUBBLE_READY_SIZE,
        borderWidth: BUBBLE_READY_RING,
      }}
    />
  );
}
