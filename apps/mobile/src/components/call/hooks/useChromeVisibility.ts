/**
 * Show/hide state for the call chrome (header + control bar).
 *
 * In immersive video layouts the chrome tucks away after a few seconds of stillness and comes
 * back on tap, like WhatsApp / FaceTime. Everywhere else — and whenever something needs the
 * user's attention (`hold`) — it stays put.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { callMotion } from '../callTheme';

interface ChromeVisibility {
  visible: boolean;
  /** Tap on the stage: flip visibility (immersive only). */
  toggle: () => void;
  /** Any interaction with the chrome: keep it up and restart the idle timer. */
  poke: () => void;
}

export function useChromeVisibility(params: {
  /** Layout is a full-bleed video, so the chrome is allowed to hide. */
  immersive: boolean;
  /** Something (a sheet, a warning) needs the chrome to stay visible. */
  hold: boolean;
}): ChromeVisibility {
  const { immersive, hold } = params;
  const [visible, setVisible] = useState(true);
  const visibleRef = useRef(true);
  visibleRef.current = visible;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canHide = immersive && !hold;

  const clearTimer = useCallback((): void => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const arm = useCallback((): void => {
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      setVisible(false);
    }, callMotion.chromeAutoHideMs);
  }, [clearTimer]);

  useEffect(() => {
    if (!canHide) {
      clearTimer();
      setVisible(true);
      return clearTimer;
    }
    arm();
    return clearTimer;
  }, [arm, canHide, clearTimer]);

  const toggle = useCallback((): void => {
    if (!canHide) return;
    if (visibleRef.current) {
      clearTimer();
      setVisible(false);
    } else {
      setVisible(true);
      arm();
    }
  }, [arm, canHide, clearTimer]);

  const poke = useCallback((): void => {
    setVisible(true);
    if (canHide) arm();
  }, [arm, canHide]);

  return { visible: canHide ? visible : true, toggle, poke };
}
