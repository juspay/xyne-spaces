import type { LLMRequest, LLMResponse, ModelCapabilities } from './requests.js';
import type { StreamChunk } from './streaming.js';
import type { ModelHealthStatus, PingResult } from './health.js';
import { ToolDefinition } from './tools.js';

/**
 * Provider interfaces and abstractions
 */

/**
 * Core LLM provider interface
 */
export interface LLMProvider {
  readonly name: string;
  readonly supportedModels: readonly string[];
  
  // Core functionality
  authenticate(): Promise<void>;
  isAuthenticated(): boolean;
  listModels(): Promise<readonly ProviderModel[]>;
  generate(request: LLMRequest, abortSignal?: AbortSignal): Promise<LLMResponse>;
  generateStream(request: LLMRequest, abortSignal?: AbortSignal): AsyncIterable<StreamChunk>;
  
  // Health and monitoring
  ping(model: string): Promise<PingResult>;
  getHealth(model: string): Promise<ModelHealthStatus>;
  
  // Capabilities
  supportsToolCalling(): boolean;
  supportsStreaming(): boolean;
  supportsThinking(): boolean;
  getModelCapabilities(model: string): ModelCapabilities | undefined;
  
  // Token counting
  countTokens(messages: readonly import('./messages.js').Message[], model: string, tools: ToolDefinition[], maxTokens: number): Promise<number>;
  getContextWindow(model: string): number;
  supportsTokenCounting(model: string): boolean;
  
  // Configuration
  validateConfig(config: unknown): boolean;
  updateConfig(config: unknown): void;
  getConfig(): ProviderConfig;
}

/**
 * Provider model information
 */
export interface ProviderModel {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description?: string;
  readonly capabilities: ModelCapabilities;
  readonly pricing?: ModelPricing;
  readonly availability?: ModelAvailability;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Model pricing information
 */
export interface ModelPricing {
  readonly inputTokens: number; // price per 1K input tokens
  readonly outputTokens: number; // price per 1K output tokens
  readonly currency: string;
  readonly unit: 'per_1k_tokens' | 'per_1m_tokens' | 'per_request';
}

/**
 * Model availability information
 */
export interface ModelAvailability {
  readonly regions: readonly string[];
  readonly status: 'available' | 'limited' | 'deprecated' | 'coming_soon';
  readonly rateLimits?: RateLimits;
  readonly quotaLimits?: QuotaLimits;
}

/**
 * Rate limiting information
 */
export interface RateLimits {
  readonly requestsPerMinute?: number;
  readonly requestsPerHour?: number;
  readonly requestsPerDay?: number;
  readonly tokensPerMinute?: number;
  readonly tokensPerHour?: number;
  readonly tokensPerDay?: number;
}

/**
 * Quota limiting information
 */
export interface QuotaLimits {
  readonly monthlyTokens?: number;
  readonly monthlyRequests?: number;
  readonly currentUsage?: {
    readonly tokens: number;
    readonly requests: number;
    readonly resetDate: Date;
  };
}

/**
 * Base provider configuration
 */
export interface ProviderConfig {
  readonly name: string;
  readonly region?: string;
  readonly apiVersion?: string;
  readonly timeout?: number;
  readonly retries?: number;
  readonly rateLimiting?: boolean;
  readonly enableLogging?: boolean;
  readonly enableCaching?: boolean;
  readonly customEndpoint?: string;
}

/**
 * Authentication provider interface
 */
export interface AuthProvider {
  authenticate(): Promise<AuthResult>;
  isAuthenticated(): boolean;
  getToken(): Promise<string>;
  refreshToken(): Promise<string>;
  validateCredentials(): Promise<boolean>;
}

/**
 * Authentication result
 */
export interface AuthResult {
  readonly success: boolean;
  readonly token?: string;
  readonly expiresAt?: Date;
  readonly error?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Provider execution context
 */
export interface ProviderExecutionContext {
  readonly requestId: string;
  readonly provider: string;
  readonly model: string;
  readonly startTime: Date;
  readonly timeout?: number;
  readonly retryCount?: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Provider factory interface
 */
export interface ProviderFactory {
  createProvider(name: string, config: unknown): Promise<LLMProvider>;
  getAvailableProviders(): readonly string[];
  validateProviderConfig(name: string, config: unknown): boolean;
}

/**
 * Provider registry interface
 */
export interface ProviderRegistry {
  register(provider: LLMProvider): void;
  unregister(name: string): void;
  get(name: string): LLMProvider | undefined;
  list(): readonly LLMProvider[];
  clear(): void;
}

/**
 * Provider error types
 */
export interface ProviderError {
  readonly type: 'authentication' | 'rate_limit' | 'quota_exceeded' | 'model_unavailable' | 'network' | 'unknown';
  readonly message: string;
  readonly code?: string;
  readonly provider: string;
  readonly model?: string;
  readonly retryable: boolean;
  readonly retryAfter?: number; // seconds
  readonly originalError?: Error;
}

/**
 * Provider statistics
 */
export interface ProviderStatistics {
  readonly provider: string;
  readonly totalRequests: number;
  readonly successfulRequests: number;
  readonly failedRequests: number;
  readonly averageLatency: number;
  readonly totalTokensUsed: number;
  readonly lastRequestTime: Date;
  readonly uptime: number; // percentage
}

/**
 * Provider type guards
 */
export function isLLMProvider(obj: unknown): obj is LLMProvider {
  if (!obj || typeof obj !== 'object') return false;
  
  const provider = obj as Partial<LLMProvider>;
  return !!(
    provider.name &&
    typeof provider.name === 'string' &&
    provider.supportedModels &&
    Array.isArray(provider.supportedModels) &&
    typeof provider.authenticate === 'function' &&
    typeof provider.generate === 'function' &&
    typeof provider.generateStream === 'function'
  );
}

/**
 * Provider validation helpers
 */
export function validateProviderModel(model: ProviderModel): string[] {
  const errors: string[] = [];

  if (!model.id || model.id.trim() === '') {
    errors.push('Model ID is required');
  }

  if (!model.name || model.name.trim() === '') {
    errors.push('Model name is required');
  }

  if (!model.capabilities) {
    errors.push('Model capabilities are required');
  }

  return errors;
}

/**
 * Create provider error
 */
export function createProviderError(
  type: ProviderError['type'],
  message: string,
  provider: string,
  options?: {
    code?: string;
    model?: string;
    retryable?: boolean;
    retryAfter?: number;
    originalError?: Error;
  }
): ProviderError {
  return {
    type,
    message,
    provider,
    ...(options?.code && { code: options.code }),
    ...(options?.model && { model: options.model }),
    retryable: options?.retryable ?? false,
    ...(options?.retryAfter !== undefined && { retryAfter: options.retryAfter }),
    ...(options?.originalError && { originalError: options.originalError })
  };
}