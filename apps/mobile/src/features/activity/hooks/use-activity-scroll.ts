import { useCallback, useEffect, useRef } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { beginCriticalWindow, endCriticalWindow } from '@/src/utils/interactionCriticalWindow';

import {
  ACTIVITY_END_REACHED_THRESHOLD,
  ACTIVITY_SCROLL_SETTLE_FALLBACK_MS,
  ACTIVITY_SCROLL_WINDOW_TAG,
} from '../constants';

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

type ActivityScrollHandlers = {
  onScroll: (event: ScrollEvent) => void;
  onScrollBeginDrag: () => void;
  onScrollEndDrag: (event: ScrollEvent) => void;
  onMomentumScrollBegin: () => void;
  onMomentumScrollEnd: () => void;
};

/**
 * Scroll bookkeeping the classic screen does, kept so the sync behaves the same.
 *
 * - A *critical window* is open for as long as the finger or its momentum is
 *   moving. Background work that honours it (sync reconciliation, deferred live
 *   queries) waits for the list to settle instead of competing with it.
 * - `onEndReached` is one-shot: a fire consumed while a fetch is in flight never
 *   re-arms. Re-checking on the scroll stream keeps pagination flowing;
 *   `loadMore`'s own guards make the extra calls no-ops.
 *
 * Nothing here writes state, so scrolling never causes a render.
 */
export function useActivityScroll({
  loadMore,
  isFocused,
}: {
  loadMore: () => void;
  isFocused: boolean;
}): ActivityScrollHandlers {
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSettleTimer = useCallback(() => {
    if (settleTimer.current === null) return;
    clearTimeout(settleTimer.current);
    settleTimer.current = null;
  }, []);

  const finish = useCallback(() => {
    clearSettleTimer();
    endCriticalWindow(ACTIVITY_SCROLL_WINDOW_TAG);
  }, [clearSettleTimer]);

  // Momentum can end without an event (the list is unmounted or interrupted),
  // so a window never outlives this fallback.
  const scheduleFallback = useCallback(() => {
    clearSettleTimer();
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      endCriticalWindow(ACTIVITY_SCROLL_WINDOW_TAG);
    }, ACTIVITY_SCROLL_SETTLE_FALLBACK_MS);
  }, [clearSettleTimer]);

  useEffect(() => {
    if (!isFocused) finish();
  }, [finish, isFocused]);

  useEffect(() => finish, [finish]);

  const onScroll = useCallback(
    (event: ScrollEvent) => {
      const { contentOffset, contentSize, layoutMeasurement, contentInset } = event.nativeEvent;
      const viewport = layoutMeasurement.height;
      if (viewport <= 0) return;

      const distanceFromEnd =
        contentSize.height - contentOffset.y - viewport - (contentInset?.bottom ?? 0);
      if (distanceFromEnd <= ACTIVITY_END_REACHED_THRESHOLD * viewport) loadMore();
    },
    [loadMore],
  );

  const onScrollBeginDrag = useCallback(() => {
    beginCriticalWindow(ACTIVITY_SCROLL_WINDOW_TAG);
    clearSettleTimer();
  }, [clearSettleTimer]);

  const onScrollEndDrag = useCallback(
    (event: ScrollEvent) => {
      // A fling hands over to momentum, which ends the window itself.
      if (event.nativeEvent.velocity?.y) {
        scheduleFallback();
        return;
      }
      finish();
    },
    [finish, scheduleFallback],
  );

  const onMomentumScrollBegin = useCallback(() => {
    beginCriticalWindow(ACTIVITY_SCROLL_WINDOW_TAG);
    scheduleFallback();
  }, [scheduleFallback]);

  return {
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd: finish,
  };
}
