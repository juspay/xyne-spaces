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
    // Retry on 429 (rate-limit) with exponential backoff. The framework's retry
    // loop honours the Retry-After header when present; otherwise it backs off
    // 5 s → 10 s → 20 s. Three attempts (1 original + 2 retries) is enough to
    // outlast a typical LiteLLM TPM window without blocking the global gate
    // slot for too long.
    retry: {
      maxAttempts: 3,
      baseDelay: 5000,
      maxDelay: 60000,
      exponentialBackoff: true,
    },
  });
}
