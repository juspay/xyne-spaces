/**
 * Service for fetching the models an agent can run on.
 *
 * The list is scoped to the AGENT's shared LiteLLM credential (claw-auth reads
 * it off that key's own /v1/models), so the picker can only ever offer models
 * the run will actually accept. Agents with no litellm credential return an
 * empty list — the picker hides rather than offering choices that would be
 * ignored.
 */
import { apiInstance } from './clients/apiClient';

export interface ClawAgentModel {
  id: string;
  /** Claw's label for the model. Raw model id today. */
  name: string;
}

export interface ClawAgentModelsResult {
  models: ClawAgentModel[];
  /** The agent's configured model, used to label the "Default" row. */
  defaultModel: string | null;
  /** Which providerOverride.provider a pick from this list must be sent with:
   *  "litellm" = the agent's shared credential, "spaces" = the keyless
   *  platform provider (the workspace's synced allowed-model list). */
  pinProvider: 'litellm' | 'spaces';
}

export async function fetchClawAgentModels(agentSlug: string): Promise<ClawAgentModelsResult> {
  const response = await apiInstance.get<{
    success: boolean;
    data: ClawAgentModel[];
    defaultModel: string | null;
    pinProvider?: 'litellm' | 'spaces';
  }>(`/xyne-ai/agents/${encodeURIComponent(agentSlug)}/models`);
  const result = response.data;
  if (!result.success) {
    throw new Error('Failed to fetch models');
  }
  return {
    models: result.data ?? [],
    defaultModel: result.defaultModel ?? null,
    pinProvider: result.pinProvider ?? 'litellm',
  };
}
