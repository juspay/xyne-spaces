/**
 * LLM-specific error definitions following tool module patterns
 */

/**
 * Base LLM error interface
 */
export interface LLMError {
  readonly type: string;
  readonly message: string;
  readonly code?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly retryable?: boolean;
  readonly timestamp: Date;
  readonly context?: Record<string, unknown>;
}

/**
 * LLM error context type alias
 */
export type LLMErrorContext = Record<string, unknown>;

/**
 * Provider authentication error
 */
export interface ProviderAuthError extends LLMError {
  readonly type: 'provider_auth_error';
  readonly provider: string;
  readonly authMethod?: string;
  readonly retryable: false;
}

/**
 * Provider validation error
 */
export interface ProviderValidationError extends LLMError {
  readonly type: 'provider_validation_error';
  readonly provider: string;
  readonly validationErrors: readonly string[];
  readonly retryable: false;
}

/**
 * Provider execution error
 */
export interface ProviderExecutionError extends LLMError {
  readonly type: 'provider_execution_error';
  readonly provider: string;
  readonly model?: string;
  readonly executionId?: string;
  readonly retryable: boolean;
}

/**
 * Streaming error
 */
export interface StreamingError extends LLMError {
  readonly type: 'streaming_error';
  readonly provider: string;
  readonly model?: string;
  readonly chunkIndex?: number;
  readonly streamPhase: 'connection' | 'processing' | 'accumulation' | 'finalization';
  readonly retryable: boolean;
}

/**
 * Rate limiting error
 */
export interface RateLimitError extends LLMError {
  readonly type: 'rate_limit_error';
  readonly provider: string;
  readonly model?: string;
  readonly retryAfter?: number; // seconds
  readonly retryable: true;
}

/**
 * Quota exceeded error
 */
export interface QuotaExceededError extends LLMError {
  readonly type: 'quota_exceeded_error';
  readonly provider: string;
  readonly quotaType: 'tokens' | 'requests' | 'daily' | 'monthly';
  readonly resetTime?: Date;
  readonly retryable: boolean;
}

/**
 * Model unavailable error
 */
export interface ModelUnavailableError extends LLMError {
  readonly type: 'model_unavailable_error';
  readonly provider: string;
  readonly model: string;
  readonly status?: 'maintenance' | 'overloaded' | 'deprecated' | 'unknown';
  readonly retryable: boolean;
}

/**
 * Network error
 */
export interface NetworkError extends LLMError {
  readonly type: 'network_error';
  readonly provider: string;
  readonly statusCode?: number;
  readonly retryable: boolean;
}

/**
 * Tool integration error
 */
export interface ToolIntegrationError extends LLMError {
  readonly type: 'tool_integration_error';
  readonly toolName?: string;
  readonly integrationPhase: 'schema_conversion' | 'call_parsing' | 'result_processing';
  readonly retryable: false;
}

/**
 * Union type for all LLM errors
 */
export type LLMErrorType =
  | ProviderAuthError
  | ProviderValidationError
  | ProviderExecutionError
  | StreamingError
  | RateLimitError
  | QuotaExceededError
  | ModelUnavailableError
  | NetworkError
  | ToolIntegrationError;

/**
 * LLM error class for throwing
 */
export class LLMErrorClass extends Error {
  public readonly llmError: LLMErrorType;

  constructor(llmError: LLMErrorType) {
    super(llmError.message);
    this.name = 'LLMError';
    this.llmError = llmError;
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LLMErrorClass);
    }
  }
}

/**
 * Error creation functions using spread operator for optional properties
 */
export function createProviderAuthError(
  provider: string,
  message: string,
  options?: {
    code?: string;
    authMethod?: string;
    context?: Record<string, unknown>;
  }
): ProviderAuthError {
  return {
    type: 'provider_auth_error',
    message,
    provider,
    retryable: false,
    timestamp: new Date(),
    ...(options?.code && { code: options.code }),
    ...(options?.authMethod && { authMethod: options.authMethod }),
    ...(options?.context && { context: options.context })
  };
}

export function createProviderValidationError(
  provider: string,
  validationErrors: readonly string[],
  options?: {
    code?: string;
    context?: Record<string, unknown>;
  }
): ProviderValidationError {
  return {
    type: 'provider_validation_error',
    message: `Validation failed: ${validationErrors.join(', ')}`,
    provider,
    validationErrors,
    retryable: false,
    timestamp: new Date(),
    ...(options?.code && { code: options.code }),
    ...(options?.context && { context: options.context })
  };
}

export function createProviderExecutionError(
  provider: string,
  message: string,
  retryable: boolean = true,
  options?: {
    code?: string;
    model?: string;
    executionId?: string;
    context?: Record<string, unknown>;
  }
): ProviderExecutionError {
  return {
    type: 'provider_execution_error',
    message,
    provider,
    retryable,
    timestamp: new Date(),
    ...(options?.code && { code: options.code }),
    ...(options?.model && { model: options.model }),
    ...(options?.executionId && { executionId: options.executionId }),
    ...(options?.context && { context: options.context })
  };
}

export function createStreamingError(
  provider: string,
  message: string,
  streamPhase: StreamingError['streamPhase'],
  retryable: boolean = false,
  options?: {
    code?: string;
    model?: string;
    chunkIndex?: number;
    context?: Record<string, unknown>;
  }
): StreamingError {
  return {
    type: 'streaming_error',
    message,
    provider,
    streamPhase,
    retryable,
    timestamp: new Date(),
    ...(options?.code && { code: options.code }),
    ...(options?.model && { model: options.model }),
    ...(options?.chunkIndex !== undefined && { chunkIndex: options.chunkIndex }),
    ...(options?.context && { context: options.context })
  };
}

