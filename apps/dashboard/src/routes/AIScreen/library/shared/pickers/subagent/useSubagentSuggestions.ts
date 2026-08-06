import { useCallback, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ClawApiError } from '@/services/claw/clawRequest';
import { suggestTools } from '@/services/claw/clawToolsService';
import type { ToolSuggestion } from '@/services/claw/clawToolsTypes';
import type { SubagentCatalogEntry } from './subagentCatalog';

export interface SubagentSuggestions {
  status: 'idle' | 'loading' | 'ready' | 'error';
  suggested: SubagentCatalogEntry[];
  error: string | null;
  canRun: boolean;
  run: () => void;
}

function resolveSuggestion(
  suggestion: ToolSuggestion | undefined,
  catalog: readonly SubagentCatalogEntry[],
): SubagentCatalogEntry[] {
  if (!suggestion) return [];
  const names = new Set(suggestion.subagents ?? []);
  if (names.size === 0) return [];
  return catalog.filter(entry => names.has(entry.name));
}

function describeError(error: Error | null): string | null {
  if (!error) return null;
  if (error instanceof ClawApiError && error.status >= 500) return 'the suggestion service is busy';
  return error.message;
}

export function useSubagentSuggestions(
  catalog: readonly SubagentCatalogEntry[],
  context: { systemPrompt: string; description: string },
): SubagentSuggestions {
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
    });
  }, [canRun, isPending, mutate, systemPrompt, description]);

  const suggested = useMemo(
    () => resolveSuggestion(mutation.data, catalog),
    [mutation.data, catalog],
  );

  const status: SubagentSuggestions['status'] = mutation.isPending
    ? 'loading'
    : mutation.isError
      ? 'error'
      : mutation.isSuccess
        ? 'ready'
        : 'idle';

  return { status, suggested, error: describeError(mutation.error), canRun, run };
}
