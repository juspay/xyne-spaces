import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type WebView from 'react-native-webview';

export type WebPresentation = 'hidden' | 'overlay' | 'fullscreen';

type EngineState = {
  isBooted: boolean;
  isReady: boolean;
  presentation: WebPresentation;
  overlayBottomInset: number;
  /** Native-selected dashboard route; web content cannot replace this target. */
  navigationTarget: string | null;
};

type EngineContextValue = {
  webRef: React.RefObject<WebView | null>;
  state: EngineState;
  boot: (initialPath?: string) => void;
  setReady: (ready: boolean) => void;
  setPresentation: (p: WebPresentation) => void;
  post: (type: string, payload?: unknown) => boolean;
  navigate: (path: string) => void;
  setDashboardTabBarHidden: (hidden: boolean) => void; // NEW
  setOverlayBottomInset: (inset: number) => void; // NEW
};

const BRIDGE_CHANNEL = 'xyne-spaces-bridge';
const NATIVE_SOURCE = 'xyne-native';
const BRIDGE_VERSION = 1;

const Ctx = createContext<EngineContextValue | null>(null);

export function WebViewEngineProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const webRef = useRef<WebView | null>(null);
  const queueRef = useRef<string[]>([]);
  const [state, setState] = useState<EngineState>({
    isBooted: false,
    isReady: false,
    presentation: 'hidden',
    overlayBottomInset: 0,
    navigationTarget: null,
  });

  const flushQueue = useCallback(() => {
    if (!webRef.current) return;
    while (queueRef.current.length > 0) {
      const js = queueRef.current.shift();
      if (js) webRef.current.injectJavaScript(js);
    }
  }, []);

  const injectOrQueue = useCallback(
    (js: string) => {
      if (!state.isReady || !webRef.current) {
        queueRef.current.push(js);
        return;
      }
      webRef.current.injectJavaScript(js);
    },
    [state.isReady],
  );

  const post = useCallback((type: string, payload?: unknown): boolean => {
    const view = webRef.current;
    if (!view) return false;
    const msg = {
      channel: BRIDGE_CHANNEL,
      source: NATIVE_SOURCE,
      version: BRIDGE_VERSION,
      timestamp: Date.now(),
      type,
      ...(payload === undefined ? {} : { payload }),
    };
    view.postMessage(JSON.stringify(msg));
    return true;
  }, []);

  const navigate = useCallback((path: string) => {
    setState(s => (s.navigationTarget === path ? s : { ...s, navigationTarget: path }));
  }, []);

  const setDashboardTabBarHidden = useCallback(
    (hidden: boolean) => {
      const js = `
        (function () {
          try {
            var id = '__lotus_tabbar_override';
            var existing = document.getElementById(id);
            if (${String(hidden)}) {
              if (!existing) {
                var style = document.createElement('style');
                style.id = id;
                style.textContent = 'html.lotus-overlay-mode div.fixed.z-50.bottom-2 { display: none !important; }';
                document.head.appendChild(style);
              }
              document.documentElement.classList.add('lotus-overlay-mode');
            } else {
              document.documentElement.classList.remove('lotus-overlay-mode');
            }
          } catch (_) {}
        })();
        true;
      `;
      injectOrQueue(js);
    },
    [injectOrQueue],
  );

  const boot = useCallback((initialPath?: string) => {
    setState(s =>
      s.isBooted
        ? s
        : {
            ...s,
            isBooted: true,
            navigationTarget: initialPath ?? s.navigationTarget,
          },
    );
  }, []);

  const setReady = useCallback(
    (ready: boolean) => {
      setState(s => ({ ...s, isReady: ready }));
      if (ready) flushQueue();
    },
    [flushQueue],
  );

  const setPresentation = useCallback((presentation: WebPresentation) => {
    setState(s => ({ ...s, presentation }));
  }, []);

  const setOverlayBottomInset = useCallback((inset: number) => {
    setState(s => (s.overlayBottomInset === inset ? s : { ...s, overlayBottomInset: inset }));
  }, []);

  const value = useMemo<EngineContextValue>(
    () => ({
      webRef,
      state,
      boot,
      setReady,
      setPresentation,
      post,
      navigate,
      setDashboardTabBarHidden,
      setOverlayBottomInset,
    }),
    [
      state,
      boot,
      setReady,
      setPresentation,
      post,
      navigate,
      setDashboardTabBarHidden,
      setOverlayBottomInset,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWebViewEngine(): EngineContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWebViewEngine must be used inside WebViewEngineProvider');
  return ctx;
}
