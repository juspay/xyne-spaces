import '../App.css';
import '../styles/sonner-overrides.css';
import { lazy, Suspense, useEffect, type ReactElement } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { TRUSTED_ORIGINS } from '@xyne/shared';
import { InstrumentationProvider } from '@xyne/shared/hooks';
import { AuthProvider } from '../providers/AuthProvider';
import { AnalyticsProvider } from '../providers/AnalyticsProvider';
import { EncryptionBootstrapProvider } from '../providers/EncryptionBootstrapProvider';
import { EncryptionInit } from '../components/EncryptionInit';
import { dashboardInstrumentation } from '../services/otel/dashboardInstrumentation';
import ZeroProvider from '../providers/ZeroProvider';
import { ZeroFallbackProvider } from '../contexts/ZeroFallbackContext';
import InitialStateLoader from '../providers/InitialStateLoader';
import { EditProvider } from '../providers/EditProvider';
import { queryClient } from '../services/clients/queryClient';
import { createStableRouter, StableRouterContext } from '../hooks/useStableRouter';
import { ShortcutsProvider } from '../shortcuts';
import { KeyboardProvider } from '../contexts/KeyboardContext';
import { TooltipProvider } from '../components/ui/Tooltip';
import { ErrorBoundary, RouterErrorFallback } from '../components/ErrorBoundary';
import { initializeTelemetry } from '../services/otel/init';
import { AppThemeProvider, AppToaster } from '../components/AppShell/AppShell';
import {
  isSandboxViewLink,
  parseCallInviteLink,
} from '../components/Chat/RenderMessageWithHTML/internalLinkUtils';
import { openLink } from '../utils/openLink';
import { toRegularPath } from '../utils/electronApp';
import { openInMainWindow as openInMain } from '../utils/callWindow';
import CallWindowScreen, { CallWindowRoot } from './CallWindowScreen';

// Viewers the call's chat can open (attachments, citations). Loaded after the
// call is up rather than ahead of it: nothing can open them before then.
const CallWindowViewers = lazy(() => import('./CallWindowViewers'));

const openInMainWindow = (appPath: string): void => {
  openInMain(toRegularPath(appPath));
};

/**
 * Links clicked in the call (its chat, mostly). The app's own pages open in the
 * main window — this one only hosts the call. Mirrors the link handling in
 * App.tsx, minus the in-window navigation this window does not have.
 */
const handleLinkClick = (event: MouseEvent): void => {
  if (event.defaultPrevented) return;
  const anchor = (event.target as HTMLElement).closest('a');
  if (!anchor || !anchor.href || anchor.protocol === 'blob:') return;

  const callInviteId = parseCallInviteLink(anchor.href);
  if (callInviteId) {
    // Modified clicks mean "open this somewhere else": left to the browser.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openInMainWindow(`/call/${encodeURIComponent(callInviteId)}`);
    return;
  }

  if (isSandboxViewLink(anchor.href)) {
    event.preventDefault();
    openLink(anchor.href, event, { force: 'in-app' });
    return;
  }

  if (anchor.origin === window.location.origin || TRUSTED_ORIGINS.includes(anchor.origin)) {
    event.preventDefault();
    openInMainWindow(`${anchor.pathname}${anchor.search}${anchor.hash}`);
  }
};

// One page, so one route. A router is still needed: the call's chat uses the
// router hooks, and the navigation guard forwards any navigation to the main
// window.
const router = createBrowserRouter([
  {
    path: '*',
    errorElement: <RouterErrorFallback />,
    element: (
      <CallWindowRoot>
        <InstrumentationProvider value={dashboardInstrumentation}>
          <EncryptionBootstrapProvider>
            <EncryptionInit />
            <ZeroProvider>
              <ZeroFallbackProvider>
                <InitialStateLoader renderBeforeLoaded>
                  <EditProvider>
                    <CallWindowScreen />
                    <Suspense fallback={null}>
                      <CallWindowViewers />
                    </Suspense>
                  </EditProvider>
                </InitialStateLoader>
              </ZeroFallbackProvider>
            </ZeroProvider>
          </EncryptionBootstrapProvider>
        </InstrumentationProvider>
      </CallWindowRoot>
    ),
  },
]);

const stableRouter = createStableRouter(router);

/**
 * The desktop call window's app: the providers the call UI needs and nothing of
 * the rest of the app. See utils/callWindow for how the window is used.
 */
export default function CallWindowApp(): ReactElement {
  useEffect(() => {
    initializeTelemetry();
  }, []);

  useEffect(() => {
    document.addEventListener('click', handleLinkClick);
    return (): void => document.removeEventListener('click', handleLinkClick);
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <KeyboardProvider>
          <AuthProvider>
            <AnalyticsProvider>
              <AppThemeProvider>
                <ShortcutsProvider>
                  <TooltipProvider delayDuration={0}>
                    <StableRouterContext.Provider value={stableRouter}>
                      <RouterProvider router={router} />
                    </StableRouterContext.Provider>
                    <AppToaster />
                  </TooltipProvider>
                </ShortcutsProvider>
              </AppThemeProvider>
            </AnalyticsProvider>
          </AuthProvider>
        </KeyboardProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
