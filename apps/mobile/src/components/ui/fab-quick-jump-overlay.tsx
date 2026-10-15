import { memo, useCallback, useEffect, type ReactElement, type ReactNode } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { FabOverlayBackdrop } from './fab-overlay-backdrop';
import { haptics } from '@/src/utils/haptics';
import { FAB_RIGHT, FAB_SIZE } from '@/src/components/chat/channel-list/channel-list-layout';

/**
 * The overlay a floating action button springs on long press — the starred
 * channels on the Channels tab, the starred conversations on DMs.
 *
 * Both tabs render *this*, rather than each keeping its own copy: the two are
 * meant to be the same control with different contents, and the only way that
 * stays true is for the geometry, the cascade and the backdrop to have one
 * home. Callers supply the rows and the token drawn on each — a contact's
 * avatar, a channel's glyph — and nothing else about the surface is theirs to
 * vary.
 */

/** Circular token at the right rail, centred on the button below it. */
export const QUICK_JUMP_TOKEN_SIZE = 46;

const ROW_HEIGHT = 64;
const NAME_GAP = 14;
/** Air between the button and the stack above it. */
const STACK_GAP = 18;
/** Left-edge margin long names may never cross. */
const SCREEN_GUTTER = 24;
/** Rows shown before the stack scrolls; the cap lands on a whole row. */
const MAX_VISIBLE_ROWS = 8;
/** Space kept clear at the top so the stack never collides with the header. */
const TOP_RESERVE = 150;

const PILL_HEIGHT = 44;
const PILL_GAP_FROM_FAB = 12;

/**
 * Master-progress window per row: the row nearest the button leads and each
 * row above trails by one step, which is what reads as the upward cascade.
 */
const ROW_STAGGER_STEP = 0.055;
const ROW_ANIM_SPAN = 0.45;

export type QuickJumpItem = {
  id: string;
  label: string;
  /** Drawn in the circular token — an avatar, a channel glyph. */
  token: ReactNode;
  /** Shows the unread dot ahead of the label. */
  hasUnread?: boolean;
};

type FabQuickJumpOverlayProps = {
  items: readonly QuickJumpItem[];
  /** 0 → 1 open progress, shared with the button's own animation. */
  progress: SharedValue<number>;
  /** Distance from the screen bottom to the button this springs from. */
  bottomOffset: number;
  /** Label of the pill beside the button — the tab's own create action. */
  pillLabel: string;
  /** Background of that pill, so it reads as a solid chip over the blur. */
  pillBackgroundColor: string;
  onPillPress: () => void;
  onItemPress: (id: string) => void;
  onDismiss: () => void;
  dismissAccessibilityLabel: string;
};

