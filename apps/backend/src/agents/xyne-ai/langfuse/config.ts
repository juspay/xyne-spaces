import { config } from '@/config/env';
/**
 * Langfuse Configuration
 * 
 * Shared configuration for both prompts and tracing.
 */

export interface LangfuseConfig {
  secretKey: string;
  publicKey: string;
  baseUrl: string;
  enabled: boolean;
}

export function getLangfuseConfig(): LangfuseConfig {
  const secretKey = config.langfuse.secretKey || '';
  const publicKey = config.langfuse.publicKey || '';
  const baseUrl = config.langfuse.baseUrl || '';
  
  // All three credentials must be present for Langfuse to be enabled
  const enabled = Boolean(secretKey && publicKey && baseUrl);
  
  return {
    secretKey,
    publicKey,
    baseUrl,
    enabled,
  };
}
