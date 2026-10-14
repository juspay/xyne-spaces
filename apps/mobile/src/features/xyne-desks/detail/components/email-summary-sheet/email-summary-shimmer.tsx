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

const BULLET_WIDTHS = ['100%', '83%', '66%'] as const;

/**
 * Text-shaped pulse placeholders while the email-thread summary loads.
 */
export const EmailSummaryShimmer = memo(function EmailSummaryShimmer() {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.45, { duration: 850, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(pulse);
    };
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={animatedStyle} accessibilityLabel='Generating AI summary'>
      <View className='gap-2'>
        <View className='h-3.5 w-full rounded-md bg-foreground/10' />
        <View className='h-3.5 w-3/4 rounded-md bg-foreground/10' />
      </View>

      <View className='mt-5 gap-3'>
        {BULLET_WIDTHS.map((width, index) => (
          <View key={index} className='flex-row items-center gap-2.5'>
            <View className='size-1.25 shrink-0 rounded-full bg-foreground/20' />
            <View className='h-3.5 rounded-md bg-foreground/8' style={{ width }} />
          </View>
        ))}
      </View>
    </Animated.View>
  );
});
