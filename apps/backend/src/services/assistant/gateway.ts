import { config } from '@/config/env';
import type { JevConnection } from '@/services/queryIntent/jevClient';

/** Jev on the LiteLLM gateway, or null when the gateway is not set up. */
export function jevConnection(): JevConnection | null {
  const baseUrl = config.litellm.baseUrl.trim().replace(/\/$/, '');
  const { apiKey } = config.litellm;
  return baseUrl && apiKey ? { url: `${baseUrl}/v1/systemone`, apiKey, model: 'jev-latest' } : null;
}
