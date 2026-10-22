import { apiGet } from '@/src/services/apiClient';

export interface XyneAIAgent {
  slug: string;
  name: string;
  color: string;
  instantAgent?: boolean;
}

export interface XyneAIModel {
  id: string;
  /** People-facing name and blurb; absent from older servers. */
  name?: string;
  description?: string;
  provider?: string;
}

export interface XyneAIModels {
  models: XyneAIModel[];
  pinProvider: string;
  /** What "Auto" resolves to. */
  defaultModelName: string | undefined;
}

export interface XyneAIConfig {
  webSearchAccessible: boolean;
  deepResearchAccessible: boolean;
}

export const DEFAULT_AGENT_SLUG = 'ask-ai';

export async function fetchAgents(): Promise<XyneAIAgent[]> {
  const { data } = await apiGet<{ data: XyneAIAgent[] }>('/xyne-ai/agents');
  return data.filter(agent => agent.slug !== DEFAULT_AGENT_SLUG);
}

export async function fetchModels(agentSlug: string): Promise<XyneAIModels> {
  const { data, pinProvider, defaultModelName, defaultModel } = await apiGet<{
    data: XyneAIModel[];
    pinProvider?: string;
    defaultModelName?: string | null;
    defaultModel?: string | null;
  }>(`/xyne-ai/agents/${encodeURIComponent(agentSlug)}/models`);
  return {
    // Models served from a developer's own machine cannot be reached from a phone.
    models: data.filter(model => model.provider !== 'local-harness'),
    pinProvider: pinProvider ?? 'litellm',
    defaultModelName: defaultModelName ?? defaultModel ?? undefined,
  };
}

export async function fetchConfig(): Promise<XyneAIConfig> {
  const config = await apiGet<Partial<XyneAIConfig>>('/xyne-ai/config');
  return {
    webSearchAccessible: config.webSearchAccessible ?? false,
    deepResearchAccessible: config.deepResearchAccessible ?? false,
  };
}
