import type { VertexConfig } from '../../providers/vertex/schemas.js';

/**
 * Core configuration types for provider-agnostic LLM client
 * Uses discriminated union for type-safe provider configuration
 */

/**
 * LiteLLM provider configuration
 */
export interface LiteLLMConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly timeout?: number;
  readonly retries?: number;
  readonly rateLimiting?: boolean;
  readonly enableLogging?: boolean;
  readonly customHeaders?: Record<string, string>;
  readonly proxyUrl?: string;
}

/**
 * LiteLLM configuration with defaults applied
 */
export interface LiteLLMConfigWithDefaults extends LiteLLMConfig {
  readonly timeout: number;
  readonly retries: number;
  readonly rateLimiting: boolean;
  readonly enableLogging: boolean;
}

/**
 * Vertex provider configuration wrapper
 */
export interface VertexProviderConfig {
  readonly type: 'vertex';
  readonly config: VertexConfig;
}

/**
 * LiteLLM provider configuration wrapper
 */
export interface LiteLLMProviderConfig {
  readonly type: 'litellm';
  readonly config: LiteLLMConfig;
}

/**
 * Discriminated union of all provider configurations
 */
export type ProviderConfiguration = VertexProviderConfig | LiteLLMProviderConfig;

/**
 * Main LLM client configuration interface
 * Uses discriminated union for type-safe provider selection
 */
export interface LLMClientConfig {
  readonly provider: ProviderConfiguration;
  readonly defaultModel: string;
  readonly features?: {
    readonly healthMonitoring?: boolean;
    readonly autoTemperature?: boolean;
    readonly enableLogging?: boolean;
    readonly thinkingMode?: boolean;
  };
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly thinkingBudget?: number;
  readonly retry?: {
    readonly maxAttempts?: number | undefined;
    readonly baseDelay?: number | undefined;
    readonly maxDelay?: number | undefined;
    readonly exponentialBackoff?: boolean | undefined;
  };
}

/**
 * Type guards for provider configuration
 */
export function isVertexProviderConfig(
  config: ProviderConfiguration
): config is VertexProviderConfig {
  return config.type === 'vertex';
}

export function isLiteLLMProviderConfig(
  config: ProviderConfiguration
): config is LiteLLMProviderConfig {
  return config.type === 'litellm';
}

/**
 * Extract provider type from configuration
 */
export function getProviderType(config: LLMClientConfig): string {
  return config.provider.type;
}

/**
 * Extract provider config with proper typing
 */
export function getProviderConfig<T extends ProviderConfiguration['type']>(
  config: LLMClientConfig,
  expectedType: T
): T extends 'vertex' ? VertexConfig : T extends 'litellm' ? LiteLLMConfig : never {
  if (config.provider.type !== expectedType) {
    throw new Error(`Expected provider type ${expectedType}, got ${config.provider.type}`);
  }
  return config.provider.config as T extends 'vertex' ? VertexConfig : T extends 'litellm' ? LiteLLMConfig : never;
}