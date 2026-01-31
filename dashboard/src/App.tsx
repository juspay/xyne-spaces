import './App.css';
import { ReactElement, useEffect } from 'react';
import { AuthProvider } from './providers/AuthProvider';
import { AnalyticsProvider } from './providers/AnalyticsProvider';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes/AppRoot';
import { ThemeProvider } from '@juspay/blend-design-system';
import { Toaster } from 'sonner';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './services/clients/queryClient';
import { XYNE_FOUNDATION_TOKENS } from './themes/XYNE_FOUNDATION_TOKENS';
import { XYNE_THEME_COMPONENT_TOKENS } from './themes/componentTokens';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DragDropFileProvider } from './contexts/DragDropFileContext';
import { useTheme } from './hooks/useTheme';
import { ShortcutsProvider } from './shortcuts';
import { CodeServerProvider } from './contexts/CodeServerContext';
import { VSCodeProvider } from './contexts/VSCodeContext';
import { WorkflowVSCodeOverlay } from './components/Workflows/VSCodePanel/WorkflowVSCodeOverlay';
import { initializeTelemetry } from './services/otel/init';

const App = (): ReactElement => {
  // Initialize theme on app load
  useTheme();

  // Listen for Electron logs
  useEffect(() => {
    if (window.electronAPI?.onLog) {
      return window.electronAPI.onLog(message => {
        // Extract message content
        const data = message.data || [];
        const text = Array.isArray(data) ? data.join(' ') : String(data);

        // Log to console with distinct color but without extra prefix
        console.log(`%c${text}`, 'color: #00bcd4');
      });
    }
    // Return undefined explicitly when condition is not met
    return undefined;
  }, []);

  useEffect(() => {
    initializeTelemetry();
  }, []);

  useEffect(() => {
    const handleClick = (event: MouseEvent): void => {
      if (event.defaultPrevented) return;

      const target = event.target as HTMLElement;
      const anchor = target.closest('a');

      if (!anchor || !anchor.href) return;

      const url = new URL(anchor.href);
      const currentOrigin = window.location.origin;

      if (url.protocol === 'blob:') return;

      if (url.origin === currentOrigin) {
        event.preventDefault();
        const path = url.pathname + url.search + url.hash;
        void router.navigate(path);
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
        <AuthProvider>
          <AnalyticsProvider>
            <CodeServerProvider>
              <VSCodeProvider>
                <ThemeProvider
                  foundationTokens={XYNE_FOUNDATION_TOKENS}
                  componentTokens={XYNE_THEME_COMPONENT_TOKENS}
                >
                  <DragDropFileProvider>
                    <ShortcutsProvider>
                      <main className='h-screen' style={{ background: 'var(--root-bg)' }}>
                        <RouterProvider router={router}></RouterProvider>
                      </main>
                      <Toaster
                        position='top-right'
                        richColors
                        closeButton
                        toastOptions={{
                          style: {
                            alignItems: 'flex-start',
                            background: '#000000',
                            color: '#ffffff',
                            border: '1px solid #27272a',
                          },
                          classNames: {
                            toast: 'relative items-start group !pt-3 !pr-3 !pb-3 !pl-4',
                            icon: 'mt-1',
                            title: '!text-white !font-semibold !max-w-[calc(100%-2rem)] !mr-8',
                            description: '!text-white !opacity-80',

                            actionButton: '!bg-white !text-black hover:!bg-zinc-200 !mt-8',
                            cancelButton: '!bg-zinc-800 !text-white hover:!bg-zinc-700 !mt-8',

                            closeButton:
                              '!absolute !right-3 !top-5 !left-auto !bg-transparent !opacity-100 !text-white hover:!opacity-50 rounded-md z-10',

                            success: '!text-green-500 !border-green-100',
                            error: '!text-red-500 !border-red-100',
                            warning: '!text-yellow-500 !border-yellow-100',
                            info: '!text-blue-500 !border-blue-100',
                          },
                        }}
                      />
                      <WorkflowVSCodeOverlay />
                    </ShortcutsProvider>
                  </DragDropFileProvider>
                </ThemeProvider>
              </VSCodeProvider>
            </CodeServerProvider>
          </AnalyticsProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
