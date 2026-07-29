/**
 * Core LLM type definitions
 * Central export for all LLM types
 */

// Message types
export type {
  CommonMessage,
  SystemMessage,
  UserMessage,
  AssistantMessage,
  ToolCallMessage,
  ToolResultMessage,
  Message,
  ToolCall,
  Attachment
} from './messages.js';

export {
  isSystemMessage,
  isUserMessage,
  isAssistantMessage,
  isToolCallMessage,
  isToolResultMessage,
  createSystemMessage,
  createUserMessage,
  createAssistantMessage,
  createToolResultMessage
} from './messages.js';

// Request and response types
export type {
  LLMRequest,
  LLMResponse,
  ModelParameters,
  RequestFeatures,
  ThinkingConfig,
  TokenUsage,
  ResponseMetadata,
  TemperatureContext,
  TaskType,
  ModelCapabilities
} from './requests.js';

export {
  validateLLMRequest,
  createLLMRequest
} from './requests.js';

// Streaming types
export type {
  StreamChunk,
  StreamChunkMetadata,
  StreamingOptions,
  StreamProcessor,
  LLMStreamResult,
  StreamMetadata,
  StreamAccumulator,
  StreamBuffer,
  StreamError,
  StreamStatistics
} from './streaming.js';

export {
  isContentChunk,
  isThinkingChunk,
  isToolCallChunk,
  isErrorChunk,
  isDoneChunk,
  isMetadataChunk,
  createContentChunk,
  createThinkingChunk,
  createToolCallChunk,
  createErrorChunk,
  createDoneChunk
} from './streaming.js';

// Health monitoring types
export type {
  ModelHealthStatus,
  ModelHealthMetadata,
  PingResult,
  PingResponseMetadata,
  HealthCheckConfig,
  HealthMonitor,
  HealthEventType,
  HealthEvent,
  HealthEventListener,
  HealthStatistics,
  HealthStatus
} from './health.js';

export {
  isHealthy,
  isDegraded,
  isUnavailable,
  isUnknown,
  compareHealthStatus,
  createHealthCheckConfig,
  createHealthEvent
} from './health.js';

// Tool types
export type {
  ToolDefinition,
  ToolParameterDefinition,
  ToolPropertyDefinition,
  ToolMetadata,
  ToolExample,
  ToolSchemaConversionResult,
  ToolCallResult,
  ToolRegistryEntry,
  ToolChoice,
  ToolFormat,
  ToolSchemaConverter,
  ZodToJsonSchemaOptions
} from './tools.js';

export {
  validateToolDefinition,
  createToolDefinition,
  isValidToolDefinition,
  extractToolNames,
  findToolDefinition
} from './tools.js';

// Provider types
export type {
  LLMProvider,
  ProviderModel,
  ModelPricing,
  ModelAvailability,
  RateLimits,
  QuotaLimits,
  ProviderConfig,
  AuthProvider,
  AuthResult,
  ProviderExecutionContext,
  ProviderFactory,
  ProviderRegistry,
  ProviderError,
  ProviderStatistics
} from './providers.js';

export {
  isLLMProvider,
  validateProviderModel,
  createProviderError
} from './providers.js';