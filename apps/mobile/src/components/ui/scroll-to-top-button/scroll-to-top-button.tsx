import { ArrowUp } from 'lucide-react-native';
import { type ReactElement } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';

/** Scroll distance, in points, before the button is offered. */
export const SCROLL_TO_TOP_THRESHOLD = 600;

const ON_ACCENT = '#ffffff';
const ICON_SIZE = 16;
const ENTER_MS = 180;
const EXIT_MS = 140;
const HIDDEN_TRANSLATE_Y = -12;
const HIDDEN_SCALE = 0.9;

type ScrollToTopButtonProps = {
  /**
   * The list's vertical scroll offset, written on the UI thread by the list.
   * The button reads it only from worklets, so scrolling never renders it.
   */
  offset: SharedValue<number>;
  onPress: () => void;
  /** Offset past which the button shows. */
  threshold?: number;
};

/**
 * A "Top" pill that fades in under the header once a list has been scrolled
 * well down, and takes the person back to the start.
 *
 * Visibility is entirely a Reanimated concern: a reaction on the offset flips
 * a progress value only when the threshold is crossed, and that value drives
 * opacity, transform and pointer events on the UI thread. The JS thread is
 * involved once, on press.
 *
 * Place it as a sibling after the list inside a `flex-1` container; it
 * positions itself at the top center.
 */
export function ScrollToTopButton({
  offset,
  onPress,
  threshold = SCROLL_TO_TOP_THRESHOLD,
}: ScrollToTopButtonProps): ReactElement {
  const accent = useCSSVariable('--color-spaces-accent') as string;
  const progress = useSharedValue(0);

  useAnimatedReaction(
    () => offset.value > threshold,
    (isPast, wasPast) => {
      if (isPast === wasPast) return;
      progress.value = withTiming(isPast ? 1 : 0, { duration: isPast ? ENTER_MS : EXIT_MS });
    },
    [threshold],
  );

  const containerStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * HIDDEN_TRANSLATE_Y },
      { scale: HIDDEN_SCALE + (1 - HIDDEN_SCALE) * progress.value },
    ],
  }));

  // A hidden button must not swallow touches meant for the rows beneath it.
  const containerProps = useAnimatedProps(() => ({
    pointerEvents: progress.value > 0.5 ? ('box-none' as const) : ('none' as const),
  }));

  return (
    <Animated.View style={[styles.container, containerStyle]} animatedProps={containerProps}>
      <Pressable
        onPress={onPress}
        hitSlop={8}
        accessibilityRole='button'
        accessibilityLabel='Scroll to top'
        style={({ pressed }) => [
          styles.pill,
          { backgroundColor: accent, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <ArrowUp size={ICON_SIZE} color={ON_ACCENT} strokeWidth={2.5} />
        <Text style={[styles.label, { color: ON_ACCENT }]}>Top</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  label: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
  },
});
