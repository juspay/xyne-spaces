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

const Bar = ({ widthPct, height = 12 }: { widthPct: number; height?: number }): ReactElement => (
  <View className='rounded-md bg-foreground/10' style={{ width: `${widthPct}%`, height }} />
);

const UserProfileSkeleton = (): ReactElement => {
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

  return (
    <Animated.View style={animatedStyle} className='gap-6 p-4' accessibilityLabel='Loading profile'>
      <View className='items-center gap-3'>
        <View className='w-40 h-40 rounded-xl bg-foreground/10' />
        <Bar widthPct={50} height={20} />
        <Bar widthPct={30} />
      </View>
      <View className='gap-3'>
        <Bar widthPct={25} />
        <Bar widthPct={70} />
        <Bar widthPct={60} />
      </View>
      <View className='gap-3'>
        <Bar widthPct={35} />
        <Bar widthPct={80} />
        <Bar widthPct={55} />
      </View>
    </Animated.View>
  );
};
UserProfileSkeleton.displayName = 'UserProfileSkeleton';

export { UserProfileSkeleton };
