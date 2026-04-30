import type { Message } from './messages.js';
import type { ToolDefinition } from './tools.js';

/**
 * Request and response types for LLM interactions
 */

/**
 * Core LLM request interface
 */
export interface LLMRequest {
  readonly messages: readonly Message[];
  readonly systemPrompt?: string; // External system prompt (optional)
  readonly model: string;
  readonly provider: string;
  readonly tools?: readonly ToolDefinition[];
  readonly parameters?: ModelParameters;
  readonly features?: RequestFeatures;
  /** Additional body parameters for provider-specific options (e.g., extra_body for LiteLLM) */
  readonly extraBody?: Record<string, unknown>;
}

/**
 * Model parameters for fine-grained control
 */
export interface ModelParameters {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly topP?: number;
  readonly topK?: number;
  readonly frequencyPenalty?: number;
  readonly presencePenalty?: number;
  readonly stopSequences?: readonly string[];
  readonly extraBody?: Record<string, unknown>; // Additional provider-specific parameters
}

/**
 * Enhanced thinking configuration for advanced models
 */
export interface ThinkingConfig {
  readonly enabled: boolean;
  readonly budgetTokens?: number; // Max tokens for thinking (Gemini)
  readonly includeThoughts?: boolean; // Include thinking in response
  readonly interleavedThinking?: boolean; // Claude 4 interleaved thinking
  readonly adaptiveBudget?: boolean; // Auto-adjust thinking budget
}

/**
 * Advanced request features
 */
export interface RequestFeatures {
  readonly streaming?: boolean;
  readonly thinking?: ThinkingConfig; // Enhanced thinking configuration
  readonly autoTemperature?: boolean; // Let system decide temperature
  readonly toolChoice?: 'auto' | 'none' | 'required';
  readonly responseFormat?: 'text' | 'json';
}

/**
 * Core LLM response interface
 */
export interface LLMResponse {
  readonly id: string;
  readonly model: string;
  readonly provider: string;
  readonly content: string;
  readonly thinking?: string; // Thinking mode output
  readonly thinkingSignature?: string; // Thinking signature for conversation history
  readonly toolCalls?: readonly import('./messages.js').ToolCall[];
  readonly usage: TokenUsage;
  readonly metadata: ResponseMetadata;
  readonly finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
  readonly latency?: number;
}

/**
 * Token usage information
 */
export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly thinkingTokens?: number; // Tokens used in thinking mode
}

/**
 * Response metadata for debugging and monitoring
 */
export interface ResponseMetadata {
  readonly requestId: string;
  readonly model: string;
  readonly provider: string;
  readonly timestamp: Date;
  readonly processingTime: number;
  readonly apiVersion?: string;
  readonly region?: string;
  readonly cached?: boolean;
  readonly retryCount?: number;
  readonly rawResponse?: unknown; // Original provider response (for debugging)
}


/**
 * Temperature context for smart temperature management
 */
export interface TemperatureContext {
  readonly taskType: TaskType;
  readonly thinking?: ThinkingConfig;
  readonly userSpecified?: number;
  readonly model: string;
  readonly provider: string;
  readonly hasTools?: boolean;
}

/**
 * Task types for automatic parameter optimization
 */
export type TaskType =
  | 'thinking_mode'
  | 'tool_calling'
  | 'code_generation'
  | 'factual_queries'
  | 'analysis'
  | 'creative_writing'
  | 'brainstorming'
  | 'conversation';

/**
 * Model capabilities information
 */
export interface ModelCapabilities {
  readonly supportsToolCalling: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsThinking: boolean;
  readonly supportsVision?: boolean;
  readonly maxTokens: number;
  readonly maxInputTokens?: number;
  readonly contextWindow?: number;
  readonly supportedLanguages?: readonly string[];
  readonly supportedFormats?: readonly string[];
}

/**
 * Request validation helpers
 */
export function validateLLMRequest(request: LLMRequest): string[] {
  const errors: string[] = [];

  if (!request.messages || request.messages.length === 0) {
    errors.push('Messages array cannot be empty');
  }

  if (!request.model || request.model.trim() === '') {
    errors.push('Model name is required');
  }

  if (!request.provider || request.provider.trim() === '') {
    errors.push('Provider name is required');
  }

  if (request.parameters?.temperature !== undefined) {
    if (request.parameters.temperature < 0 || request.parameters.temperature > 2) {
      errors.push('Temperature must be between 0 and 2');
    }
  }

  if (request.parameters?.maxTokens !== undefined) {
    if (request.parameters.maxTokens < 1) {
      errors.push('maxTokens must be positive');
    }
  }

  if (request.parameters?.topP !== undefined) {
    if (request.parameters.topP < 0 || request.parameters.topP > 1) {
      errors.push('topP must be between 0 and 1');
    }
  }

  return errors;
}

/**
 * Create a basic LLM request
 */
export function createLLMRequest(
  messages: readonly Message[],
  model: string,
  provider: string,
  options?: {
    systemPrompt?: string;
    tools?: readonly ToolDefinition[];
    parameters?: ModelParameters;
    features?: RequestFeatures;
    extraBody?: Record<string, unknown>;
  }
): LLMRequest {
  return {
    messages,
    model,
    provider,
    ...(options?.systemPrompt && { systemPrompt: options.systemPrompt }),
    ...(options?.tools && { tools: options.tools }),
    ...(options?.parameters && { parameters: options.parameters }),
    ...(options?.features && { features: options.features }),
    ...(options?.extraBody && { extraBody: options.extraBody })
  };
}

/**
 * Type aliases for backward compatibility and convenience
 */
export type LLMParameters = ModelParameters;
export type LLMFeatures = RequestFeatures;