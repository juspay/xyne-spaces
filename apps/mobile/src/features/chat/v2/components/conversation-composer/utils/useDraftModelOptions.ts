import { useQuery } from '@tanstack/react-query';

import { listClawProviderModels } from '@/src/services/claw/clawModelService';
import { buildModelOptions, type AgentModelOption } from '@/src/utils/flowAgentEditor';

const SCOPED_PROVIDERS = new Set(['claude', 'codex', 'copilot']);

export const useDraftModelOptions = (input: {
  provider?: string | undefined;
  userId: string;
  modelId: string;
  enabled: boolean;
}): { options: AgentModelOption[]; hint: string | null } => {
  const scoped =
    input.provider && SCOPED_PROVIDERS.has(input.provider)
      ? (input.provider as 'claude' | 'codex' | 'copilot')
      : null;

  const catalog = useQuery({
    queryKey: ['claw-provider-models', scoped, input.userId],
    queryFn: () => listClawProviderModels(scoped ?? 'claude', input.userId),
    enabled: input.enabled && scoped !== null && input.userId.length > 0,
    staleTime: 60_000,
    retry: false,
  });

  const options = buildModelOptions({
    modelId: input.modelId,
    provider: input.provider,
    ...(catalog.data ? { catalog: catalog.data } : {}),
  });

  return {
    options,
    hint:
      catalog.isFetched && (catalog.data?.length ?? 0) === 0
        ? 'No models returned for this provider. The agent will use the platform default.'
        : null,
  };
};
