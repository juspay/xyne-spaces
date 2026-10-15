import { memo, useEffect, type ReactElement } from 'react';
import { View, type DimensionValue } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/** Same 5-section shape as the web's BriefSkeleton (label + line widths). */
const SKELETON_SECTIONS: Array<{ label: number; lines: DimensionValue[] }> = [
  { label: 104, lines: ['100%', '92%', '64%'] },
  { label: 62, lines: ['100%', '78%'] },
  { label: 116, lines: ['100%', '88%', '54%'] },
  { label: 98, lines: ['86%', '46%'] },
  { label: 110, lines: ['70%', '58%'] },
];

/**
 * Text-shaped pulse placeholders while a brief loads or generates. Follows the
 * app's shimmer pattern (email-summary-shimmer.tsx): one Reanimated opacity
 * pulse over token-tinted bars.
 */
export const BriefSkeleton = memo(function BriefSkeleton(): ReactElement {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.45, { duration: 850, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return (): void => {
      cancelAnimation(pulse);
    };
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={animatedStyle} accessibilityLabel='Loading brief' className='gap-9'>
      <View className='my-4 h-[38px] w-[220px] self-center rounded-lg bg-foreground/10' />
      {SKELETON_SECTIONS.map((section, sectionIndex) => (
        <View key={sectionIndex}>
          <View className='h-[18px] rounded-md bg-foreground/10' style={{ width: section.label }} />
          <View className='mt-3 gap-3'>
            {section.lines.map((width, lineIndex) => (
              <View key={lineIndex} className='w-full flex-row items-center gap-3'>
                <View className='h-[22px] w-[22px] shrink-0 items-center justify-center'>
                  <View className='h-1.5 w-1.5 rounded-full bg-foreground/20' />
                </View>
                <View className='h-[18px] rounded-md bg-foreground/8' style={{ width }} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </Animated.View>
  );
});
