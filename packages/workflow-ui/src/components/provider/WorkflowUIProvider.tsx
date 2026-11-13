import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  WorkflowUIContext,
  type WorkflowUIConfig,
  type WorkflowUIContextValue,
} from './workflow-ui-context.js';
import { LiveEventsProvider } from '../../live/LiveEventsProvider.js';

function createDefaultQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        // Reads are event-driven; focus and reconnect cover the lists with no
        // topic to subscribe to. Neither is a timer.
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
    },
  });
}

/**
 * Root provider for @xyne/workflow-ui.
 *
 * Wraps your component tree with the workflow client, TanStack Query,
 * and global customization (slots, classNames).
 *
 * ```tsx
 * <WorkflowUIProvider client={workflowClient}>
 *   <WorkflowDashboard />
 * </WorkflowUIProvider>
 * ```
 */
export function WorkflowUIProvider({
  client,
  queryClient,
  slots,
  classNames,
  className,
  children,
}: WorkflowUIConfig & { children: React.ReactNode }) {
  const value = React.useMemo<WorkflowUIContextValue>(
    () => ({
      client,
      slots: slots ?? {},
      classNames: classNames ?? {},
    }),
    [client, slots, classNames],
  );

  // One per provider instance, not a module singleton: a shared cache across
  // providers is invisible in an app and cross-contaminates tests. A host that
  // wants sharing passes `queryClient`.
  const [fallbackClient] = React.useState(createDefaultQueryClient);
  const qc = queryClient ?? fallbackClient;

  return (
    <QueryClientProvider client={qc}>
      <WorkflowUIContext.Provider value={value}>
        {/*
          Inside the QueryClientProvider, because a change notification's whole
          job is to invalidate a query; outside the components, because they all
          share the one connection it owns.
        */}
        <LiveEventsProvider client={client}>
          <div data-workflow-ui="" className={className}>
            {children}
          </div>
        </LiveEventsProvider>
      </WorkflowUIContext.Provider>
    </QueryClientProvider>
  );
}
