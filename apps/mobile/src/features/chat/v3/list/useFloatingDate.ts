import { useCallback, useEffect, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';

import type { OpenSurface } from '../intent/openIntent.types';
import { bindDateSeparatorSession, dateSeparatorSessionKey } from './dateSeparatorObservation';

/** Matches v2: sticky date appears while the user scrolls, then fades. */
const FLOATING_DATE_HIDE_MS = 1200;

export const useFloatingDate = (
  surface: OpenSurface,
  intentKey: string,
): {
  floatingDate: number | null;
  rememberDate: (next: number | null) => void;
  onUserScroll: () => void;
  onViewportScroll: () => void;
} => {
  const { width: screenWidthDp, fontScale } = useWindowDimensions();
  const [floatingDate, setFloatingDate] = useState<number | null>(null);
  const latestRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userScrolledRef = useRef(false);
  const sessionKey = dateSeparatorSessionKey(surface, intentKey);
  const sessionKeyRef = useRef(sessionKey);
  if (sessionKeyRef.current !== sessionKey) {
    sessionKeyRef.current = sessionKey;
    userScrolledRef.current = false;
  }
  bindDateSeparatorSession({
    key: sessionKey,
    channelId: surface.channelId,
    conversationId: surface.kind === 'channel' ? null : surface.threadId,
    kind: surface.kind === 'channel' ? 'channel' : 'thread',
    screenWidthDp,
    fontScale,
    didUserScroll: () => userScrolledRef.current,
  });

  const rememberDate = useCallback((next: number | null): void => {
    latestRef.current = next;
  }, []);

  const show = useCallback((): void => {
    if (!userScrolledRef.current || latestRef.current === null) {
      return;
    }
    setFloatingDate(latestRef.current);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout((): void => {
      setFloatingDate(null);
    }, FLOATING_DATE_HIDE_MS);
  }, []);

  const onUserScroll = useCallback((): void => {
    userScrolledRef.current = true;
    show();
  }, [show]);

  const onViewportScroll = useCallback((): void => {
    show();
  }, [show]);

  useEffect(
    () => (): void => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return { floatingDate, rememberDate, onUserScroll, onViewportScroll };
};
