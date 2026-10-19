import { useEffect, useRef, useState, type ComponentType, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { scheduleOnRN } from 'react-native-worklets';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';

const PADDING = 4;
const HEIGHT = 40;

/**
 * Duration-based, so the indicator arrives — and `onSettled` fires — when it
 * says it will, rather than when a physical spring finally creeps inside its
 * rest thresholds. A little under-damped, so it lands with a hint of life.
 */
const SPRING = { duration: 260, dampingRatio: 0.85 } as const;

export type SegmentedControlOption<Id extends string> = {
  id: Id;
  label: string;
  /**
   * Drawn before the label; told whether its segment is the chosen one. A
   * component, not a render function, so it may use hooks of its own.
   */
  icon?: ComponentType<{ active: boolean }>;
};

/** Colours, as class names, for a surface other than the Spaces one. */
export type SegmentedControlClassNames = {
  track: string;
  indicator: string;
  activeLabel: string;
  inactiveLabel: string;
};

const SPACES_CLASS_NAMES: SegmentedControlClassNames = {
  track: 'bg-spaces-surface',
  indicator: 'bg-spaces-background',
  activeLabel: 'text-spaces-foreground',
  inactiveLabel: 'text-spaces-muted',
};

export type SegmentedControlProps<Id extends string> = {
  options: readonly SegmentedControlOption<Id>[];
  value: Id;
  onValueChange: (id: Id) => void;
  accessibilityLabel: string;
  /** Called after the indicator has come to rest. */
  onSettled?: () => void;
  /** Defaults to the Spaces colours. */
  classNames?: SegmentedControlClassNames;
};

/**
 * Equal-width choices in one pill, with a raised indicator that slides to the
 * chosen one.
 *
 * Segments share the width equally, so the indicator's size and position are
 * arithmetic on the container's width and the selected index — no per-segment
 * measurement and no layout state beyond that one width. The slide is a spring
 * on a shared value and runs on the UI thread.
 *
 * Controlled; the index is derived from `value`, so a change from elsewhere
 * slides the indicator exactly as a tap does.
 *
 * `onSettled` fires once the indicator has come to rest (and not if another
 * press interrupted it) — for a parent that has expensive work to do about the
 * change and would rather do it after the control has finished moving.
 */
export function SegmentedControl<Id extends string>({
  options,
  value,
  onValueChange,
  accessibilityLabel,
  onSettled,
  classNames = SPACES_CLASS_NAMES,
}: SegmentedControlProps<Id>): ReactElement {
  const [width, setWidth] = useState(0);
  const selectedIndex = Math.max(
    0,
    options.findIndex(option => option.id === value),
  );

  const segmentWidth = width > 0 ? (width - PADDING * 2) / options.length : 0;

  // Where the indicator is now, in index units. It starts on the selection and
  // springs toward later ones; the style only reads it, so a frame of the
  // spring never restarts the spring.
  const position = useSharedValue(selectedIndex);
  const hasPlaced = useRef(false);

  useEffect(() => {
    if (segmentWidth === 0) return;
    if (!hasPlaced.current) {
      // First time a width is known: already in place, nothing to animate.
      hasPlaced.current = true;
      position.set(selectedIndex);
      return;
    }
    position.set(
      withSpring(selectedIndex, SPRING, finished => {
        if (finished && onSettled !== undefined) scheduleOnRN(onSettled);
      }),
    );
  }, [onSettled, position, segmentWidth, selectedIndex]);

  const onLayout = (event: LayoutChangeEvent): void => {
    setWidth(event.nativeEvent.layout.width);
  };

  const indicatorStyle = useAnimatedStyle(() => ({
    width: segmentWidth,
    transform: [{ translateX: position.get() * segmentWidth }],
    opacity: segmentWidth > 0 ? 1 : 0,
  }));

  return (
    <View
      accessibilityRole='tablist'
      accessibilityLabel={accessibilityLabel}
      onLayout={onLayout}
      className={cn('flex-row rounded-full', classNames.track)}
      style={{ padding: PADDING }}
    >
      <Animated.View
        pointerEvents='none'
        className={cn('absolute rounded-full', classNames.indicator)}
        style={[styles.indicator, indicatorStyle]}
      />

      {options.map(option => {
        const active = option.id === value;
        const Icon = option.icon;
        return (
          <Pressable
            key={option.id}
            accessibilityRole='tab'
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (active) return;
              void haptics.selection();
              onValueChange(option.id);
            }}
            className='flex-1 flex-row items-center justify-center gap-1.5 rounded-full'
            style={{ height: HEIGHT }}
          >
            {Icon !== undefined ? <Icon active={active} /> : null}
            <Text
              numberOfLines={1}
              className={cn(
                'text-[15px] font-medium',
                active ? classNames.activeLabel : classNames.inactiveLabel,
              )}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  indicator: {
    top: PADDING,
    left: PADDING,
    height: HEIGHT,
    boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.12)',
  },
});
