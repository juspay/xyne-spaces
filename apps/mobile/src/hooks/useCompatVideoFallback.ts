import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import {
  INITIAL_COMPAT_STATE,
  isRecovering,
  onCompatPlayerError,
  onCompatPlayerReady,
  variantForState,
  type CompatFallbackPhase,
  type VideoVariant,
} from '@/src/utils/videoCompatFallback';

interface CompatVideoFallback {
  /** Pass to useMtlsVideoStream. */
  variant: VideoVariant;
  phase: CompatFallbackPhase;
  /** Increments for every compat (re)load; include in the viewer's "loaded source" key. */
  loadToken: number;
  /** True while the viewer should show "Preparing video…" instead of an error. */
  recovering: boolean;
  /** Error to show once the fallback has given up (the ORIGINAL file's error). */
  originalError: string | null;
  /** Call from statusChange → error. Returns true when the fallback took over (suppress the error UI). */
  handlePlayerError: (error: unknown) => boolean;
  /** Call from statusChange → readyToPlay. */
  handlePlayerReady: () => void;
}

/**
 * Per-attachment wrapper around the compat fallback state machine
 * (utils/videoCompatFallback). Resets whenever the attachment changes.
 */
export function useCompatVideoFallback(attachmentId: string, active: boolean): CompatVideoFallback {
  const [state, setState] = useState(INITIAL_COMPAT_STATE);
  const [loadToken, setLoadToken] = useState(0);
  const loadTokenRef = useRef(0);
  loadTokenRef.current = loadToken;
  // statusChange → error and a rejected replaceAsync often report the SAME
  // failure; only the first error per load may advance the state machine.
  const handledTokenRef = useRef<number | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRetry = (): void => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  useEffect(() => {
    clearRetry();
    setState(INITIAL_COMPAT_STATE);
    stateRef.current = INITIAL_COMPAT_STATE;
    setLoadToken(0);
    loadTokenRef.current = 0;
    handledTokenRef.current = null;
  }, [attachmentId]);

  // A paged-away viewer must not keep polling the server.
  useEffect(() => {
    if (!active) clearRetry();
  }, [active]);

  useEffect(() => clearRetry, []);

  const handlePlayerError = useCallback((error: unknown): boolean => {
    if (handledTokenRef.current === loadTokenRef.current) {
      return isRecovering(stateRef.current.phase);
    }
    handledTokenRef.current = loadTokenRef.current;
    const { state: next, action } = onCompatPlayerError(stateRef.current, error, Platform.OS);
    stateRef.current = next;
    setState(next);
    if (action.type === 'load_compat') {
      setLoadToken(t => t + 1);
      return true;
    }
    if (action.type === 'retry_compat') {
      clearRetry();
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        setLoadToken(t => t + 1);
      }, action.delayMs);
      return true;
    }
    return false;
  }, []);

  const handlePlayerReady = useCallback((): void => {
    const next = onCompatPlayerReady(stateRef.current);
    if (next !== stateRef.current) {
      stateRef.current = next;
      setState(next);
    }
  }, []);

  return {
    variant: variantForState(state),
    phase: state.phase,
    loadToken,
    recovering: isRecovering(state.phase),
    originalError: state.phase === 'unavailable' ? state.originalError : null,
    handlePlayerError,
    handlePlayerReady,
  };
}
