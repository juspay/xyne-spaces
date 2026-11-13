import { useContext } from 'react';
import { WorkflowUIContext } from '../components/provider/workflow-ui-context.js';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';

/**
 * Access the typed workflow HTTP client from context.
 *
 * Throws if used outside a `<WorkflowUIProvider>`.
 */
export function useWorkflowClient(): WorkflowClient {
  const ctx = useContext(WorkflowUIContext);
  if (!ctx) {
    throw new Error(
      'useWorkflowClient must be used within a <WorkflowUIProvider>.',
    );
  }
  return ctx.client;
}
