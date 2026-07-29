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
  const secretKey = process.env.LANGFUSE_SECRET_KEY || '';
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY || '';
  const baseUrl = process.env.LANGFUSE_BASE_URL || '';
  
  // All three credentials must be present for Langfuse to be enabled
  const enabled = Boolean(secretKey && publicKey && baseUrl);
  
  return {
    secretKey,
    publicKey,
    baseUrl,
    enabled,
  };
}
