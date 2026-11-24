import { useEffect, useRef, type ReactElement } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useCSSVariable } from 'uniwind';

import { haptics } from '@/src/utils/haptics';

const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 32;
const THUMB_SIZE = 26;
const INSET = (TRACK_HEIGHT - THUMB_SIZE) / 2;
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE - INSET * 2;
/** The conversation screens' Figma "Toggle": 40 × 24 with a 20 thumb. */
const COMPACT_TRACK_WIDTH = 40;
const COMPACT_TRACK_HEIGHT = 24;
const COMPACT_THUMB_SIZE = 20;
const COMPACT_INSET = (COMPACT_TRACK_HEIGHT - COMPACT_THUMB_SIZE) / 2;
const COMPACT_THUMB_TRAVEL = COMPACT_TRACK_WIDTH - COMPACT_THUMB_SIZE - COMPACT_INSET * 2;
const THUMB_COLOR = '#FFFFFF';

/**
 * Duration-based, so the slide ends — and `onSettled` fires — when it says it
 * will. A physical spring only reports "finished" once it has crept inside its
 * rest thresholds, which for a damped one is several times longer than the
 * motion the eye sees.
 */
const SPRING = { duration: 220, dampingRatio: 1 } as const;

export type SwitchProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** Called after the slide has come to rest. */
  onSettled?: () => void;
  /** `compact` is the 40 × 24 toggle; `regular` (the default) is 52 × 32. */
  size?: 'regular' | 'compact';
  /** The off track; the surface colour by default, which vanishes on a surface-coloured row. */
  offColor?: string;
};

/**
 * An on/off switch: a pill that fills with the theme accent and a white thumb
 * that slides across it.
 *
 * Controlled. The thumb and the fill are driven by one shared value, animated
 * toward `value` whenever it changes, on the UI thread, so a toggle from
 * elsewhere animates exactly like a tap.
 *
 * `onSettled` fires once the slide has come to rest (and not if a second tap
 * interrupted it). It is for the parent that has expensive work to do about
 * the change and would rather do it after the control has finished moving
 * than while it is.
 *
 * The spring and the thumb-and-track geometry follow the Discord switch in
 * the make-it-animated reference, minus its check/cross glyphs.
 */
export function Switch({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
  onSettled,
  size = 'regular',
  offColor: ownOffColor,
}: SwitchProps): ReactElement {
  const surfaceColor = useCSSVariable('--color-spaces-surface') as string;
  const offColor = ownOffColor ?? surfaceColor;
  const compact = size === 'compact';
  const thumbTravel = compact ? COMPACT_THUMB_TRAVEL : THUMB_TRAVEL;
  const onColor = useCSSVariable('--color-spaces-accent') as string;

  const progress = useSharedValue(value ? 1 : 0);

  const hasPlaced = useRef(false);
  useEffect(() => {
    const target = value ? 1 : 0;
    if (!hasPlaced.current) {
      // First render: already in place, nothing to settle.
      hasPlaced.current = true;
      return;
    }
    progress.set(
      withSpring(target, SPRING, finished => {
        if (finished && onSettled !== undefined) scheduleOnRN(onSettled);
      }),
    );
  }, [onSettled, progress, value]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.get(), [0, 1], [offColor, onColor]),
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.get() * thumbTravel }],
  }));

  return (
    <Pressable
      accessibilityRole='switch'
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => {
        void haptics.selection();
        onValueChange(!value);
      }}
      style={disabled ? styles.disabled : null}
    >
      <Animated.View style={[compact ? styles.compactTrack : styles.track, trackStyle]}>
        <Animated.View style={[compact ? styles.compactThumb : styles.thumb, thumbStyle]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    padding: INSET,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: THUMB_COLOR,
    boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.25)',
  },
  compactTrack: {
    width: COMPACT_TRACK_WIDTH,
    height: COMPACT_TRACK_HEIGHT,
    borderRadius: COMPACT_TRACK_HEIGHT / 2,
    padding: COMPACT_INSET,
  },
  compactThumb: {
    width: COMPACT_THUMB_SIZE,
    height: COMPACT_THUMB_SIZE,
    borderRadius: COMPACT_THUMB_SIZE / 2,
    backgroundColor: THUMB_COLOR,
    boxShadow: '0px 1px 2px rgba(18, 20, 28, 0.06), 0px 2px 6px rgba(18, 20, 28, 0.035)',
  },
  disabled: {
    opacity: 0.4,
  },
});