export function createRateLimitError(
  provider: string,
  message: string,
  options?: {
    code?: string;
    model?: string;
    retryAfter?: number;
    context?: Record<string, unknown>;
  }
): RateLimitError {
  return {
    type: 'rate_limit_error',
    message,
    provider,
    retryable: true,
    timestamp: new Date(),
    ...(options?.code && { code: options.code }),
    ...(options?.model && { model: options.model }),
    ...(options?.retryAfter !== undefined && { retryAfter: options.retryAfter }),
    ...(options?.context && { context: options.context })
  };
}

export function createQuotaExceededError(
  provider: string,
  quotaType: QuotaExceededError['quotaType'],
  message: string,
  options?: {
    code?: string;
    resetTime?: Date;
    retryable?: boolean;
    context?: Record<string, unknown>;
  }
): QuotaExceededError {
  const retryable = options?.retryable ?? (quotaType !== 'monthly');
  
  return {
    type: 'quota_exceeded_error',
    message,
    provider,
    quotaType,
    retryable,
    timestamp: new Date(),
    ...(options?.code && { code: options.code }),
    ...(options?.resetTime && { resetTime: options.resetTime }),
    ...(options?.context && { context: options.context })
  };
}

export function createModelUnavailableError(
  provider: string,
  model: string,
  message: string,
  options?: {
    code?: string;
    status?: ModelUnavailableError['status'];
    retryable?: boolean;
    context?: Record<string, unknown>;
  }
): ModelUnavailableError {
  const status = options?.status || 'unknown';
  const retryable = options?.retryable ?? (status === 'overloaded' || status === 'maintenance');
  
  return {
    type: 'model_unavailable_error',
    message,
    provider,
    model,
    retryable,
    timestamp: new Date(),
    ...(options?.code && { code: options.code }),
    ...(status && { status }),
    ...(options?.context && { context: options.context })
  };
}

export function createNetworkError(
  provider: string,
  message: string,
  options?: {
    code?: string;
    statusCode?: number;
    retryable?: boolean;
    context?: Record<string, unknown>;
  }
): NetworkError {
  const statusCode = options?.statusCode;
  //TODO added retry for all. 
  // const retryable = options?.retryable ?? (
  //   !statusCode || 
  //   statusCode >= 500 || 
  //   statusCode === 429 || 
  //   statusCode === 408
  // );
  
  return {
    type: 'network_error',
    message,
    provider,
    retryable: true,
    timestamp: new Date(),
    ...(options?.code && { code: options.code }),
    ...(statusCode !== undefined && { statusCode }),
    ...(options?.context && { context: options.context })
  };
}

export function createAuthenticationError(
  provider: string,
  message: string,
  authMethod: ProviderAuthError['authMethod'],
  options?: {
    code?: string;
    context?: Record<string, unknown>;
  }
): ProviderAuthError {
  return {
    type: 'provider_auth_error',
    message,
    provider,
    ...(authMethod && { authMethod }),
    retryable: false,
    timestamp: new Date(),
    ...(options?.code && { code: options.code }),
    ...(options?.context && { context: options.context })
  };
}

export function createToolIntegrationError(
  message: string,
  integrationPhase: ToolIntegrationError['integrationPhase'],
  options?: {
    code?: string;
    toolName?: string;
    context?: Record<string, unknown>;
  }
): ToolIntegrationError {
  return {
    type: 'tool_integration_error',
    message,
    integrationPhase,
    retryable: false,
    timestamp: new Date(),
    ...(options?.code && { code: options.code }),
    ...(options?.toolName && { toolName: options.toolName }),
    ...(options?.context && { context: options.context })
  };
}

/**
 * Error type guards
 */
export function isLLMErrorClass(error: unknown): error is LLMErrorClass {
  return error instanceof LLMErrorClass;
}

export function isProviderAuthError(error: LLMErrorType): error is ProviderAuthError {
  return error.type === 'provider_auth_error';
}

export function isProviderValidationError(error: LLMErrorType): error is ProviderValidationError {
  return error.type === 'provider_validation_error';
}

export function isProviderExecutionError(error: LLMErrorType): error is ProviderExecutionError {
  return error.type === 'provider_execution_error';
}

export function isStreamingError(error: LLMErrorType): error is StreamingError {
  return error.type === 'streaming_error';
}

export function isRateLimitError(error: LLMErrorType): error is RateLimitError {
  return error.type === 'rate_limit_error';
}

export function isQuotaExceededError(error: LLMErrorType): error is QuotaExceededError {
  return error.type === 'quota_exceeded_error';
}

export function isModelUnavailableError(error: LLMErrorType): error is ModelUnavailableError {
  return error.type === 'model_unavailable_error';
}

export function isNetworkError(error: LLMErrorType): error is NetworkError {
  return error.type === 'network_error';
}

export function isToolIntegrationError(error: LLMErrorType): error is ToolIntegrationError {
  return error.type === 'tool_integration_error';
}

/**
 * Error utilities
 */
export function isRetryableError(error: LLMErrorType): boolean {
  return error.retryable === true;
}

export function getRetryAfter(error: LLMErrorType): number | undefined {
  if (isRateLimitError(error)) {
    return error.retryAfter;
  }
  return undefined;
}

export function formatErrorMessage(error: LLMErrorType): string {
  const parts = [error.type, error.message];
  
  if (error.provider) {
    parts.push(`(provider: ${error.provider})`);
  }
  
  if (error.model) {
    parts.push(`(model: ${error.model})`);
  }
  
  if (error.code) {
    parts.push(`(code: ${error.code})`);
  }
  
  return parts.join(' ');
}