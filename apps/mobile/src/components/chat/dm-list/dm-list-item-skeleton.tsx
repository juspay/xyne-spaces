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

const DmListItemSkeletonRow = (): ReactElement => (
  <View className='flex-row items-center px-3 py-[10px]'>
    {/* Avatar — matches DmListItem AVATAR_SIZE = 48 */}
    <View className='h-12 w-12 rounded-md bg-foreground/10' />
    <View className='flex-1 min-w-0 ml-3'>
      {/* Name + timestamp row */}
      <View className='flex-row items-start justify-between gap-2'>
        <View className='h-4 flex-1 max-w-[65%] rounded-md bg-foreground/10' />
        <View className='h-3 w-10 shrink-0 rounded-md bg-foreground/8' />
      </View>
      {/* Preview + badge row */}
      <View className='mt-2 flex-row items-center justify-between gap-2'>
        <View className='h-3.5 flex-1 max-w-[75%] rounded-md bg-foreground/8' />
        <View className='h-4 w-4 shrink-0 rounded-full bg-foreground/8' />
      </View>
    </View>
  </View>
);

type DmListLoadingSkeletonProps = {
  rows?: number;
};

export const DmListLoadingSkeleton = ({ rows = 2 }: DmListLoadingSkeletonProps): ReactElement => {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.55, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const rowCount = Math.max(1, Math.floor(rows));

  return (
    <Animated.View style={animatedStyle} accessibilityLabel='Loading more conversations'>
      {Array.from({ length: rowCount }, (_, index) => (
        <DmListItemSkeletonRow key={index} />
      ))}
    </Animated.View>
  );
};
