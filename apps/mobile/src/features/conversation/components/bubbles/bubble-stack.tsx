import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  BackHandler,
  Platform,
  StyleSheet,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type FrameInfo,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { useRouter } from 'expo-router';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';

import { haptics } from '@/src/utils/haptics';

import {
  BUBBLE_BEHIND_MAX,
  BUBBLE_BEHIND_STEP,
  BUBBLE_BOTTOM_CLEARANCE,
  BUBBLE_CLOSE_BOTTOM,
  BUBBLE_CLOSE_HEIGHT,
  BUBBLE_EDGE_INSET,
  BUBBLE_FOLD_MS,
  BUBBLE_HEAD_STILL,
  BUBBLE_HOLD_MS,
  BUBBLE_LAND_TOP,
  BUBBLE_LIST_ENTER_MS,
  BUBBLE_LIST_EXIT_MS,
  BUBBLE_OPEN_GUARD_MS,
  BUBBLE_POP_SCALE,
  BUBBLE_SIZE,
  BUBBLE_SPRING,
  BUBBLE_TAB_HEIGHT,
  BUBBLE_TAB_PULL_DISTANCE,
  BUBBLE_TOAST_TOP_GAP,
  BUBBLE_TRAIL_FOLLOW,
} from '../../constants';
import {
  clearParked,
  dismissBubbleToast,
  unparkThread,
  type BubbleState,
} from '../../model/bubble-store';
import {
  RESTING,
  behindDirection,
  bubbleListPlacement,
  bubbleRestX,
  bubbleKeyboardLift,
  bubbleSettleSide,
  bubbleTuckSide,
  bubbleTuckedX,
  clampBubbleY,
  frameFollow,
  isOverCloseTarget,
  stepTrail,
  trailSettled,
  type BubbleListPlacement,
  type BubbleSide,
  type ParkedThread,
  type ScreenRect,
} from '../../model/bubbles';
import { fadeScaleTransition } from '../../model/fade-scale-transition';
import { floatingCardBottom } from '../../model/floating-card';
import { setThreadCardSource } from '../../model/thread-card-source-store';
import { THREAD_CARD_ROUTE } from '../../thread-route';
import { ConversationOverlayLayer } from '../conversation-overlay-layer';
import { BubbleAnswerToast } from './bubble-answer-toast';
import { BubbleBehind } from './bubble-behind';
import { BubbleCloseTarget } from './bubble-close-target';
import { BubbleEdgeTab } from './bubble-edge-tab';
import { BubbleList } from './bubble-list';
import { BubbleThread } from './bubble-thread';

const SPRING = { ...BUBBLE_SPRING, reduceMotion: ReduceMotion.System } as const;
const FOLD = { duration: BUBBLE_FOLD_MS, reduceMotion: ReduceMotion.System } as const;
/** The bubble pops in where it lands as the thread card collapses. */
const BUBBLE_TRANSITION = fadeScaleTransition({
  enterMs: BUBBLE_LIST_ENTER_MS,
  exitMs: BUBBLE_LIST_EXIT_MS,
  scale: BUBBLE_POP_SCALE,
});

/** The trail's resting shape: every card gathered one step past the bubble. */
function foldedTrail(x: number, y: number, direction: 1 | -1): number[] {
  'worklet';
  const trail: number[] = [];
  for (let depth = 0; depth < BUBBLE_BEHIND_MAX; depth += 1) {
    trail.push(x, y + BUBBLE_BEHIND_STEP * direction);
  }
  return trail;
}

type BubbleStackProps = {
  bubbles: BubbleState;
  /** False while the room is covered (a thread card, another screen): it hides but keeps its place. */
  visible: boolean;
};

/**
 * The parked threads floating over the room (Figma "Bubbles · park a
 * thread"): the newest thread's bubble with the rest behind it, dragged on
 * the UI thread with the rest trailing; let go it snaps to a side, past an
 * edge it tucks into a tab, and dropped on Close it puts everything down.
 * A tap opens the only thread, or lists them all; an agent's answer drops a
 * toast. Drawn in its own layer above the screens and the thread card.
 */
