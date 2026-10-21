import {
  createContext,
  ReactElement,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { registerWorkspaceSwitchLifecycle } from '@/src/services/workspaceSessionReset';

type StartupPhaseContextValue = {
  hasSplashHidden: boolean;
  hasFirstFramePainted: boolean;
  hasQueryCacheHydrated: boolean;
  isProtectedStartupReady: boolean;
  isVisibleChannelsReady: boolean;
  isUserDirectoryReady: boolean;
  markSplashHidden: () => void;
  markFirstFramePainted: () => void;
  setQueryCacheHydrated: (hydrated: boolean) => void;
  setProtectedStartupReady: (ready: boolean) => void;
  setVisibleChannelsReady: (ready: boolean) => void;
  setUserDirectoryReady: (ready: boolean) => void;
};

const StartupPhaseContext = createContext<StartupPhaseContextValue | null>(null);

export function StartupPhaseProvider({ children }: { children: ReactNode }): ReactElement {
  const [hasSplashHidden, setHasSplashHidden] = useState(false);
  const [hasFirstFramePainted, setHasFirstFramePainted] = useState(false);
  const [hasQueryCacheHydrated, setHasQueryCacheHydrated] = useState(false);
  const [isProtectedStartupReady, setProtectedStartupReady] = useState(false);
  const [isVisibleChannelsReady, setVisibleChannelsReady] = useState(false);
  const [isUserDirectoryReady, setUserDirectoryReady] = useState(false);

  const markSplashHidden = useCallback(() => {
    setHasSplashHidden(true);
  }, []);

  const markFirstFramePainted = useCallback(() => {
    setHasFirstFramePainted(true);
  }, []);

  const setQueryCacheHydrated = useCallback((hydrated: boolean) => {
    setHasQueryCacheHydrated(hydrated);
  }, []);

  useEffect(() => {
    return registerWorkspaceSwitchLifecycle({
      onBeforeWorkspaceSwitch: () => {
        setProtectedStartupReady(false);
        setQueryCacheHydrated(false);
        setVisibleChannelsReady(false);
        setUserDirectoryReady(false);
      },
    });
  }, [setQueryCacheHydrated]);

  const value = useMemo(
    () => ({
      hasSplashHidden,
      hasFirstFramePainted,
      hasQueryCacheHydrated,
      isProtectedStartupReady,
      isVisibleChannelsReady,
      isUserDirectoryReady,
      markSplashHidden,
      markFirstFramePainted,
      setQueryCacheHydrated,
      setProtectedStartupReady,
      setVisibleChannelsReady,
      setUserDirectoryReady,
    }),
    [
      hasFirstFramePainted,
      hasQueryCacheHydrated,
      hasSplashHidden,
      isProtectedStartupReady,
      isUserDirectoryReady,
      isVisibleChannelsReady,
      markFirstFramePainted,
      markSplashHidden,
      setQueryCacheHydrated,
      setProtectedStartupReady,
    ],
  );

  return <StartupPhaseContext.Provider value={value}>{children}</StartupPhaseContext.Provider>;
}

export function useStartupPhase(): StartupPhaseContextValue {
  const value = useContext(StartupPhaseContext);
  if (!value) {
    throw new Error('useStartupPhase must be used inside StartupPhaseProvider');
  }
  return value;
}