function FabQuickJumpOverlayComponent({
  items,
  progress,
  bottomOffset,
  pillLabel,
  pillBackgroundColor,
  onPillPress,
  onItemPress,
  onDismiss,
  dismissAccessibilityLabel,
}: FabQuickJumpOverlayProps): ReactElement {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();

  const stackBottom = bottomOffset + FAB_SIZE + STACK_GAP;
  // Token centres line up with the button's centre, as one right-edge rail.
  const rowsRight = FAB_RIGHT + (FAB_SIZE - QUICK_JUMP_TOKEN_SIZE) / 2;
  // Names can run long — cap them so a row never crosses the screen's left
  // edge; the text truncates with an ellipsis instead.
  const nameMaxWidth = windowWidth - rowsRight - QUICK_JUMP_TOKEN_SIZE - NAME_GAP - SCREEN_GUTTER;

  /**
   * Short screens show fewer rows rather than running into the header, and the
   * height always lands on a whole row — the rest is a scroll away.
   */
  const availableHeight = windowHeight - stackBottom - TOP_RESERVE;
  const visibleRowCount = Math.max(
    1,
    Math.min(MAX_VISIBLE_ROWS, Math.floor(availableHeight / ROW_HEIGHT), items.length),
  );
  const stackMaxHeight = visibleRowCount * ROW_HEIGHT;

  const pillStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.15, 0.5], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateX: interpolate(progress.value, [0.15, 0.6], [18, 0], Extrapolation.CLAMP) },
      { scale: interpolate(progress.value, [0.15, 0.6], [0.6, 1], Extrapolation.CLAMP) },
    ],
  }));

  // Android's back gesture closes the overlay rather than leaving the tab —
  // the same contract the app's bottom sheets keep.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });
    return (): void => subscription.remove();
  }, [onDismiss]);

  const handleItemPress = useCallback(
    (id: string) => {
      void haptics.buttonTap();
      onItemPress(id);
    },
    [onItemPress],
  );

  const handlePillPress = useCallback(() => {
    void haptics.buttonTap();
    onPillPress();
  }, [onPillPress]);

  return (
    <View pointerEvents='box-none' style={StyleSheet.absoluteFill}>
      <FabOverlayBackdrop
        progress={progress}
        onDismiss={onDismiss}
        accessibilityLabel={dismissAccessibilityLabel}
      />

      <View
        pointerEvents='box-none'
        style={[styles.stack, { bottom: stackBottom, right: rowsRight }]}
      >
        <ScrollView
          style={{ maxHeight: stackMaxHeight }}
          contentContainerStyle={styles.stackContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps='handled'
          bounces={false}
          overScrollMode='never'
        >
          {items.map((item, index) => (
            <QuickJumpRow
              key={item.id}
              item={item}
              indexFromBottom={items.length - 1 - index}
              progress={progress}
              nameMaxWidth={nameMaxWidth}
              onPress={handleItemPress}
            />
          ))}
        </ScrollView>
      </View>

      <Animated.View
        style={[
          styles.pill,
          {
            bottom: bottomOffset + (FAB_SIZE - PILL_HEIGHT) / 2,
            right: FAB_RIGHT + FAB_SIZE + PILL_GAP_FROM_FAB,
            backgroundColor: pillBackgroundColor,
          },
          pillStyle,
        ]}
      >
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={pillLabel}
          onPress={handlePillPress}
          className='flex-1 items-center justify-center px-5 active:opacity-70'
        >
          <Text className='text-[15px] font-semibold text-foreground'>{pillLabel}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

type QuickJumpRowProps = {
  item: QuickJumpItem;
  /** 0 = the row hugging the button; grows upward. Drives the stagger window. */
  indexFromBottom: number;
  progress: SharedValue<number>;
  nameMaxWidth: number;
  onPress: (id: string) => void;
};

const QuickJumpRow = memo(function QuickJumpRow({
  item,
  indexFromBottom,
  progress,
  nameMaxWidth,
  onPress,
}: QuickJumpRowProps): ReactElement {
  /**
   * One stagger window drives both faces: the token springs up inside it, the
   * name trails in over its second half.
   *
   * Both styles derive the window from the shared master progress rather than
   * from a per-row `useDerivedValue`. A derived value is another shared value
   * allocated per row and read by these styles, and the rows unmount while the
   * close animation is still running — one owner for the animation state keeps
   * that teardown from racing.
   */
  const rowProgress = (value: number): number => {
    'worklet';
    const start = indexFromBottom * ROW_STAGGER_STEP;
    return interpolate(value, [start, start + ROW_ANIM_SPAN], [0, 1], Extrapolation.CLAMP);
  };

  const tokenStyle = useAnimatedStyle(() => {
    const rowValue = rowProgress(progress.value);
    return {
      opacity: rowValue,
      transform: [
        { translateY: interpolate(rowValue, [0, 1], [32, 0]) },
        { scale: interpolate(rowValue, [0, 1], [0.5, 1]) },
      ],
    };
  });

  const nameStyle = useAnimatedStyle(() => {
    const rowValue = rowProgress(progress.value);
    return {
      opacity: interpolate(rowValue, [0.35, 1], [0, 1], Extrapolation.CLAMP),
      transform: [{ translateX: interpolate(rowValue, [0.35, 1], [10, 0], Extrapolation.CLAMP) }],
    };
  });

  const handlePress = useCallback(() => {
    onPress(item.id);
  }, [item.id, onPress]);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={item.label}
      onPress={handlePress}
      hitSlop={6}
      className='flex-row items-center justify-end active:opacity-60'
      style={styles.row}
    >
      <Animated.View style={[nameStyle, styles.nameRow, { maxWidth: nameMaxWidth }]}>
        {item.hasUnread ? <View className='size-2 rounded-full bg-green-500 mr-2' /> : null}
        <Text
          numberOfLines={1}
          ellipsizeMode='tail'
          className='text-[17px] font-semibold text-white shrink'
        >
          {item.label}
        </Text>
      </Animated.View>

      <View style={{ width: NAME_GAP }} />

      <Animated.View style={[tokenStyle, styles.token]}>{item.token}</Animated.View>
    </Pressable>
  );
});

export const FabQuickJumpOverlay = memo(FabQuickJumpOverlayComponent);

const styles = StyleSheet.create({
  stack: {
    position: 'absolute',
    alignItems: 'flex-end',
  },
  stackContent: {
    alignItems: 'flex-end',
  },
  row: {
    height: ROW_HEIGHT,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  token: {
    width: QUICK_JUMP_TOKEN_SIZE,
    height: QUICK_JUMP_TOKEN_SIZE,
    borderRadius: QUICK_JUMP_TOKEN_SIZE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    position: 'absolute',
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    overflow: 'hidden',
  },
});
