import { useCallback, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ClawApiError } from '@/services/claw/clawRequest';
import { suggestTools } from '@/services/claw/clawToolsService';
import type { IntegrationToolEntry } from '@/services/claw/clawToolsTypes';
import { matchSuggestedTools } from '../../primitives/suggestionMatch';
import type { McpCatalogEntry } from './mcpCatalog';

export interface SuggestedMcp {
  entry: McpCatalogEntry;
  tools: IntegrationToolEntry[];
}

export interface McpSuggestions {
  status: 'idle' | 'loading' | 'ready' | 'error';
  suggested: SuggestedMcp[];
  error: string | null;
  canRun: boolean;
  run: () => void;
}

function describeError(error: Error | null): string | null {
  if (!error) return null;
  if (error instanceof ClawApiError && error.status >= 500) {
    return 'No suggestions — browse to pick manually';
  }
  if (/timed out|abort/i.test(error.message)) {
    return 'No suggestions — browse to pick manually';
  }
  return error.message;
}

export function useMcpSuggestions(
  catalog: readonly McpCatalogEntry[],
  context: { systemPrompt: string; description: string },
): McpSuggestions {
  const mutation = useMutation({
    mutationFn: suggestTools,
    retry: (failureCount, error) =>
      failureCount < 1 && error instanceof ClawApiError && error.status >= 500,
    retryDelay: 1000,
  });

  const systemPrompt = context.systemPrompt.trim();
  const description = context.description.trim();
  const canRun = systemPrompt.length > 0 || description.length > 0;

  const { mutate, isPending } = mutation;
  const run = useCallback((): void => {
    if (!canRun || isPending) return;
    mutate({
      systemPrompt: systemPrompt || undefined,
      description: systemPrompt ? undefined : description || undefined,
      emptyHubs: ['mcp'],
    });
  }, [canRun, isPending, mutate, systemPrompt, description]);

  const suggested = useMemo(
    () =>
      matchSuggestedTools(
        mutation.data,
        catalog,
        entry => entry.slug,
        entry => entry.tools,
        entry => entry.label,
      ),
    [mutation.data, catalog],
  );

  const status: McpSuggestions['status'] = mutation.isPending
    ? 'loading'
    : mutation.isError
      ? 'error'
      : mutation.isSuccess
        ? 'ready'
        : 'idle';

  return { status, suggested, error: describeError(mutation.error), canRun, run };
}
