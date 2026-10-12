import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AlertCircle } from 'lucide-react-native';
import Animated, {
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { withAlpha } from '@/src/theme/accent-contrast';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';

const COLOR_TIMING = { duration: 200 };
const SHAKE_STEP_MS = 70;

const AnimatedText = Animated.createAnimatedComponent(Text);
const AnimatedAlertCircle = Animated.createAnimatedComponent(AlertCircle);

interface BottomActionProps {
  label: string;
  enabled: boolean;
  isSubmitting: boolean;
  /** What is still missing, in order; the footer shows one and a tap on the button moves on. */
  blockers: string[];
  onPress: () => void;
}

/**
 * Primary action in the thumb zone, with the reason it is disabled as part of the footer: a quiet
 * line above the button. Tapping the greyed button turns that line amber, shakes it, and moves to
 * the next thing that is missing. Everything animates on the UI thread.
 */
export const BottomAction = ({
  label,
  enabled,
  isSubmitting,
  blockers,
  onPress,
}: BottomActionProps): ReactElement => {
  const insets = useSafeAreaInsets();
  const { accentBg, accentFg } = useBubbleAccent();
  const background = useCSSVariable('--color-settings-bg') as string;
  const idleBackground = useCSSVariable('--color-secondary') as string;
  const idleForeground = useCSSVariable('--color-secondary-foreground') as string;
  // Closest existing token to the prototype's amber: the settings palette's orange.
  const warning = useCSSVariable('--color-settings-icon-orange') as string;

  // Stays coloured while submitting so the button does not flash grey before the screen closes.
  const lit = enabled || isSubmitting;
  const litProgress = useSharedValue(lit ? 1 : 0);
  useEffect(() => {
    litProgress.set(withTiming(lit ? 1 : 0, COLOR_TIMING));
  }, [lit, litProgress]);

  const buttonStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(litProgress.get(), [0, 1], [idleBackground, accentBg]),
  }));
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(litProgress.get(), [0, 1], [idleForeground, accentFg]),
  }));

  // The reason line: visible while something blocks the action, amber once the user has tapped.
  const showReason = !lit && blockers.length > 0;
  const reasonProgress = useSharedValue(showReason ? 1 : 0);
  useEffect(() => {
    reasonProgress.set(withTiming(showReason ? 1 : 0, COLOR_TIMING));
  }, [reasonProgress, showReason]);

  const errorProgress = useSharedValue(0);
  const shake = useSharedValue(0);
  const tapped = useRef(false);
  const [index, setIndex] = useState(0);

  // Editing the form changes what is missing, so the amber state and the position start over.
  const blockersKey = blockers.join('|');
  useEffect(() => {
    tapped.current = false;
    setIndex(0);
    errorProgress.set(withTiming(0, COLOR_TIMING));
  }, [blockersKey, errorProgress]);

  const reasonStyle = useAnimatedStyle(() => ({
    opacity: reasonProgress.get(),
    transform: [{ translateX: shake.get() }],
  }));
  const reasonColor = useAnimatedStyle(() => ({
    color: interpolateColor(errorProgress.get(), [0, 1], [idleForeground, warning]),
  }));
  const iconProps = useAnimatedProps(() => ({
    color: interpolateColor(errorProgress.get(), [0, 1], [idleForeground, warning]),
  }));

  // Keep the last message while the line fades out, so it does not blank before it is gone.
  const lastReason = useRef('');
  const reason =
    blockers.length > 0 ? (blockers[index % blockers.length] ?? '') : lastReason.current;
  if (blockers.length > 0) lastReason.current = reason;

  const handlePress = useCallback((): void => {
    if (isSubmitting) return;
    if (enabled) {
      onPress();
      return;
    }
    void haptics.warning();
    if (tapped.current) setIndex(i => i + 1);
    tapped.current = true;
    errorProgress.set(withTiming(1, COLOR_TIMING));
    shake.set(
      withSequence(
        withTiming(-6, { duration: SHAKE_STEP_MS }),
        withTiming(6, { duration: SHAKE_STEP_MS }),
        withTiming(-4, { duration: SHAKE_STEP_MS }),
        withTiming(4, { duration: SHAKE_STEP_MS }),
        withTiming(0, { duration: SHAKE_STEP_MS }),
      ),
    );
  }, [enabled, errorProgress, isSubmitting, onPress, shake]);

  return (
    // The top padding is the fade zone: the gradient lives inside this view's own bounds (it is
    // solid by the middle), so content visibly dissolves well before it reaches the button.
    // `box-none` lets touches in that zone fall through to the form.
    <View className='absolute inset-x-0 bottom-0 pt-16' pointerEvents='box-none'>
      <LinearGradient
        colors={[withAlpha(background, 0), background]}
        locations={[0, 0.5]}
        pointerEvents='none'
        style={StyleSheet.absoluteFill}
      />
      {/* The bottom inset is a runtime value Tailwind cannot express here. */}
      <View className='px-4' style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        <Animated.View
          accessibilityLiveRegion='polite'
          className='flex-row items-center justify-center gap-1.5 pb-2'
          style={reasonStyle}
        >
          <AnimatedAlertCircle size={14} strokeWidth={2.2} animatedProps={iconProps} />
          <AnimatedText className='text-xs font-medium' style={reasonColor} numberOfLines={1}>
            {reason}
          </AnimatedText>
        </Animated.View>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={label}
          accessibilityState={{ disabled: !enabled, busy: isSubmitting }}
          onPress={handlePress}
          className='active:opacity-80'
        >
          <Animated.View
            className='h-12 flex-row items-center justify-center gap-2 rounded-full'
            style={buttonStyle}
          >
            {isSubmitting ? (
              <ActivityIndicator size='small' color={accentFg} />
            ) : (
              <AnimatedText className='text-base font-semibold' style={labelStyle}>
                {label}
              </AnimatedText>
            )}
          </Animated.View>
        </Pressable>
      </View>
    </View>
  );
};
