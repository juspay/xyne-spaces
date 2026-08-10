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
        // Team Intelligence uses a dedicated timeout (defaults to the global
        // LLM_REQUEST_TIMEOUT_MS, but can be raised or set to 0 for no timeout)
        // so long-running summary calls aren't cut off, without changing the
        // timeout for other LLM consumers.
        timeout: appConfig.llm.teamIntelligenceRequestTimeoutMs,
      },
    },
    defaultModel: appConfig.teamIntelligence.model,
    // Section-level fallback owns Team Intelligence recovery. Keeping provider
    // retries to one attempt prevents a long LLM timeout from multiplying into
    // several hidden waits inside every section call.
    retry: {
      maxAttempts: 1,
      baseDelay: 0,
      maxDelay: 0,
      exponentialBackoff: false,
    },
  });
}
