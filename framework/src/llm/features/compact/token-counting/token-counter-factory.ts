import { BaseTokenCounter } from './base-token-counter.js';
import { GeminiTokenCounter } from './implementations/gemini-token-counter.js';
import { ClaudeVertexTokenCounter } from './implementations/claude-vertex-token-counter.js';
import { OpenAITokenCounter } from './implementations/openai-token-counter.js';
import { LiteLLMHttpTokenCounter } from './implementations/litellm-http-token-counter.js';
import { FallbackTokenCounter } from './implementations/fallback-token-counter.js';
import type { VertexConfig } from '../../../providers/vertex/schemas.js';
import type { LiteLLMConfig } from '../../../core/types/config.js';

/**
 * Factory for creating appropriate token counters based on provider and model
 */
export class TokenCounterFactory {
  /**
   * Create appropriate token counter for given provider and model
   */
  static create(provider: string, model: string, config: unknown): BaseTokenCounter {
    // Vertex provider models
    if (provider === 'vertex') {
      if (model.includes('gemini')) {
        return new GeminiTokenCounter(model, config as VertexConfig);
      }
      if (model.includes('claude')) {
        return new ClaudeVertexTokenCounter(model, config as VertexConfig);
      }
    }
    
    // LiteLLM provider models - use HTTP-based token counting
    if (provider === 'litellm') {
      return new LiteLLMHttpTokenCounter(model, config as LiteLLMConfig);
    }
    
    // OpenAI provider models - use tiktoken for accurate counting
    if (provider === 'openai') {
      return new OpenAITokenCounter(model, config as LiteLLMConfig);
    }
    
    // Fallback for unknown models
    return new FallbackTokenCounter(model, config);
  }

  /**
   * Get list of supported providers
   */
  static getSupportedProviders(): readonly string[] {
    return ['vertex', 'litellm', 'openai'] as const;
  }

  /**
   * Check if a provider/model combination has native token counting support
   */
  static hasNativeSupport(provider: string, model: string): boolean {
    if (provider === 'vertex') {
      return model.includes('gemini') || model.includes('claude');
    }
    
    if (provider === 'litellm') {
      // All models via LiteLLM HTTP have native support
      return true;
    }
    
    if (provider === 'openai') {
      // OpenAI models have tiktoken support
      return true;
    }
    
    return false;
  }
}