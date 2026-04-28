import { useState, useRef, useEffect } from 'react';
import { useZeroConnectionInfo } from './useZeroConnectionState.js';

/**
 * Tracks Zero connection lifecycle for offline UX.
 *
 * - `isOffline`: true immediately on disconnected/error, resets on `connected`.
 *   Use this to block writes.
 * - `showOfflineBanner`: true after a grace period of being disconnected while tab is visible.
 *   Brief disconnections (e.g. tab switch) never trigger it. Use this for UI banners.
 * - `isReconnected`: true for ~1.5s after transitioning from offline → connected.
 * - `isReconnecting`: true when banner is showing and state is `connecting`.
 * - `refreshConnection`: triggers a Zero reconnect.
 */
const OFFLINE_GRACE_MS = 2000;
const RECONNECTED_DISPLAY_MS = 1500;

export function useZeroOfflineState() {
  const { stateName, isDisconnectedOrError, refreshConnection } = useZeroConnectionInfo();
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [showOfflineBanner, setShowOfflineBanner] = useState(false);
  const [isReconnected, setIsReconnected] = useState(false);
  const [isTabVisible, setIsTabVisible] = useState(() =>
    typeof document === 'undefined' || document.visibilityState === 'visible',
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handler = () => setIsTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  useEffect(() => {
    if (isDisconnectedOrError) {
      setIsOffline(true);
      if (isTabVisible && !offlineTimerRef.current) {
        offlineTimerRef.current = setTimeout(() => {
          offlineTimerRef.current = null;
          setShowOfflineBanner(true);
          setIsReconnected(false);
        }, OFFLINE_GRACE_MS);
      }
    } else if (stateName === 'connected') {
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
      if (isOffline) {
        setIsOffline(false);
        setShowOfflineBanner(false);
        if (showOfflineBanner) {
          setIsReconnected(true);
          if (reconnectedTimerRef.current) clearTimeout(reconnectedTimerRef.current);
          reconnectedTimerRef.current = setTimeout(() => {
            reconnectedTimerRef.current = null;
            setIsReconnected(false);
          }, RECONNECTED_DISPLAY_MS);
        }
      }
    }
  }, [stateName, isDisconnectedOrError, isTabVisible]);

  useEffect(() => {
    return () => {
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      if (reconnectedTimerRef.current) clearTimeout(reconnectedTimerRef.current);
    };
  }, []);

  const isReconnecting = showOfflineBanner && stateName === 'connecting';

  return { isOffline, showOfflineBanner, isReconnecting, isReconnected, refreshConnection };
}
