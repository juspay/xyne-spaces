/**
 * LLM Module - Independent and isolated LLM provider system
 * 
 * Provides unified interface for multiple LLM providers with:
 * - Common message types and conversion
 * - Streaming support with accumulation
 * - Error handling and health monitoring
 * - Advanced temperature management
 * - Provider abstraction and isolation
 */

// Core types and interfaces
export type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolCallMessage,
  ToolResultMessage,
  SystemMessage,
  ToolCall,
} from './core/types/messages.js';

export type {
  LLMRequest,
  LLMResponse,
  LLMParameters,
  LLMFeatures,
  ModelCapabilities
} from './core/types/requests.js';

export type {
  StreamChunk,
  LLMStreamResult,
  StreamMetadata
} from './core/types/streaming.js';

export type {
  ModelHealthStatus,
  PingResult,
  HealthStatus
} from './core/types/health.js';

export type {
  LLMProvider,
  ProviderModel,
  ProviderConfig,
  ProviderExecutionContext
} from './core/types/providers.js';

// Core utilities
export {
  createUserMessage,
  createAssistantMessage,
  createToolCallMessage,
  createToolResultMessage,
  createSystemMessage,
  createToolCall
} from './core/types/messages.js';

export {
  createLLMRequest,
  validateLLMRequest
} from './core/types/requests.js';

// Error handling
export type {
  LLMError,
  LLMErrorType,
  LLMErrorContext
} from './core/errors/index.js';

export {
  LLMErrorClass,
  isLLMErrorClass,
  createProviderValidationError,
  createProviderExecutionError,
  createModelUnavailableError,
  createNetworkError,
  createRateLimitError,
  createAuthenticationError
} from './core/errors/index.js';

// Provider base class
export {
  BaseProvider
} from './core/providers/base-provider.js';

// Streaming utilities
export {
  createStreamWithAccumulation,
  StreamAccumulator
} from './features/streaming/stream-accumulator.js';

// Tool definitions (schema-only, no execution logic)
export type {
  ToolDefinition,
  ToolParameterDefinition,
  ToolPropertyDefinition,
  ToolMetadata as LLMToolMetadata,
  ToolExample,
  ToolSchemaConversionResult,
  ToolCallResult,
  ToolRegistryEntry as LLMToolRegistryEntry,
  ToolChoice,
  ToolFormat,
  ToolSchemaConverter,
  ZodToJsonSchemaOptions
} from './core/types/tools.js';

export {
  validateToolDefinition,
  createToolDefinition,
  isValidToolDefinition,
  extractToolNames,
  findToolDefinition
} from './core/types/tools.js';

// Temperature management and optimization
export type {
  TaskType,
  TemperatureConfig,
  TaskDetectionResult
} from './features/thinking/index.js';

export {
  TemperatureManager,
  createTemperatureManager,
  detectOptimalTemperature
} from './features/thinking/index.js';

// Health monitoring and availability tracking
export type {
  HealthMonitorConfig,
  HealthCheckResult,
  ModelAvailability,
  HealthEvent,
  HealthEventListener
} from './features/health/index.js';

export {
  HealthMonitor,
  createHealthMonitor
} from './features/health/index.js';

// Provider infrastructure
export type {
  LLMClientConfig,
  ProviderConfiguration,
  VertexProviderConfig,
  LiteLLMProviderConfig,
  LiteLLMConfig
} from './core/types/config.js';

export {
  createProvider,
  getAvailableProviders,
  isProviderSupported
} from './core/factory/provider-factory.js';

// Vertex provider
export {
  VertexProvider
} from './providers/vertex/vertex-provider.js';

export type {
  VertexConfig,
  VertexAuthConfig
} from './providers/vertex/schemas.js';

export {
  validateVertexConfig
} from './providers/vertex/schemas.js';

// LiteLLM provider
export {
  LiteLLMProvider
} from './providers/litellm/litellm-provider.js';

export type {
  LiteLLMRequest,
  LiteLLMResponse,
  LiteLLMMessage,
  LiteLLMStreamChunk
} from './providers/litellm/schemas.js';

export {
  validateLiteLLMConfig,
  parseLiteLLMResponse,
  parseLiteLLMStreamChunk
} from './providers/litellm/schemas.js';

// High-level client interface
export {
  LLMClient
} from './client/llm-client.js';