import { createContext, useContext } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';
import type { SlotOverrides, ClassNamesOverrides } from '../../types/slots.js';

/**
 * Configuration for the WorkflowUIProvider.
 */
export interface WorkflowUIConfig {
  /** Pre-built workflow client (from @xyne/workflow-sdk/client). */
  client: WorkflowClient;
  /** Optional: bring your own QueryClient for shared cache. */
  queryClient?: QueryClient;
  /** Global component replacements. */
  slots?: SlotOverrides;
  /** Global class overrides. */
  classNames?: ClassNamesOverrides;
  /**
   * Classes for the provider's own wrapper element.
   *
   * The provider renders a real `<div data-workflow-ui>` between the host's layout and
   * the components, so a host embedding a full-height pane needs to size that div — and
   * `h-full` on the component inside cannot do it, because it resolves against this
   * wrapper. Without this prop the only way to reach the element is a descendant selector
   * keyed on the package's DOM shape, which breaks the moment anything is nested between
   * the two.
   */
  className?: string;
}

/**
 * Internal context value — always has a client.
 */
export interface WorkflowUIContextValue {
  client: WorkflowClient;
  slots: SlotOverrides;
  classNames: ClassNamesOverrides;
}

export const WorkflowUIContext = createContext<WorkflowUIContextValue | null>(null);

/**
 * Access the workflow UI context. Throws if used outside a provider.
 */
export function useWorkflowUI(): WorkflowUIContextValue {
  const ctx = useContext(WorkflowUIContext);
  if (!ctx) {
    throw new Error(
      'useWorkflowUI must be used within a <WorkflowUIProvider>. ' +
      'Wrap your component tree with <WorkflowUIProvider client={...}>.',
    );
  }
  return ctx;
}
