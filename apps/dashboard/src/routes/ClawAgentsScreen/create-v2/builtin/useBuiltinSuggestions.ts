import { useCallback, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ClawApiError } from '@/services/claw/clawRequest';
import { suggestTools } from '@/services/claw/clawToolsService';
import type { IntegrationToolEntry } from '@/services/claw/clawToolsTypes';
import { matchSuggestedTools } from '../shared/suggestionMatch';
import type { BuiltinCatalogEntry } from './builtinCatalog';

export interface SuggestedBuiltin {
  entry: BuiltinCatalogEntry;
  tools: IntegrationToolEntry[];
}

export interface BuiltinSuggestions {
  status: 'idle' | 'loading' | 'ready' | 'error';
  suggested: SuggestedBuiltin[];
  error: string | null;
  canRun: boolean;
  run: () => void;
}

function describeError(error: Error | null): string | null {
  if (!error) return null;
  if (error instanceof ClawApiError && error.status >= 500) return 'the suggestion service is busy';
  return error.message;
}

export function useBuiltinSuggestions(
  catalog: readonly BuiltinCatalogEntry[],
  context: { systemPrompt: string; description: string },
): BuiltinSuggestions {
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
    () =>
      matchSuggestedTools(
        mutation.data,
        catalog,
        entry => entry.source,
        entry => entry.tools,
        entry => entry.label,
      ),
    [mutation.data, catalog],
  );

  const status: BuiltinSuggestions['status'] = mutation.isPending
    ? 'loading'
    : mutation.isError
      ? 'error'
      : mutation.isSuccess
        ? 'ready'
        : 'idle';

  return { status, suggested, error: describeError(mutation.error), canRun, run };
}
