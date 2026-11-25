import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from 'expo-router';
import { Keyboard, useWindowDimensions, type ViewStyle } from 'react-native';
import { Gesture, type PanGesture } from 'react-native-gesture-handler';
import {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type AnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import {
  THREAD_CARD_DISMISS_DISTANCE,
  THREAD_CARD_DISMISS_VELOCITY,
  THREAD_CARD_DRAG_FAIL_X,
  THREAD_CARD_DRAG_SLOP,
  THREAD_CARD_ENTER_MS,
  THREAD_CARD_EXIT_MS,
  THREAD_CARD_MORPH_CONTENT_FROM,
  THREAD_CARD_MORPH_CONTENT_SPAN,
  THREAD_CARD_MORPH_ENTER_MS,
  THREAD_CARD_MORPH_EXIT_EASING,
  THREAD_CARD_MORPH_EXIT_MS,
  THREAD_CARD_MORPH_FADE_SHARE,
  THREAD_CARD_MORPH_START_TIMEOUT_MS,
  THREAD_CARD_OVERDRAG_LIMIT,
  THREAD_CARD_RADIUS,
  THREAD_CARD_SCRIM_MS,
  THREAD_CARD_SETTLE_SPRING,
  THREAD_CARD_SHEET_EASING,
  THREAD_CARD_SOURCE_MAX_AGE_MS,
  THREAD_STRIP_RADIUS,
  TRAY_SHADOW,
} from '../constants';
import {
  blendThreadCardRect,
  rubberBand,
  threadCardDragDismisses,
  threadCardMorphContentOpacity,
  threadCardMorphOpacity,
  threadCardScrimOpacity,
  type ThreadCardRect,
  type ThreadCardSource,
} from '../model/thread-card-motion';
import { clearThreadCardSource, getThreadCardSource } from '../model/thread-card-source-store';
import { measureThreadCardOpener } from '../thread-card-source';

const SHEET_EASING = Easing.bezier(...THREAD_CARD_SHEET_EASING);
const MORPH_EXIT_EASING = Easing.bezier(...THREAD_CARD_MORPH_EXIT_EASING);

type ThreadCardMotionInput = {
  /** Where the card rests, in window points. */
  target: ThreadCardRect;
  /** Skips the entrance, as for a thread opened from a notification. */
  instant: boolean;
  /** The thread shown, so the card can find its strip again as it leaves. */
  threadId: string;
  onDragClose: () => void;
};

type ThreadCardMotionResult = {
  /**
   * The card grows out of the strip: its frame comes from `cardStyle`, not
   * from fixed edges, and its corners from `cornerStyle`.
   */
  morphing: boolean;
  cardStyle: AnimatedStyle<ViewStyle>;
  /** The corners, for the card and the clip inside it (they round together as it morphs). */
  cornerStyle: AnimatedStyle<ViewStyle>;
  /** The thread inside the clip: card-sized while the card morphs, so it never relays out. */
  contentStyle: AnimatedStyle<ViewStyle>;
  scrimStyle: AnimatedStyle<ViewStyle>;
  /** Drags the card down by its header to close it; off with reduced motion. */
  dragGesture: PanGesture;
  /** The card's height, for the drag's thresholds; set from its layout. */
  cardHeight: SharedValue<number>;
  /** For the thread inside the card: a morph grows once the thread's rows are shown. */
  onContentReady: () => void;
};

/**
 * The thread card's entrance, exit and drag-to-close. The route itself does
 * not animate, so the scrim fades in place while only the card moves. Opened
 * from a "N replies" strip, the strip grows into the card and the card shrinks
 * back into it on close; opened any other way, the card glides up from below
 * on the iOS sheet curve. Every way of leaving (the scrim, the collapse
 * button, Android back, a drag) plays the exit before the route goes.
 */
export function useThreadCardMotion({
  target,
  instant,
  threadId,
  onDragClose,
}: ThreadCardMotionInput): ThreadCardMotionResult {
  const animates = !useReducedMotion();
  // The strip the card grows from, read once as it opens and kept for the close.
  const [source] = useState(() => getThreadCardSource(THREAD_CARD_SOURCE_MAX_AGE_MS));
  // Read once; a thread opened some other way next must not grow out of it.
  useEffect(() => clearThreadCardSource(), []);
  const morphing = animates && !instant && source !== null;
  const navigation = useNavigation();
  const { height: windowHeight } = useWindowDimensions();
  // Where it shrinks back to: the strip's frame at open, refreshed as it leaves.
  const sourceRect = useSharedValue<ThreadCardSource | null>(source);

  const progress = useSharedValue(animates && !instant ? 0 : 1);
  const scrim = useSharedValue(animates && !instant ? 0 : 1);
  const dragY = useSharedValue(0);
  const cardHeight = useSharedValue(target.height);
  const leavingRef = useRef(false);
  // The thread mounts and places its rows in the same frames the grow would
  // play in, and that work ate them: the card jumped most of the way in one
  // step, over an empty body. So the grow waits for the rows, then one frame.
  const [contentReady, setContentReady] = useState(!morphing);
  const readyFrameRef = useRef<number | null>(null);
  const onContentReady = useCallback((): void => {
    readyFrameRef.current ??= requestAnimationFrame(() => setContentReady(true));
  }, []);
  useEffect(
    () => (): void => {
      if (readyFrameRef.current !== null) cancelAnimationFrame(readyFrameRef.current);
    },
    [],
  );
  useEffect(() => {
    if (contentReady) return undefined;
    const timer = setTimeout(() => setContentReady(true), THREAD_CARD_MORPH_START_TIMEOUT_MS);
    return (): void => clearTimeout(timer);
  }, [contentReady]);

  useEffect(() => {
    if (!animates || instant || !contentReady) return;
    scrim.set(withTiming(1, { duration: THREAD_CARD_SCRIM_MS }));
    progress.set(
      withTiming(1, {
        duration: morphing ? THREAD_CARD_MORPH_ENTER_MS : THREAD_CARD_ENTER_MS,
        easing: SHEET_EASING,
      }),
    );
  }, [animates, instant, contentReady, morphing, progress, scrim]);

  // The keyboard goes as the card starts to leave, however it leaves, so it
  // never hangs over the screen beneath and swallows the next tap there.
  useEffect(() => navigation.addListener('beforeRemove', () => Keyboard.dismiss()), [navigation]);

  // Every removal plays the exit first, then lets the route go.
  useEffect(() => {
    if (!animates) return undefined;
    return navigation.addListener('beforeRemove', event => {
      if (leavingRef.current) return;
      // Swapped for another screen in place (a ticket thread hands over to the
      // ticket screen): that screen takes over now, with nothing to shrink back into.
      if (event.data.action.type === 'REPLACE') return;
      event.preventDefault();
      leavingRef.current = true;
      const leave = (): void => navigation.dispatch(event.data.action);
      const exit = morphing
        ? { duration: THREAD_CARD_MORPH_EXIT_MS, easing: MORPH_EXIT_EASING }
        : { duration: THREAD_CARD_EXIT_MS, easing: SHEET_EASING };
      const play = (): void => {
        scrim.set(withTiming(0, exit));
        // A morphing card goes back into the strip from wherever it was dragged to.
        if (morphing) dragY.set(withTiming(0, exit));
        progress.set(
          withTiming(0, exit, finished => {
            if (finished) scheduleOnRN(leave);
          }),
        );
      };
      // The room may have moved under the card (new messages, the keyboard):
      // shrink into where the strip is now, not where it was.
      if (morphing && source?.radius === THREAD_STRIP_RADIUS) {
        measureThreadCardOpener(threadId, windowHeight, rect => {
          if (rect) sourceRect.set({ ...rect, radius: THREAD_STRIP_RADIUS });
          play();
        });
        return;
      }
      play();
    });
  }, [
    animates,
    morphing,
    navigation,
    progress,
    scrim,
    dragY,
    source,
    sourceRect,
    threadId,
    windowHeight,
  ]);

  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(animates)
        .activeOffsetY([-THREAD_CARD_DRAG_SLOP, THREAD_CARD_DRAG_SLOP])
        .failOffsetX([-THREAD_CARD_DRAG_FAIL_X, THREAD_CARD_DRAG_FAIL_X])
        .onUpdate(event => {
          const y = event.translationY;
          dragY.set(y >= 0 ? y : -rubberBand(-y, THREAD_CARD_OVERDRAG_LIMIT));
        })
        .onEnd(event => {
          const closes = threadCardDragDismisses(
            dragY.get(),
            event.velocityY,
            cardHeight.get(),
            THREAD_CARD_DISMISS_DISTANCE,
            THREAD_CARD_DISMISS_VELOCITY,
          );
          if (closes) {
            scheduleOnRN(onDragClose);
            return;
          }
          dragY.set(withSpring(0, { ...THREAD_CARD_SETTLE_SPRING, velocity: event.velocityY }));
        }),
    [animates, cardHeight, dragY, onDragClose],
  );

  const distance = target.y + target.height;
  const cardStyle = useAnimatedStyle((): ViewStyle => {
    const p = progress.get();
    const from = sourceRect.get();
    if (morphing && from) {
      const frame = blendThreadCardRect(from, target, p);
      return {
        left: frame.x,
        top: frame.y + dragY.get(),
        width: frame.width,
        height: frame.height,
        opacity: threadCardMorphOpacity(p, THREAD_CARD_MORPH_FADE_SHARE),
        // The strip casts no shadow, so the card's grows in with it.
        shadowOpacity: TRAY_SHADOW.shadowOpacity * p,
      };
    }
    return { transform: [{ translateY: (1 - p) * distance + dragY.get() }] };
  });

  const cornerStyle = useAnimatedStyle((): ViewStyle => {
    if (!morphing) return { borderRadius: THREAD_CARD_RADIUS };
    const p = progress.get();
    const from = source?.radius ?? THREAD_STRIP_RADIUS;
    return { borderRadius: from + (THREAD_CARD_RADIUS - from) * p };
  });

  const contentStyle = useAnimatedStyle((): ViewStyle => {
    const from = sourceRect.get();
    if (!morphing || !from) return { flex: 1 };
    const p = progress.get();
    const width = blendThreadCardRect(from, target, p).width;
    // Pinned to the top of the growing card and centred across it, at full size.
    return {
      opacity: threadCardMorphContentOpacity(
        p,
        THREAD_CARD_MORPH_CONTENT_FROM,
        THREAD_CARD_MORPH_CONTENT_SPAN,
      ),
      position: 'absolute',
      top: 0,
      left: (width - target.width) / 2,
      width: target.width,
      height: target.height,
    };
  });

  const scrimStyle = useAnimatedStyle((): ViewStyle => ({
    opacity: threadCardScrimOpacity(scrim.get(), dragY.get(), cardHeight.get()),
  }));

  return {
    morphing,
    cardStyle,
    cornerStyle,
    contentStyle,
    scrimStyle,
    dragGesture,
    cardHeight,
    onContentReady,
  };
}
