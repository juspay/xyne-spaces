import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { recordConnectionChange, recordConnectionConnected } from '@xyne/shared/hooks';

/**
 * Feeds shared `wasInterrupted()` so Zero latency histograms skip samples
 * taken while the socket is down or the app is backgrounded. Without this,
 * every mobile measurement is marked skewed and histograms stay empty.
 */
export function useZeroMetricValidity(isConnected: boolean): void {
  const isConnectedRef = useRef(isConnected);
  isConnectedRef.current = isConnected;

  useEffect(() => {
    if (isConnected) {
      recordConnectionConnected();
      return;
    }

    recordConnectionChange();
  }, [isConnected]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') {
        recordConnectionChange();
        return;
      }

      if (isConnectedRef.current) {
        recordConnectionConnected();
      }
    });

    return (): void => {
      subscription.remove();
    };
  }, []);
}
