import { createContext, useContext, useEffect, useState } from 'react';
import { useSegments } from 'expo-router';

import { callRuntimeNativeService } from '@/src/services/CallRuntimeNativeService';

/** Computes and shares whether the top call bar should be shown right now. */
const FULL_SCREEN_ROUTES = new Set([
  'native-call',
  'call-prejoin',
  'attachments-viewer',
  'create-workspace',
  'quick-look',
]);

export const CALL_BAR_HEIGHT = 56;
export const CALL_BAR_GAP = 8;

const VISIBILITY_SETTLE_MS = 300;

export interface CallBarVisibility {
  isVisible: boolean;
  isCallActive: boolean;
}

export const CallBarVisibilityContext = createContext<CallBarVisibility | null>(null);

const DEFAULT_CALL_BAR_VISIBILITY: CallBarVisibility = { isVisible: false, isCallActive: false };

export function useCallBarVisibility(): CallBarVisibility {
  return useContext(CallBarVisibilityContext) ?? DEFAULT_CALL_BAR_VISIBILITY;
}

export function useIsCallBarVisible(): CallBarVisibility {
  const segments = useSegments() as string[];
  const [rawCallActive, setRawCallActive] = useState(
    () =>
      Boolean(callRuntimeNativeService.getActiveCall()) &&
      callRuntimeNativeService.getConnectionState() === 'connected',
  );

  useEffect(
    () =>
      callRuntimeNativeService.subscribe(state => {
        setRawCallActive(Boolean(state.activeCall) && state.connectionState === 'connected');
      }),
    [],
  );

  const [isCallActive, setIsCallActive] = useState(rawCallActive);
  useEffect(() => {
    if (rawCallActive === isCallActive) return;

    const timeout = setTimeout(() => setIsCallActive(rawCallActive), VISIBILITY_SETTLE_MS);
    return () => clearTimeout(timeout);
  }, [rawCallActive, isCallActive]);

  const isOnFullScreenRoute = segments.some(segment => FULL_SCREEN_ROUTES.has(segment));

  return { isVisible: isCallActive && !isOnFullScreenRoute, isCallActive };
}
