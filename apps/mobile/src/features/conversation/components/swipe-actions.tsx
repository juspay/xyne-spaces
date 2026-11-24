import { memo, useCallback, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { CornerDownRight } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { Spark4Icon } from '@/src/components/icons';
import { useLatestRef } from '@/src/components/input-composer/utils/use-latest-ref';
import { withAlpha } from '@/src/utils/color';
import { haptics } from '@/src/utils/haptics';

import {
  SWIPE_ACTIVATION_X,
  SWIPE_ARM_MS,
  SWIPE_ASK_AI_GAP,
  SWIPE_ASK_AI_HEIGHT,
  SWIPE_ASK_AI_ICON_SIZE,
  SWIPE_ASK_AI_INSET_RIGHT,
  SWIPE_ASK_AI_PADDING_LEFT,
  SWIPE_ASK_AI_PADDING_RIGHT,
  SWIPE_ASK_AI_TINT_OPACITY,
  SWIPE_EDGE_EXCLUSION,
  SWIPE_FAIL_Y,
  SWIPE_REPLY_ICON_SIZE,
  SWIPE_REPLY_INSET_LEFT,
  SWIPE_REPLY_SIZE,
  SWIPE_REVEAL_SCALE,
} from '../constants';
import {
  swipeAffordanceTop,
  swipeCommitAction,
  swipeOffset,
  swipeReveal,
  type SwipeActionId,
  type SwipeDirections,
} from '../model/swipe-actions';
import { colorOf } from '../model/token-color';
import { useConversationRowBackground } from './conversation-palette';

const ARM_TIMING = {
  duration: SWIPE_ARM_MS,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;
/** Critically damped enough not to bounce past the rest position, quick enough to feel snapped. */
const SETTLE_SPRING = {
  stiffness: 500,
  damping: 40,
  mass: 1,
  reduceMotion: ReduceMotion.System,
} as const;
/** The reply icon's opacity before the drag reaches the threshold. */
const REPLY_ICON_IDLE_OPACITY = 0.4;

type SwipeActionsProps = {
  directions: SwipeDirections;
  onCommit: (action: SwipeActionId) => void;
  /** Set once the row's hold menu has taken the touch; the drag then leaves the row alone. */
  held: SharedValue<boolean>;
  isContinuation: boolean;
  children: ReactNode;
};

/**
 * Figma "Room / Swipe action": drag a message right to reply in its thread,
 * left to ask AI about it. The row follows the finger on the UI thread, resists
 * past each threshold and springs back on release; crossing a threshold ticks
 * and arms the action, and releasing armed runs it.
 *
 * The affordances behind the row mount only while it is being swiped, and the
 * row's own content never re-renders during a drag.
 */
export const SwipeActions = memo(function SwipeActions({
  directions,
  onCommit,
  held,
  isContinuation,
  children,
}: SwipeActionsProps): ReactElement {
  const offset = useSharedValue(0);
  const armed = useSharedValue(0);
  const armedAction = useSharedValue<SwipeActionId | null>(null);
  const engaged = useSharedValue(false);
  const [active, setActive] = useState(false);
  const rowBackground = useConversationRowBackground();

  const tick = useCallback((): void => void haptics.selection(), []);
  // Read through a ref, so a row update (a reaction, a read state) never rebuilds the gesture mid-drag.
  const onCommitRef = useLatestRef(onCommit);
  const commit = useCallback(
    (action: SwipeActionId): void => onCommitRef.current(action),
    [onCommitRef],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(directions.reply || directions.askAI)
        .activeOffsetX([-SWIPE_ACTIVATION_X, SWIPE_ACTIVATION_X])
        .failOffsetY([-SWIPE_FAIL_Y, SWIPE_FAIL_Y])
        // Touches that start by the left edge belong to the system back gesture.
        .hitSlop({ left: -SWIPE_EDGE_EXCLUSION })
        .onBegin(() => {
          held.set(false);
        })
        .onStart(() => {
          if (held.get()) return;
          cancelAnimation(offset);
          engaged.set(true);
          scheduleOnRN(setActive, true);
        })
        .onUpdate(event => {
          if (!engaged.get() || held.get()) return;
          const next = swipeOffset(event.translationX, directions);
          offset.set(next);
          const action = swipeCommitAction(next);
          if (action === armedAction.get()) return;
          armedAction.set(action);
          armed.set(withTiming(action ? 1 : 0, ARM_TIMING));
          if (action) scheduleOnRN(tick);
        })
        .onEnd((_event, success) => {
          // A cancelled drag (the system took the touch) never runs its action.
          const action = armedAction.get();
          if (success && engaged.get() && action && !held.get()) scheduleOnRN(commit, action);
        })
        .onFinalize(() => {
          if (!engaged.get()) return;
          engaged.set(false);
          armedAction.set(null);
          armed.set(withTiming(0, ARM_TIMING));
          offset.set(
            withSpring(0, SETTLE_SPRING, finished => {
              if (finished) scheduleOnRN(setActive, false);
            }),
          );
        }),
    [armed, armedAction, commit, directions, engaged, held, offset, tick],
  );

  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));

  return (
    <GestureDetector gesture={pan}>
      <View collapsable={false}>
        {active ? (
          <View
            pointerEvents='none'
            accessibilityElementsHidden
            importantForAccessibility='no-hide-descendants'
            style={StyleSheet.absoluteFill}
          >
            {directions.reply ? (
              <ReplyAffordance offset={offset} armed={armed} isContinuation={isContinuation} />
            ) : null}
            {directions.askAI ? (
              <AskAIAffordance offset={offset} armed={armed} isContinuation={isContinuation} />
            ) : null}
          </View>
        ) : null}
        {/* Opaque while swiped, so only the space the row leaves uncovers the affordances. */}
        <Animated.View
          style={[
            contentStyle,
            active && rowBackground ? { backgroundColor: rowBackground } : null,
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  );
});

type AffordanceProps = {
  offset: SharedValue<number>;
  armed: SharedValue<number>;
  isContinuation: boolean;
};

/** Figma 11 "Swipe to reply": a grey circle with the thread icon, uncovered on the left. */
function ReplyAffordance({ offset, armed, isContinuation }: AffordanceProps): ReactElement {
  const foreground = colorOf(useCSSVariable('--color-spaces-foreground'));
  const top = swipeAffordanceTop(isContinuation, SWIPE_REPLY_SIZE);

  const circleStyle = useAnimatedStyle(() => {
    const reveal = swipeReveal(offset.get(), 'reply-in-thread');
    return {
      opacity: reveal,
      transform: [{ scale: SWIPE_REVEAL_SCALE + (1 - SWIPE_REVEAL_SCALE) * reveal }],
    };
  });
  const iconStyle = useAnimatedStyle(() => ({
    opacity: REPLY_ICON_IDLE_OPACITY + (1 - REPLY_ICON_IDLE_OPACITY) * armed.get(),
  }));

  return (
    <Animated.View
      className='items-center justify-center bg-spaces-surface'
      style={[styles.reply, { top }, circleStyle]}
    >
      <Animated.View style={iconStyle}>
        <CornerDownRight size={SWIPE_REPLY_ICON_SIZE} color={foreground} />
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Figma 12 "Swipe to Ask AI": a coral-tint pill uncovered on the right, solid
 * once the drag is all the way across.
 */
function AskAIAffordance({ offset, armed, isContinuation }: AffordanceProps): ReactElement {
  const accent = colorOf(useCSSVariable('--color-spaces-accent'));
  const onAccent = colorOf(useCSSVariable('--color-spaces-accent-foreground'));
  const tint = withAlpha(accent, SWIPE_ASK_AI_TINT_OPACITY);
  const top = swipeAffordanceTop(isContinuation, SWIPE_ASK_AI_HEIGHT);

  const pillStyle = useAnimatedStyle(() => {
    const reveal = swipeReveal(offset.get(), 'ask-ai');
    return {
      opacity: reveal,
      transform: [{ scale: SWIPE_REVEAL_SCALE + (1 - SWIPE_REVEAL_SCALE) * reveal }],
      backgroundColor: interpolateColor(armed.get(), [0, 1], [tint, accent]),
    };
  }, [accent, tint]);
  // The spark is a stroked SVG, so the solid state's white label cross-fades over the coral one.
  const solidLabelStyle = useAnimatedStyle(() => ({ opacity: armed.get() }));

  return (
    <Animated.View style={[styles.pill, { top }, pillStyle]}>
      <AskAILabel color={accent} />
      <Animated.View style={[styles.pillOverlay, solidLabelStyle]}>
        <AskAILabel color={onAccent} />
      </Animated.View>
    </Animated.View>
  );
}

function AskAILabel({ color }: { color: string }): ReactElement {
  return (
    <>
      <Spark4Icon size={SWIPE_ASK_AI_ICON_SIZE} color={color} />
      <Text
        className='text-[14px] font-medium leading-[18px] tracking-[-0.07px]'
        style={{ color }}
        numberOfLines={1}
      >
        Ask AI
      </Text>
    </>
  );
}

const PILL_ROW = {
  flexDirection: 'row',
  alignItems: 'center',
  paddingLeft: SWIPE_ASK_AI_PADDING_LEFT,
  paddingRight: SWIPE_ASK_AI_PADDING_RIGHT,
  columnGap: SWIPE_ASK_AI_GAP,
} as const;

const styles = StyleSheet.create({
  reply: {
    position: 'absolute',
    left: SWIPE_REPLY_INSET_LEFT,
    width: SWIPE_REPLY_SIZE,
    height: SWIPE_REPLY_SIZE,
    borderRadius: SWIPE_REPLY_SIZE / 2,
  },
  pill: {
    ...PILL_ROW,
    position: 'absolute',
    right: SWIPE_ASK_AI_INSET_RIGHT,
    height: SWIPE_ASK_AI_HEIGHT,
    borderRadius: SWIPE_ASK_AI_HEIGHT / 2,
  },
  pillOverlay: { ...PILL_ROW, ...StyleSheet.absoluteFill },
});
