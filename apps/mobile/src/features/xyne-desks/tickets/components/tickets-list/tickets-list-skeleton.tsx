import { memo, useEffect } from 'react';
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
  TICKET_LIST_AVATAR_SIZE,
  TICKET_LIST_CARD_HEIGHT,
  TICKET_LIST_CARD_RADIUS,
  TICKET_LIST_H_INSET,
  TICKET_LIST_ROW_GAP,
} from '../../constants';

const DEFAULT_ROW_COUNT = 6;

const SkeletonRow = memo(function SkeletonRow() {
  return (
    <View
      style={{
        paddingHorizontal: TICKET_LIST_H_INSET,
        marginBottom: TICKET_LIST_ROW_GAP,
      }}
    >
      <View
        className='flex-row gap-3 bg-card px-3 py-2.5'
        style={{
          height: TICKET_LIST_CARD_HEIGHT,
          borderRadius: TICKET_LIST_CARD_RADIUS,
        }}
      >
        <View
          className='rounded-full bg-foreground/10'
          style={{ width: TICKET_LIST_AVATAR_SIZE, height: TICKET_LIST_AVATAR_SIZE }}
        />
        <View className='min-w-0 flex-1 gap-1.5 py-0.5'>
          <View className='flex-row items-center justify-between gap-2'>
            <View className='h-3.5 w-[42%] rounded-md bg-foreground/10' />
            <View className='h-3 w-12 rounded-md bg-foreground/8' />
          </View>
          <View className='h-3.5 w-[78%] rounded-md bg-foreground/10' />
          <View className='h-3 w-full rounded-md bg-foreground/8' />
          <View className='h-3 w-[62%] rounded-md bg-foreground/8' />
        </View>
      </View>
    </View>
  );
});

type TicketsListSkeletonProps = {
  rowCount?: number;
};

/**
 * Email-row shaped placeholders — same geometry as ticket list / search rows.
 */
export const TicketsListSkeleton = memo(function TicketsListSkeleton({
  rowCount = DEFAULT_ROW_COUNT,
}: TicketsListSkeletonProps) {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.55, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(pulse);
    };
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={animatedStyle} accessibilityLabel='Loading tickets'>
      {Array.from({ length: rowCount }, (_, index) => (
        <SkeletonRow key={index} />
      ))}
    </Animated.View>
  );
});
