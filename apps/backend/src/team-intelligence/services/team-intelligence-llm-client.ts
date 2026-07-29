import { LLMClient } from '@framework';
import { config as appConfig } from '@/config/env';

/**
 * Team Intelligence uses the backend's shared LiteLLM environment credential.
 * This intentionally mirrors legacy worker behavior and does not require an
 * organization credential to be provisioned in the database.
 */
export function createTeamIntelligenceLlmClient(): LLMClient | null {
  const apiKey = appConfig.llm.litellmApiKey?.trim();
  const baseUrl = appConfig.llm.litellmBaseUrl?.trim();

  if (!apiKey || !baseUrl) {
    return null;
  }

  return new LLMClient({
    provider: {
      type: 'litellm',
      config: {
        apiKey,
        baseUrl,
        timeout: appConfig.llm.requestTimeoutMs,
      },
    },
    defaultModel: appConfig.workflow.defaultModelName,
  });
}
