import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { roomActor } from '../../machines/roomMachine';

export function CallWindowNavigationBridge(): null {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const pendingPathRef = useRef<string | null>(null);

  useEffect(() => {
    const isInCall = (): boolean => {
      const current = roomActor.getSnapshot();
      return (
        current.matches('initiating') ||
        current.matches('joining') ||
        current.matches('connecting') ||
        current.matches('disconnecting') ||
        current.matches('connected')
      );
    };

    const routeIfIdle = (relativePath: string): void => {
      if (isInCall()) {
        pendingPathRef.current = relativePath;
        return;
      }
      pendingPathRef.current = null;
      void navigateRef.current(relativePath, { replace: true });
    };

    const subscription = roomActor.subscribe(() => {
      const next = pendingPathRef.current;
      if (!next || isInCall()) return;
      pendingPathRef.current = null;
      void navigateRef.current(next, { replace: true });
    });

    const dispose = window.electronAPI?.onCallWindowNavigate?.(routeIfIdle);

    let cancelled = false;
    void window.electronAPI?.takePendingCallRoute?.().then(relativePath => {
      if (cancelled || !relativePath) return;
      routeIfIdle(relativePath);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      dispose?.();
    };
  }, []);

  return null;
}
