import './App.css';
import { ReactElement, useEffect } from 'react';
import { AuthProvider } from './providers/AuthProvider';
import { AnalyticsProvider } from './providers/AnalyticsProvider';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes/AppRoot';
import { ThemeProvider } from '@juspay/blend-design-system';
import { Toaster } from 'sonner';
import './styles/sonner-overrides.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './services/clients/queryClient';
import { XYNE_FOUNDATION_TOKENS } from './themes/XYNE_FOUNDATION_TOKENS';
import { XYNE_DARK_FOUNDATION_TOKENS } from './themes/XYNE_DARK_FOUNDATION_TOKENS';
import {
  XYNE_THEME_COMPONENT_TOKENS,
  XYNE_THEME_COMPONENT_TOKENS_DARK,
} from './themes/componentTokens';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useTheme } from './hooks/useTheme';
import { ShortcutsProvider } from './shortcuts';
import { TooltipProvider } from './components/ui/Tooltip';
import Wallpaper from './components/Wallpaper/Wallpaper';
import OpenInAppGate from './components/OpenInAppGate/OpenInAppGate';
import { initializeTelemetry } from './services/otel/init';
import { KeyboardProvider } from './contexts/KeyboardContext';
import { SwitchLoadingOverlay } from './components/SwitchLoadingOverlay/SwitchLoadingOverlay';
import { RecordingInterruptGuard } from './components/Recording/RecordingInterruptGuard/RecordingInterruptGuard';
import { WorkspaceSwitchToastListener } from './components/WorkspaceSwitchToastListener';
import { TRUSTED_ORIGINS } from '@xyne/shared';
import { parseCallInviteLink } from './components/Chat/RenderMessageWithHTML/internalLinkUtils';
import { joinCallSwitchingIfNeeded } from './machines/roomMachine';
import { detectPlatform } from './hooks/usePlatform';
import { DEFAULT_WORKSPACE_ID } from './config';
import {
  CheckTickCircle,
  AlertCircle,
  AlertTriangle,
  InformationCircle,
  MultipleCrossCancelDefault,
} from '@xyne/icons';

const App = (): ReactElement => {
  // Initialize theme on app load
  const { theme } = useTheme();

  useEffect(() => {
    initializeTelemetry();
  }, []);

  useEffect(() => {
    const handleClick = (event: MouseEvent): void => {
      if (event.defaultPrevented) return;

      const target = event.target as HTMLElement;
      const anchor = target.closest('a');

      if (!anchor || !anchor.href) return;

      if (anchor.protocol === 'blob:') return;

      // A call has one invite URL, shared with teammates and guests alike, so it
      // points at the external lobby app. Checked ahead of the origin test
      // because the invite host is deployment config and need not be one of
      // ours, while the `/external/call/<id>` path shape is.
      //
      // The call is handed to roomActor rather than routed to, so the reader
      // stays on the screen they were reading and GlobalCallOverlay opens the
      // call over it — the same thing every join button in the app does,
      // including leaving a call already in progress for this one.
      // /calls/join is what decides whether the call is theirs to join, and
      // roomMachine falls back to the lobby when it says no, which is why the
      // URL they clicked rides along.
      const callInviteId = parseCallInviteLink(anchor.href);
      if (callInviteId) {
        // Modified clicks mean "open this somewhere else" — left to the browser,
        // as the call-link handling this replaced did. The invite URL still
        // works on its own: the lobby it opens redirects members back in.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        event.preventDefault();
        // Detached windows are their own route tree with no GlobalCallOverlay in
        // it, so a call joined there would have nothing to render it. Those keep
        // going through the call route, which lands on the main app.
        if (router.state.location.pathname.startsWith('/newWindow')) {
          void router.navigate(`/call/${encodeURIComponent(callInviteId)}`, {
            state: { callInviteUrl: anchor.href },
          });
          return;
        }

        joinCallSwitchingIfNeeded({
          type: 'JOIN_CALL',
          callId: callInviteId,
          // roomMachine only forwards this to its disconnect actor, which does
          // not read it; the join itself never touches Zero.
          zero: null,
          viewMode: detectPlatform() === 'mobile' ? 'full' : 'mini',
          externalLobbyUrl: anchor.href,
        });
        return;
      }

      // Check origin directly from anchor element
      if (anchor.origin === window.location.origin || TRUSTED_ORIGINS.includes(anchor.origin)) {
        event.preventDefault();

        const pathname = anchor.pathname;
        const pathSegments = pathname.split('/').filter(Boolean);

        // Check if first segment looks like a workspaceId (cuid format: 20+ alphanumeric chars)
        const hasWorkspaceId = pathSegments[0]?.match(/^[a-z0-9-]{20,}$/i);

        // If no workspaceId and we have a default, prepend it
        if (!hasWorkspaceId && DEFAULT_WORKSPACE_ID) {
          void router.navigate({
            pathname: `/${DEFAULT_WORKSPACE_ID}${pathname}`,
            search: anchor.search,
            hash: anchor.hash,
          });
        } else {
          void router.navigate({
            pathname: anchor.pathname,
            search: anchor.search,
            hash: anchor.hash,
          });
        }
      }
    };

    document.addEventListener('click', handleClick);

    return (): void => {
      document.removeEventListener('click', handleClick);
    };
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
                    <main className='h-screen' style={{ background: 'var(--root-bg)' }}>
                      <Wallpaper />
                      <RouterProvider router={router}></RouterProvider>
                    </main>
                    <SwitchLoadingOverlay />
                    <OpenInAppGate />
                    <RecordingInterruptGuard />
                    <WorkspaceSwitchToastListener />
                    <Toaster
                      position='top-right'
                      richColors
                      closeButton
                      className='visual-regression-hide'
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
};

export default App;
