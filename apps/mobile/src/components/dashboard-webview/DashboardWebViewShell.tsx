import React, { ReactElement, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useGlobalSearchParams, useSegments } from 'expo-router';

import { API_ORIGIN } from '@/src/config';
import { getCookieValueFromJar, XYNE_LAST_WORKSPACE_COOKIE } from '@/src/utils/apiCookieHeader';
import {
  DASHBOARD_WEBVIEW_ROUTES,
  resolveDashboardWebViewTarget,
  type DashboardSearchParamsInput,
} from '@/src/utils/webview';
import {
  WebViewEngineProvider,
  useWebViewEngine,
} from '@/src/components/dashboard-webview/WebViewEngineContext';
import { DashboardWebViewRouteLoader } from '@/src/components/dashboard-webview/DashboardWebViewLoader';

const LazyDashboardWebViewLayer = React.lazy(
  () => import('@/src/components/dashboard-webview/DashboardWebViewLayer'),
);

const DASHBOARD_WORKSPACE_TIMEOUT_MS = 1500;

async function readDashboardWorkspaceId(): Promise<string | null> {
  try {
    const workspaceId = await Promise.race<string | undefined | null>([
      getCookieValueFromJar(API_ORIGIN, XYNE_LAST_WORKSPACE_COOKIE),
      new Promise<null>(resolve => {
        setTimeout(() => resolve(null), DASHBOARD_WORKSPACE_TIMEOUT_MS);
      }),
    ]);
    return workspaceId ?? null;
  } catch {
    return null;
  }
}

function normalizeSearchParams(
  raw: ReturnType<typeof useGlobalSearchParams>,
): DashboardSearchParamsInput {
  const normalized: DashboardSearchParamsInput = {};

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      normalized[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      normalized[key] = value.filter(v => typeof v === 'string');
    }
  }

  return normalized;
}

function WebViewPresentationController(): ReactElement | null {
  const segments = useSegments();
  const rawSearchParams = useGlobalSearchParams();

  const [dashboardWorkspaceId, setDashboardWorkspaceId] = useState<string | null | undefined>(null);

  const searchParams = useMemo(() => normalizeSearchParams(rawSearchParams), [rawSearchParams]);
  const needsDashboardWorkspace = useMemo(
    () => (segments as string[]).some(seg => seg in DASHBOARD_WEBVIEW_ROUTES),
    [segments],
  );

  useEffect(() => {
    if (!needsDashboardWorkspace) {
      setDashboardWorkspaceId(null);
      return;
    }

    let cancelled = false;
    setDashboardWorkspaceId(current => (current === null ? undefined : current));
    void (async () => {
      const id = await readDashboardWorkspaceId();
      if (!cancelled) {
        setDashboardWorkspaceId(id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsDashboardWorkspace]);

  const target = useMemo(
    () =>
      needsDashboardWorkspace && dashboardWorkspaceId === undefined
        ? { visible: false, path: null, segment: null }
        : resolveDashboardWebViewTarget(segments, searchParams, dashboardWorkspaceId),
    [needsDashboardWorkspace, segments, searchParams, dashboardWorkspaceId],
  );
  const {
    state,
    boot,
    navigate,
    setPresentation,
    setDashboardTabBarHidden,
    setOverlayBottomInset,
  } = useWebViewEngine();

  const lastPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (target.visible && target.path) {
      if (!state.isBooted) {
        boot(target.path);
      }
      setPresentation('overlay');
      setDashboardTabBarHidden(true);
      setOverlayBottomInset(0);
      if (state.isBooted && lastPathRef.current !== target.path) {
        navigate(target.path);
      }
      lastPathRef.current = target.path;
      return;
    }

    lastPathRef.current = null;
    setOverlayBottomInset(0);
    setPresentation('hidden');
  }, [
    dashboardWorkspaceId,
    state.isBooted,
    target.visible,
    target.path,
    boot,
    navigate,
    setPresentation,
    setDashboardTabBarHidden,
    setOverlayBottomInset,
  ]);

  const isResolvingWorkspace = needsDashboardWorkspace && dashboardWorkspaceId === undefined;
  const isWaitingForEngineBoot = Boolean(target.visible && target.path && !state.isBooted);

  return isResolvingWorkspace || isWaitingForEngineBoot ? <DashboardWebViewRouteLoader /> : null;
}

function DashboardWebViewLayerHost(): ReactElement | null {
  const { state } = useWebViewEngine();

  if (!state.isBooted) {
    return null;
  }

  return (
    <Suspense fallback={<DashboardWebViewRouteLoader />}>
      <LazyDashboardWebViewLayer />
    </Suspense>
  );
}

export default function DashboardWebViewShell(): ReactElement {
  return (
    <WebViewEngineProvider>
      <WebViewPresentationController />
      <DashboardWebViewLayerHost />
    </WebViewEngineProvider>
  );
}