export function BubbleStack({ bubbles, visible }: BubbleStackProps): ReactElement {
  const { parked, agents, toast } = bubbles;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();

  const minY = insets.top + BUBBLE_EDGE_INSET;
  const maxY = height - insets.bottom - BUBBLE_BOTTOM_CLEARANCE - BUBBLE_SIZE;
  const closeBottom = floatingCardBottom(
    BUBBLE_CLOSE_BOTTOM,
    insets.bottom,
    Platform.OS === 'android',
  );

  // It lands top right; the stack stays mounted while anything is parked, so it keeps its place.
  const landY = Math.max(BUBBLE_LAND_TOP, minY);
  const x = useSharedValue(bubbleRestX('right', width));
  const y = useSharedValue(landY);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragging = useSharedValue(0);
  const holding = useSharedValue(0);
  const over = useSharedValue(0);
  const spread = useSharedValue(0);
  const closeShown = useSharedValue(0);
  const closeRect = useSharedValue<ScreenRect>({ x: 0, y: 0, width: 0, height: 0 });
  const trail = useSharedValue(
    foldedTrail(bubbleRestX('right', width), landY, behindDirection(landY, height)),
  );
  const [tucked, setTucked] = useState<BubbleSide | null>(null);
  const [list, setList] = useState<BubbleListPlacement | null>(null);

  // The cards behind chase the bubble frame by frame, only while something moves.
  const frameRef = useRef<ReturnType<typeof useFrameCallback> | null>(null);
  const setTrailActive = useCallback((active: boolean): void => {
    frameRef.current?.setActive(active);
  }, []);
  // Where the bubble was last frame: the trail stops only once the bubble has too.
  const lastHead = useSharedValue<[number, number]>([NaN, NaN]);
  const frame = useFrameCallback((info: FrameInfo) => {
    const [lastX, lastY] = lastHead.get();
    const headStill =
      Math.abs(x.get() - lastX) < BUBBLE_HEAD_STILL &&
      Math.abs(y.get() - lastY) < BUBBLE_HEAD_STILL;
    lastHead.set([x.get(), y.get()]);
    const direction = behindDirection(y.get(), height);
    const spreadOut = dragging.get() === 1;
    const follow = reducedMotion
      ? 1
      : frameFollow(BUBBLE_TRAIL_FOLLOW, info.timeSincePreviousFrame ?? 0);
    const next = stepTrail(trail.get(), x.get(), y.get(), direction, spreadOut, follow);
    trail.set(next);
    // A spring from a still finger barely moves on its first frame, so the trail
    // must not count as settled until the bubble itself is still.
    if (!spreadOut && headStill && trailSettled(next, foldedTrail(x.get(), y.get(), direction))) {
      scheduleOnRN(setTrailActive, false);
    }
  }, false);
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  const closeList = useCallback((): void => setList(null), []);

  // The card opens over wherever you are, as the bubbles float over every
  // screen; tapped straight from the bubble, it grows out of the bubble.
  const openedAtRef = useRef(0);
  const keyboard = useReanimatedKeyboardAnimation();
  const open = useCallback(
    (thread: ParkedThread, fromBubble: boolean): void => {
      const now = Date.now();
      if (now - openedAtRef.current < BUBBLE_OPEN_GUARD_MS) return;
      openedAtRef.current = now;
      setList(null);
      if (fromBubble) {
        // Where the bubble shows, lifted over the keyboard if it is up.
        setThreadCardSource({
          x: x.get(),
          y: y.get() + bubbleKeyboardLift(y.get(), height, -keyboard.height.get()),
          width: BUBBLE_SIZE,
          height: BUBBLE_SIZE,
          radius: BUBBLE_SIZE / 2,
        });
      }
      router.push({
        pathname: THREAD_CARD_ROUTE,
        params: {
          channelId: thread.channelId,
          threadId: thread.threadId,
          from: 'channel_thread',
          // Keeps it parked: collapsing the card puts it back in its bubble.
          bubble: '1',
          openStartedAtMs: String(now),
          ...(thread.surface ? { surface: thread.surface } : {}),
          ...(thread.scopeType ? { scopeType: thread.scopeType } : {}),
        },
      });
    },
    [router, x, y, height, keyboard],
  );

  const openFromList = useCallback((thread: ParkedThread): void => open(thread, false), [open]);

  const openById = useCallback(
    (threadId: string): void => {
      const thread = parked.find(entry => entry.threadId === threadId);
      if (thread) open(thread, false);
    },
    [open, parked],
  );

  const tapBubble = useCallback((): void => {
    void haptics.buttonTap();
    const [only] = parked;
    if (parked.length === 1 && only) {
      open(only, true);
      return;
    }
    setList(current =>
      current
        ? null
        : bubbleListPlacement(x.get(), y.get(), width, height, insets.top, insets.bottom),
    );
  }, [height, insets.bottom, insets.top, open, parked, width, x, y]);

  const putAllDown = useCallback((): void => {
    void haptics.success();
    setList(null);
    clearParked();
  }, []);

  const removeOne = useCallback((threadId: string): void => {
    void haptics.selection();
    unparkThread(threadId);
  }, []);

  const crossedClose = useCallback((): void => void haptics.selection(), []);
  const held = useCallback((): void => void haptics.longPress(), []);
  const settled = useCallback((): void => void haptics.gestureEnd(), []);

  const untuck = useCallback(
    (side: BubbleSide): void => {
      setTucked(null);
      setTrailActive(true);
      x.set(withSpring(bubbleRestX(side, width), SPRING));
    },
    [setTrailActive, width, x],
  );

  const bubbleGesture = useMemo(() => {
    const hold = Gesture.LongPress()
      .minDuration(BUBBLE_HOLD_MS)
      .maxDistance(Number.MAX_SAFE_INTEGER)
      .onStart(() => {
        holding.set(1);
        closeShown.set(1);
        scheduleOnRN(held);
      })
      .onFinalize(() => {
        holding.set(0);
        if (dragging.get() === 0) closeShown.set(0);
      });

    const drag = Gesture.Pan()
      .onStart(() => {
        dragX.set(x.get());
        dragY.set(y.get());
        dragging.set(1);
        closeShown.set(1);
        spread.set(withTiming(1, FOLD));
        scheduleOnRN(closeList);
        scheduleOnRN(setTrailActive, true);
      })
      .onUpdate(event => {
        x.set(dragX.get() + event.translationX);
        y.set(dragY.get() + event.translationY);
        const isOver = isOverCloseTarget(x.get(), y.get(), closeRect.get()) ? 1 : 0;
        if (isOver !== over.get()) {
          over.set(isOver);
          scheduleOnRN(crossedClose);
        }
      })
      .onEnd(event => {
        if (over.get() === 1) {
          scheduleOnRN(putAllDown);
          return;
        }
        const restY = clampBubbleY(y.get(), minY, maxY);
        const tuck = bubbleTuckSide(x.get(), width);
        if (tuck !== null) {
          x.set(withSpring(bubbleTuckedX(tuck, width), SPRING));
          y.set(withSpring(restY, SPRING));
          scheduleOnRN(setTucked, tuck);
          scheduleOnRN(settled);
          return;
        }
        const side = bubbleSettleSide(x.get(), event.velocityX, width);
        x.set(withSpring(bubbleRestX(side, width), { ...SPRING, velocity: event.velocityX }));
        y.set(withSpring(restY, { ...SPRING, velocity: event.velocityY }));
        scheduleOnRN(settled);
      })
      .onFinalize(() => {
        dragging.set(0);
        over.set(0);
        if (holding.get() === 0) closeShown.set(0);
        spread.set(withTiming(0, FOLD));
      });

    const tap = Gesture.Tap()
      .maxDuration(BUBBLE_HOLD_MS)
      .onEnd((_event, success) => {
        if (success) scheduleOnRN(tapBubble);
      });

    return Gesture.Simultaneous(hold, Gesture.Exclusive(drag, tap));
  }, [
    closeList,
    closeRect,
    closeShown,
    crossedClose,
    dragX,
    dragY,
    dragging,
    held,
    holding,
    maxY,
    minY,
    over,
    putAllDown,
    setTrailActive,
    settled,
    spread,
    tapBubble,
    width,
    x,
    y,
  ]);

  const tabGesture = useMemo(() => {
    if (tucked === null) return Gesture.Tap();
    const outward = tucked === 'left' ? 1 : -1;
    const drag = Gesture.Pan()
      .onStart(() => {
        dragY.set(y.get());
      })
      .onUpdate(event => {
        y.set(clampBubbleY(dragY.get() + event.translationY, minY, maxY));
      })
      .onEnd(event => {
        if (event.translationX * outward > BUBBLE_TAB_PULL_DISTANCE) scheduleOnRN(untuck, tucked);
      });
    const tap = Gesture.Tap().onEnd((_event, success) => {
      if (success) scheduleOnRN(untuck, tucked);
    });
    return Gesture.Exclusive(drag, tap);
  }, [dragY, maxY, minY, tucked, untuck, y]);

  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() }],
  }));
  const tabStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.get() + BUBBLE_SIZE / 2 - BUBBLE_TAB_HEIGHT / 2 }],
  }));
  // With the keyboard up, a low bubble rides above it, clear of the composer.
  const liftStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          dragging.get() === 1 ? 0 : bubbleKeyboardLift(y.get(), height, -keyboard.height.get()),
      },
    ],
  }));
  const layerStyle = useAnimatedStyle(() => ({
    opacity: withTiming(visible ? 1 : 0, FOLD),
  }));

  const handleCloseLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      const targetWidth = event.nativeEvent.layout.width;
      closeRect.set({
        x: (width - targetWidth) / 2,
        y: height - closeBottom - BUBBLE_CLOSE_HEIGHT,
        width: targetWidth,
        height: BUBBLE_CLOSE_HEIGHT,
      });
    },
    [closeBottom, closeRect, height, width],
  );

  // The list folds when the room is covered, and Android's back folds it first.
  const listShown = list !== null && visible;
  useEffect(() => {
    if (!visible) setList(null);
  }, [visible]);
  useEffect(() => {
    if (!listShown || Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setList(null);
      return true;
    });
    return (): void => subscription.remove();
  }, [listShown]);

  const front = parked[0];
  const behindCount = Math.min(parked.length - 1, BUBBLE_BEHIND_MAX);
  const frontAgent = front ? (agents[front.threadId] ?? RESTING) : RESTING;
  const label = front
    ? parked.length === 1
      ? `Parked thread ${front.title}, ${front.channelName}`
      : `${parked.length} parked threads, newest ${front.title}`
    : '';
  const status =
    frontAgent.kind === 'working'
      ? ', agent working'
      : frontAgent.kind === 'answered'
        ? ', agent answered'
        : '';

  return (
    <ConversationOverlayLayer android='portal'>
      <GestureHandlerRootView style={StyleSheet.absoluteFill} pointerEvents='box-none'>
        <Animated.View
          style={[StyleSheet.absoluteFill, layerStyle]}
          pointerEvents={visible ? 'box-none' : 'none'}
          importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
          accessibilityElementsHidden={!visible}
        >
          <BubbleCloseTarget
            shown={closeShown}
            over={over}
            bottom={closeBottom}
            onLayout={handleCloseLayout}
          />
          <Animated.View style={[StyleSheet.absoluteFill, liftStyle]} pointerEvents='box-none'>
            {tucked === null
              ? Array.from({ length: behindCount }, (_, index) => behindCount - index).map(
                  depth => <BubbleBehind key={depth} depth={depth} trail={trail} spread={spread} />,
                )
              : null}
            {listShown ? (
              <BubbleList
                parked={parked}
                placement={list}
                screenWidth={width}
                onOpen={openFromList}
                onRemove={removeOne}
                onClearAll={putAllDown}
                onClose={closeList}
              />
            ) : null}
            {front ? (
              <GestureDetector gesture={bubbleGesture}>
                <Animated.View
                  accessible
                  accessibilityRole='button'
                  accessibilityLabel={`${label}${status}`}
                  accessibilityHint={
                    parked.length === 1 ? 'Opens the thread' : 'Lists the parked threads'
                  }
                  accessibilityState={parked.length > 1 ? { expanded: listShown } : {}}
                  accessibilityActions={[
                    { name: 'activate' },
                    { name: 'clear', label: 'Close all parked threads' },
                  ]}
                  onAccessibilityAction={event => {
                    if (event.nativeEvent.actionName === 'activate') tapBubble();
                    if (event.nativeEvent.actionName === 'clear') putAllDown();
                  }}
                  style={[styles.bubble, bubbleStyle]}
                >
                  {/* Its own view: the entering scale would replace the position's transform.
                    Keyed by the front thread, so every newly parked thread pops in. */}
                  <Animated.View key={front.threadId} entering={BUBBLE_TRANSITION.entering}>
                    <BubbleThread faceIds={front.faceIds} agent={frontAgent} />
                  </Animated.View>
                </Animated.View>
              </GestureDetector>
            ) : null}
            {tucked !== null ? (
              <BubbleEdgeTab
                side={tucked}
                style={tabStyle}
                gesture={tabGesture}
                onActivate={() => untuck(tucked)}
              />
            ) : null}
          </Animated.View>
          {toast && visible ? (
            <BubbleAnswerToast
              key={toast.threadId}
              toast={toast}
              top={insets.top + BUBBLE_TOAST_TOP_GAP}
              onOpen={openById}
              onDismiss={dismissBubbleToast}
            />
          ) : null}
        </Animated.View>
      </GestureHandlerRootView>
    </ConversationOverlayLayer>
  );
}

const styles = StyleSheet.create({
  bubble: { position: 'absolute', left: 0, top: 0 },
});
