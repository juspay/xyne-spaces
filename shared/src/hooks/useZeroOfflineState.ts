import { useState, useRef, useEffect } from 'react';
import { useZeroConnectionInfo } from './useZeroConnectionState.js';

/**
 * Tracks Zero connection lifecycle for offline UX.
 *
 * - `isOffline`: true when disconnected/error, stays true through `connecting` (sticky),
 *   only resets when `connected`. Not set on initial page-load `connecting`.
 * - `isReconnected`: true for ~1.5s after transitioning from offline → connected.
 * - `isReconnecting`: true when reconnecting after having been offline (connecting state after disconnect/error).
 * - `refreshConnection`: triggers a Zero reconnect.
 */
export function useZeroOfflineState() {
  const { stateName, isDisconnectedOrError, refreshConnection } = useZeroConnectionInfo();
  const wasOfflineRef = useRef(false);
  const [isOffline, setIsOffline] = useState(false);
  const [isReconnected, setIsReconnected] = useState(false);

  useEffect(() => {
    if (isDisconnectedOrError) {
      wasOfflineRef.current = true;
      setIsOffline(true);
      setIsReconnected(false);
    } else if (stateName === 'connected' && wasOfflineRef.current) {
      wasOfflineRef.current = false;
      setIsOffline(false);
      setIsReconnected(true);
      const timer = setTimeout(() => setIsReconnected(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [stateName, isDisconnectedOrError]);

  const isReconnecting = isOffline && stateName === 'connecting';

  return { isOffline, isReconnecting, isReconnected, refreshConnection };
}
