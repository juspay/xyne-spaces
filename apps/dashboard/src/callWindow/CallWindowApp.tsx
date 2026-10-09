import '../App.css';
import '../styles/sonner-overrides.css';
import { lazy, Suspense, useEffect, type ReactElement } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ThemeProvider } from '@juspay/blend-design-system';
import { Toaster } from 'sonner';
import { QueryClientProvider } from '@tanstack/react-query';
import { TRUSTED_ORIGINS } from '@xyne/shared';
import {
  CheckTickCircle,
  AlertCircle,
  AlertTriangle,
  InformationCircle,
  MultipleCrossCancelDefault,
} from '@xyne/icons';
import { AuthProvider } from '../providers/AuthProvider';
import { AnalyticsProvider } from '../providers/AnalyticsProvider';
import { EncryptionBootstrapProvider } from '../providers/EncryptionBootstrapProvider';
import ZeroProvider from '../providers/ZeroProvider';
import { ZeroFallbackProvider } from '../contexts/ZeroFallbackContext';
import InitialStateLoader from '../providers/InitialStateLoader';
import { EditProvider } from '../providers/EditProvider';
import { queryClient } from '../services/clients/queryClient';
import { createStableRouter, StableRouterContext } from '../hooks/useStableRouter';
import { useTheme } from '../hooks/useTheme';
import { ShortcutsProvider } from '../shortcuts';
import { KeyboardProvider } from '../contexts/KeyboardContext';
import { TooltipProvider } from '../components/ui/Tooltip';
import { ErrorBoundary, RouterErrorFallback } from '../components/ErrorBoundary';
import { initializeTelemetry } from '../services/otel/init';
import { XYNE_FOUNDATION_TOKENS } from '../themes/XYNE_FOUNDATION_TOKENS';
import { XYNE_DARK_FOUNDATION_TOKENS } from '../themes/XYNE_DARK_FOUNDATION_TOKENS';
import {
  XYNE_THEME_COMPONENT_TOKENS,
  XYNE_THEME_COMPONENT_TOKENS_DARK,
} from '../themes/componentTokens';
import {
  isSandboxViewLink,
  parseCallInviteLink,
} from '../components/Chat/RenderMessageWithHTML/internalLinkUtils';
import { openLink } from '../utils/openLink';
import { toRegularPath } from '../utils/electronApp';
import CallWindowScreen, { CallWindowRoot } from './CallWindowScreen';

// Viewers the call's chat can open (attachments, citations). Loaded after the
// call is up rather than ahead of it: nothing can open them before then.
const CallWindowViewers = lazy(() => import('./CallWindowViewers'));

const openInMainWindow = (appPath: string): void => {
  window.electronAPI?.callWindow?.openInMain(toRegularPath(appPath));
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
        <EncryptionBootstrapProvider>
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
  const { theme } = useTheme();

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
              <ThemeProvider
                foundationTokens={
                  theme === 'midnight' ? XYNE_DARK_FOUNDATION_TOKENS : XYNE_FOUNDATION_TOKENS
                }
                componentTokens={
                  theme === 'midnight'
                    ? XYNE_THEME_COMPONENT_TOKENS_DARK
                    : XYNE_THEME_COMPONENT_TOKENS
                }
                theme={theme === 'midnight' ? 'dark' : 'light'}
              >
                <ShortcutsProvider>
                  <TooltipProvider delayDuration={0}>
                    <StableRouterContext.Provider value={stableRouter}>
                      <RouterProvider router={router} />
                    </StableRouterContext.Provider>
                    <Toaster
                      position='top-right'
                      richColors
                      closeButton
                      icons={{
                        success: <CheckTickCircle size={20} />,
                        error: <AlertCircle size={20} />,
                        warning: <AlertTriangle size={20} />,
                        info: <InformationCircle size={20} />,
                        close: <MultipleCrossCancelDefault size={16} />,
                      }}
                      toastOptions={{
                        style: {
                          alignItems: 'flex-start',
                          background: 'hsl(var(--card))',
                          color: 'hsl(var(--card-foreground))',
                          border: '1px solid hsl(var(--border))',
                          pointerEvents: 'auto',
                        },
                        classNames: {
                          toast: 'relative items-start group !pt-3 !pr-3 !pb-3 !pl-4',
                          icon: 'mt-1',
                          title:
                            '!text-card-foreground !font-semibold !max-w-[calc(100%-2rem)] !mr-8',
                          description: '!text-card-foreground/80',
                          actionButton:
                            '!bg-primary !text-primary-foreground hover:!bg-primary/90 !mt-8',
                          cancelButton:
                            '!bg-secondary !text-secondary-foreground hover:!bg-secondary/80 !mt-8',
                          closeButton:
                            '!absolute !right-3 !top-5 !left-auto !bg-transparent !border-0 !ring-0 focus:!ring-0 focus:!outline-none !opacity-100 !text-card-foreground hover:!opacity-50 rounded-md z-10',
                          success: '!text-status-success',
                          error: '!text-status-failure',
                          warning: '!text-status-pending',
                          info: '!text-status-scheduled',
                        },
                      }}
                    />
                  </TooltipProvider>
                </ShortcutsProvider>
              </ThemeProvider>
            </AnalyticsProvider>
          </AuthProvider>
        </KeyboardProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
