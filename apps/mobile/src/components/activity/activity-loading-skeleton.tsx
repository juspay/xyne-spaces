import { useEffect, type ReactElement } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const LoadingRow = ({ compact = false }: { compact?: boolean }): ReactElement => (
  <View className='px-4 pt-2'>
    <View className='flex-row items-start gap-2 pb-2'>
      <View className='h-7 w-7 rounded-full bg-foreground/8' />
      <View className='flex-1 gap-2'>
        <View className='h-8 w-8 rounded-lg bg-foreground/10' />
        <View className='flex-row items-start justify-between gap-2'>
          <View className='flex-1 gap-1.5'>
            <View className='h-3.5 w-4/5 rounded-md bg-foreground/10' />
            <View className='h-3.5 w-1/2 rounded-md bg-foreground/8' />
          </View>
          <View className='mt-0.5 h-3 w-10 rounded-md bg-foreground/8' />
        </View>
        <View className='gap-1.5 pt-0.5'>
          <View className='h-3.5 rounded-md bg-foreground/8' />
          {!compact ? <View className='h-3.5 w-3/4 rounded-md bg-foreground/8' /> : null}
        </View>
      </View>
    </View>
  </View>
);

type ActivityLoadingSkeletonProps = {
  rows?: number;
  minHeight?: number;
};

export const ActivityLoadingSkeleton = ({
  rows = 1,
  minHeight,
}: ActivityLoadingSkeletonProps): ReactElement => {
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
  const rowCount = Math.max(1, Math.floor(rows));
  const skeletonRows = Array.from({ length: rowCount }, (_, index) => {
    const compact = index !== rowCount - 1;
    return <LoadingRow key={index} compact={compact} />;
  });

  return (
    <Animated.View
      style={[animatedStyle, minHeight ? { minHeight } : null]}
      accessibilityLabel='Loading more activity'
    >
      {skeletonRows}
    </Animated.View>
  );
};
