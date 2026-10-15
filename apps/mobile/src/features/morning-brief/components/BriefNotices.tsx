import { useEffect, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { BRIEF_ORANGE } from './BriefSection';

/** Centered 13px muted notice line (stale brief / most-recent-brief banners). */
export function BriefNotice({
  children,
  color,
}: {
  children: string;
  color: string;
}): ReactElement {
  return (
    <Text className='mb-6 text-center text-[13px]' style={{ color }}>
      {children}
    </Text>
  );
}

/**
 * "Today's brief is generating… View" — shown while a generation runs and an
 * older brief is on screen. Pulsing orange dot + underlined View action.
 */
export function GeneratingElsewhereNotice({
  label,
  mutedColor,
  onView,
}: {
  label: string;
  mutedColor: string;
  onView: () => void;
}): ReactElement {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.35, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return (): void => {
      cancelAnimation(pulse);
    };
  }, [pulse]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Pressable
      onPress={onView}
      accessibilityRole='button'
      accessibilityLabel="View today's generating brief"
      className='mb-6 w-full flex-row items-center justify-center gap-2'
    >
      <Animated.View
        style={[dotStyle, { backgroundColor: BRIEF_ORANGE }]}
        className='h-1.5 w-1.5 rounded-full'
      />
      <Text className='text-[13px]' style={{ color: mutedColor }}>
        {label}
      </Text>
      <Text className='text-[13px] underline' style={{ color: mutedColor }}>
        View
      </Text>
    </Pressable>
  );
}

/** Inline error strip under the header — the web's red banner. */
export function BriefErrorBanner({ message }: { message: string }): ReactElement {
  return (
    <View className='border-b border-border bg-red-500/10 px-6 py-2'>
      <Text className='text-[13px] text-red-600'>{message}</Text>
    </View>
  );
}
