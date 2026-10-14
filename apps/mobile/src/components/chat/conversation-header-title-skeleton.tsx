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

type ConversationHeaderTitleSkeletonProps = {
  /** Thread pills have a "Thread" label above the conversation name. */
  showSubtitle?: boolean;
};

/**
 * Placeholder for the header title while visible channels / users have not been
 * published yet. Replaces the word "Unknown", which is reserved for a missing
 * row after those lists are ready.
 */
export const ConversationHeaderTitleSkeleton = ({
  showSubtitle = false,
}: ConversationHeaderTitleSkeletonProps): ReactElement => {
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
    <Animated.View
      style={animatedStyle}
      className='min-w-0 flex-1 flex-row items-center gap-2'
      accessibilityLabel='Loading conversation name'
    >
      <View className='size-5 rounded-md bg-foreground/10' />
      <View className='min-w-0 flex-1 justify-center gap-1.5'>
        {showSubtitle ? <View className='h-3.5 w-14 rounded-md bg-foreground/10' /> : null}
        <View className='h-3.5 w-[55%] max-w-[180px] rounded-md bg-foreground/10' />
      </View>
    </Animated.View>
  );
};
