import { memo, useEffect, type ReactElement } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import {
  CHANNEL_TICKETS_CELL_PADDING_X,
  CHANNEL_TICKETS_HEADER_ROW_HEIGHT,
  CHANNEL_TICKETS_ROW_HEIGHT,
  CHANNEL_TICKETS_SKELETON_ROWS,
} from '../constants';

/**
 * Table-shaped placeholder rows. Standalone on purpose: it is also the Suspense
 * fallback for the lazy screen, so it must not import the table or its cells.
 */
const BAR_WIDTHS = [0.62, 0.34, 0.28, 0.4] as const;

const SkeletonRow = memo(function SkeletonRow() {
  return (
    <View
      className='flex-row items-center gap-4 border-b border-ticket-table-divider'
      style={{
        height: CHANNEL_TICKETS_ROW_HEIGHT,
        paddingHorizontal: CHANNEL_TICKETS_CELL_PADDING_X,
      }}
    >
      {BAR_WIDTHS.map((ratio, index) => (
        <View key={index} className='h-3.5 rounded-md bg-foreground/10' style={{ flex: ratio }} />
      ))}
    </View>
  );
});

type ChannelTicketsSkeletonProps = {
  rowCount?: number;
};

export const ChannelTicketsSkeleton = memo(function ChannelTicketsSkeleton({
  rowCount = CHANNEL_TICKETS_SKELETON_ROWS,
}: ChannelTicketsSkeletonProps): ReactElement {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.55, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return (): void => {
      cancelAnimation(pulse);
    };
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={animatedStyle} accessibilityLabel='Loading tickets'>
      <View
        className='bg-ticket-table-header-bg border-b border-ticket-table-divider'
        style={{ height: CHANNEL_TICKETS_HEADER_ROW_HEIGHT }}
      />
      {Array.from({ length: rowCount }, (_, index) => (
        <SkeletonRow key={index} />
      ))}
    </Animated.View>
  );
});
