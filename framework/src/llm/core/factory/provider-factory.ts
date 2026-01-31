import type { LLMProvider } from '../types/providers.js';
import type { ProviderConfiguration } from '../types/config.js';
import { VertexProvider } from '../../providers/vertex/vertex-provider.js';
import { LiteLLMProvider } from '../../providers/litellm/litellm-provider.js';
import {
  LLMErrorClass,
  createProviderValidationError
} from '../errors/index.js';

/**
 * Provider factory function that creates providers based on configuration
 * Uses discriminated union for type-safe provider instantiation
 */
export function createProvider(config: ProviderConfiguration): LLMProvider {
  switch (config.type) {
    case 'vertex':
      return new VertexProvider(config.config);
    
    case 'litellm':
      // Apply defaults for required fields that are optional in config
      return new LiteLLMProvider({
        ...config.config,
        timeout: config.config.timeout ?? 30000,
        retries: config.config.retries ?? 3,
        rateLimiting: config.config.rateLimiting ?? true,
        enableLogging: config.config.enableLogging ?? true
      });
    
    default: {
      // TypeScript exhaustiveness check ensures we handle all provider types
      const _exhaustiveCheck: never = config;
      throw new LLMErrorClass(createProviderValidationError(
        'unknown',
        [`Unsupported provider type: ${String(_exhaustiveCheck)}`]
      ));
    }
  }
}

/**
 * Get list of available provider types
 */
export function getAvailableProviders(): readonly string[] {
  return ['vertex', 'litellm'] as const;
}

/**
 * Check if a provider type is supported
 */
export function isProviderSupported(providerType: string): boolean {
  return getAvailableProviders().includes(providerType);
}

/**
 * Validate provider configuration without creating the provider
 */
export function validateProviderConfiguration(config: ProviderConfiguration): boolean {
  try {
    // Basic type checking is handled by TypeScript discriminated union
    // Additional validation can be added here if needed
    switch (config.type) {
      case 'vertex':
        // Vertex validation is handled in VertexProvider constructor
        return true;
      case 'litellm':
        // LiteLLM validation is handled in LiteLLMProvider constructor
        return true;
      default:
        return false;
    }
  } catch {
    return false;
  }
}