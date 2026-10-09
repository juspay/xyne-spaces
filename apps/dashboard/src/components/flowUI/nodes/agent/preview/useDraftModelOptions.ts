import { useQuery } from '@tanstack/react-query';
import { PROVIDER_DISPLAY } from '@/services/claw/modelProviderConfig';
import {
  listClaudeModelsForUser,
  listCodexModelsForUser,
  listCopilotModelsForUser,
} from '@/services/claw/clawSettingsService';
import { fetchClawAgentModels } from '@/services/clawAgentModelsService';

export interface DraftModelOption {
  value: string;
  label: string;
}

export interface DraftModelOptions {
  options: DraftModelOption[];
  loading: boolean;
  hint: string | null;
}

export function providerDisplayName(provider: string): string {
  return PROVIDER_DISPLAY[provider] ?? provider;
}

export function needsProviderKey(provider: string | undefined): provider is string {
  return Boolean(provider) && provider !== 'spaces';
}

export function defaultModelLabel(provider: string | undefined): string {
  if (!provider || provider === 'spaces') {
    return 'Platform default';
  }
  return `${providerDisplayName(provider)} default`;
}

const PROVIDER_CATALOGS = new Set(['claude', 'codex', 'copilot']);

async function listForProvider(provider: string, userId: string): Promise<DraftModelOption[]> {
  if (provider === 'claude') {
    const rows = await listClaudeModelsForUser(userId);
    return rows.map(row => ({ value: row.id, label: row.displayName || row.id }));
  }
  if (provider === 'codex') {
    const rows = await listCodexModelsForUser(userId);
    return rows.map(row => ({ value: row.id, label: row.name || row.id }));
  }
  const rows = await listCopilotModelsForUser(userId);
  return rows.map(row => ({ value: row.id, label: row.name || row.id }));
}

export function useDraftModelOptions({
  provider,
  userId,
  posterSlug,
  enabled,
}: {
  provider: string | undefined;
  userId: string;
  posterSlug: string;
  enabled: boolean;
}): DraftModelOptions {
  const scoped = provider && PROVIDER_CATALOGS.has(provider) ? provider : null;

  const platform = useQuery({
    queryKey: ['claw-agent-models', posterSlug],
    queryFn: () => fetchClawAgentModels(posterSlug),
    enabled: enabled && !scoped && posterSlug.length > 0,
    staleTime: 60_000,
  });

  const scopedModels = useQuery({
    queryKey: ['claw-provider-models', scoped, userId],
    queryFn: () => listForProvider(scoped ?? '', userId),
    enabled: enabled && scoped !== null && userId.length > 0,
    retry: false,
    staleTime: 60_000,
  });

  if (!scoped) {
    return {
      options: (platform.data?.models ?? []).map(model => ({
        value: model.id,
        label: model.name || model.id,
      })),
      loading: platform.isLoading,
      hint: null,
    };
  }

  const label = providerDisplayName(scoped);
  const asked = scopedModels.isFetched;
  const cameBackEmpty = asked && (scopedModels.isError || (scopedModels.data?.length ?? 0) === 0);
  return {
    options: scopedModels.data ?? [],
    loading: scopedModels.isLoading,
    hint: cameBackEmpty ? `Connect ${label} in Settings to choose one of its models.` : null,
  };
}
