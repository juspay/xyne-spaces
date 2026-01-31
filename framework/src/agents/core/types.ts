/**
 * Core type definitions for the Agent Orchestrator module
 * 
 * This file defines the fundamental interfaces and types that govern
 * agent execution, conversation management, and event handling.
 */

import type { z } from 'zod';
import type { 
  Message,
  LLMResponse, 
  ProviderConfig 
} from '../../llm/core/types/index.js';
import type { ToolExecutionResult } from '../../tools/core/types/tool.js';
export type { ToolDefinition } from '../../llm/core/types/tools.js';

// ============================================================================
// Core Agent Types
// ============================================================================

// Note: ConversationMessage type replaced with LLM framework's Message type
// Use import { type Message } from '../../llm/core/types/index.js' instead

/**
 * Represents a tool execution within an agent conversation
 */
export interface ToolExecution {
  /** Unique identifier for this tool execution */
  id: string;
  /** Name of the tool that was executed */
  toolName: string;
  /** Arguments passed to the tool */
  arguments: Record<string, unknown>;
  /** Result returned by the tool */
  result: ToolExecutionResult;
  /** Timestamp when tool execution started */
  startTime: Date;
  /** Timestamp when tool execution completed */
  endTime: Date;
  /** Duration of tool execution in milliseconds */
  duration: number;
  /** Any error that occurred during tool execution */
  error?: string;
  /** Additional metadata about the tool execution */
  metadata?: {
    source: 'framework' | 'mcp' | 'authorization';
    serverName?: string; // For MCP tools
    category?: string;
    [key: string]: unknown;
  };
}

/**
 * Performance metrics for agent execution
 */
export interface AgentPerformanceMetrics {
  /** Total execution time in milliseconds */
  totalDuration: number;
  /** Number of LLM calls made */
  llmCalls: number;
  /** Total tokens used across all LLM calls */
  totalTokens: number;
  /** Number of tools executed */
  toolExecutions: number;
  /** Average tool execution time */
  averageToolDuration: number;
  /** Number of conversation turns */
  conversationTurns: number;
  /** Timestamp when execution started */
  startTime: Date;
  /** Timestamp when execution completed */
  endTime: Date;
}

// Note: First AgentExecutionResult definition removed - using the updated one below

// ============================================================================
// Execution Context Types
// ============================================================================

/**
 * Runtime execution context for agent operations
 */
export interface ExecutionContext {
  /** Unique identifier for this execution */
  executionId: string;
  /** Current conversation state */
  conversation: Message[];
  /** Tool executions performed so far */
  toolExecutions: ToolExecution[];
  /** Current turn number in the conversation */
  currentTurn: number;
  /** Performance tracking */
  metrics: Partial<AgentPerformanceMetrics>;
  /** Additional context data */
  data: Record<string, unknown>;
  /** Execution start time */
  startTime: Date;
  /** Execution timeout settings */
  timeouts: {
    total?: number;
    perTurn?: number;
    perTool?: number;
  };
}

/**
 * State of an agent execution
 */
export type AgentExecutionState = 
  | 'idle'
  | 'initializing'
  | 'thinking'
  | 'calling_tools'
  | 'processing_results'
  | 'finalizing'
  | 'completed'
  | 'error'
  | 'timeout';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Tool configuration for agent execution
 */
export interface AgentToolConfig {
  /** Name of the tool */
  name: string;
  /** Whether this tool is enabled */
  enabled?: boolean;
  /** Tool-specific configuration */
  config?: Record<string, unknown>;
  /** Maximum execution time for this tool */
  timeout?: number;
  /** Number of retries for failed executions */
  retries?: number;
}

/**
 * Execution control configuration
 */
export interface ExecutionConfig {
  /** Maximum number of conversation turns */
  maxTurns?: number;
  /** Maximum total execution time in milliseconds */
  maxDuration?: number;
  /** Maximum time per turn in milliseconds */
  maxTurnDuration?: number;
  /** Maximum time per tool execution in milliseconds */
  maxToolDuration?: number;
  /** Whether to enable parallel tool execution */
  enableParallelTools?: boolean;
  /** Maximum number of parallel tool executions */
  maxParallelTools?: number;
  /** Whether to cache tool results */
  enableToolCache?: boolean;
  /** Tool cache TTL in milliseconds */
  toolCacheTTL?: number;
}

/**
 * Event configuration for agent execution
 */
export interface EventConfig {
  /** Whether to emit events */
  enabled?: boolean;
  /** Whether to emit streaming events during LLM calls */
  enableStreaming?: boolean;
  /** Whether to emit debug events */
  enableDebug?: boolean;
  /** Event buffer size for streaming */
  bufferSize?: number;
  /** Custom event handlers */
  handlers?: Record<string, (event: AgentEvent) => void>;
}

/**
 * Plugin configuration
 */
export interface PluginConfig {
  /** Plugin name/identifier */
  name: string;
  /** Plugin configuration */
  config?: Record<string, unknown>;
  /** Whether plugin is enabled */
  enabled?: boolean;
}

/**
 * Custom handler configuration
 */
export interface CustomHandlerConfig {
  /** Handler name */
  name: string;
  /** Event types this handler should listen to */
  events: string[];
  /** Handler function */
  handler: (event: AgentEvent) => void | Promise<void>;
}

/**
 * Complete agent configuration
 */
export interface AgentConfig {
  /** LLM provider configuration */
  model: ProviderConfig;
  /** Available tools for the agent */
  tools: AgentToolConfig[];
  /** Initial conversation messages */
  initialMessages?: Message[];
  /** Execution control settings */
  execution?: ExecutionConfig;
  /** Event configuration */
  events?: EventConfig;
  /** Plugin configurations */
  plugins?: PluginConfig[];
  /** Custom event handlers */
  customHandlers?: CustomHandlerConfig[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Simplified request interface for agent conversation execution
 * All configuration comes from agent config - no overrides or duplicates
 */
export interface AgentExecutionRequest {
  /** Conversation messages to process */
  messages: Message[];
  /** Optional system prompt for this specific conversation */
  systemPrompt?: string;
  /** Optional features to override for this conversation */
  features?: {
    thinkingMode?: boolean;
  };
}

/**
 * Result of agent conversation execution
 */
export interface AgentExecutionResult {
  /** Whether the execution completed successfully */
  success: boolean;
  /** System prompt used for the execution */
  systemPrompt?: string;
  /** Complete conversation history (input + all LLM-tool interactions) */
  messages: Message[];
  /** Details of all tool executions performed */
  toolExecutions: ToolExecution[];
  /** Final response from the agent */
  finalResponse: string;
  /** Performance metrics for this execution */
  metrics: AgentPerformanceMetrics;
  /** Execution status */
  status: 'completed' | 'interrupted' | 'max_iterations' | 'error';
  /** Any error that occurred during execution */
  error?: string;
  /** Additional metadata about the execution */
  metadata: {
    /** Unique execution ID */
    executionId: string;
    /** Configuration used for this execution */
    configHash: string;
    /** Execution context information */
    context: Record<string, unknown>;
    /** Execution environment info */
    environment: {
      nodeVersion: string;
      platform: string;
      timestamp: Date;
    };
  };
}

// ============================================================================
// Event System Types
// ============================================================================

/**
 * Base interface for all agent events
 */
export interface AgentEvent {
  /** Event type identifier */
  type: string;
  /** Event timestamp */
  timestamp: Date;
  /** Execution ID this event belongs to */
  executionId: string;
  /** Event payload */
  payload: Record<string, unknown>;
  /** Event metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Agent lifecycle events
 */
export interface AgentLifecycleEvent extends AgentEvent {
  type: 'agent_started' | 'agent_completed' | 'agent_error' | 'agent_timeout';
  payload: {
    state: AgentExecutionState;
    config?: Partial<AgentConfig>;
    error?: string;
    duration?: number;
  };
}

/**
 * LLM interaction events
 */
export interface LLMEvent extends AgentEvent {
  type: 'llm_thinking_start' | 'llm_streaming_chunk' | 'llm_response_complete' | 'llm_error';
  payload: {
    turn: number;
    messages?: Message[];
    response?: LLMResponse;
    chunk?: string;
    error?: string;
    tokens?: number;
    duration?: number;
  };
}

/**
 * Tool execution events
 */
export interface ToolEvent extends AgentEvent {
  type: 'tools_requested' | 'tool_executing' | 'tool_completed' | 'tool_error' | 'tools_batch_complete';
  payload: {
    toolName?: string;
    toolId?: string;
    arguments?: Record<string, unknown>;
    result?: ToolExecutionResult;
    error?: string;
    duration?: number;
    toolCount?: number;
    parallel?: boolean;
  };
}

/**
 * Conversation flow events
 */
export interface ConversationEvent extends AgentEvent {
  type: 'conversation_turn_start' | 'conversation_turn_complete' | 'message_added' | 'context_updated';
  payload: {
    turn?: number;
    message?: Message;
    messageCount?: number;
    tokenCount?: number;
    contextWindow?: number;
  };
}

/**
 * Performance and debugging events
 */
export interface PerformanceEvent extends AgentEvent {
  type: 'execution_step' | 'performance_metric' | 'debug_info';
  payload: {
    step?: string;
    metrics?: Partial<AgentPerformanceMetrics>;
    debugData?: Record<string, unknown>;
    memoryUsage?: NodeJS.MemoryUsage;
  };
}

/**
 * Union type of all possible agent events
 */
export type AnyAgentEvent = 
  | AgentLifecycleEvent 
  | LLMEvent 
  | ToolEvent 
  | ConversationEvent 
  | PerformanceEvent;

// ============================================================================
// Error Types
// ============================================================================

/**
 * Agent-specific error types
 */
export type AgentErrorType =
  | 'CONFIGURATION_ERROR'
  | 'EXECUTION_ERROR'
  | 'LLM_ERROR'
  | 'TOOL_ERROR'
  | 'TIMEOUT_ERROR'
  | 'VALIDATION_ERROR'
  | 'PLUGIN_ERROR';

/**
 * Agent execution error
 */
export interface AgentError extends Error {
  readonly type: AgentErrorType;
  readonly executionId?: string;
  readonly turn?: number;
  readonly metadata?: Record<string, unknown>;
}

// ============================================================================
// Template and Builder Types
// ============================================================================

/**
 * Agent template for common configurations
 */
export interface AgentTemplate {
  /** Template name */
  name: string;
  /** Template description */
  description: string;
  /** Template version */
  version: string;
  /** Default configuration */
  config: Partial<AgentConfig>;
  /** Template-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Configuration builder interface for fluent API
 */
export interface IConfigBuilder {
  // Note: withSystemPrompt removed - system prompt is now passed separately in execution request
  /** Set LLM provider configuration */
  withModel(config: ProviderConfig): IConfigBuilder;
  /** Add a tool */
  withTool(name: string, config?: Partial<AgentToolConfig>): IConfigBuilder;
  /** Add multiple tools */
  withTools(tools: AgentToolConfig[]): IConfigBuilder;
  /** Set initial messages */
  withInitialMessages(messages: Message[]): IConfigBuilder;
  /** Set execution configuration */
  withExecution(config: ExecutionConfig): IConfigBuilder;
  /** Set event configuration */
  withEvents(config: EventConfig): IConfigBuilder;
  /** Add a plugin */
  withPlugin(name: string, config?: Record<string, unknown>): IConfigBuilder;
  /** Build the final configuration */
  build(): AgentConfig;
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  /** Whether the configuration is valid */
  isValid: boolean;
  /** Validation errors if any */
  errors: string[];
  /** Validation warnings */
  warnings: string[];
  /** Validated and normalized configuration */
  config?: AgentConfig;
}

/**
 * Schema validation types for Zod integration
 */
export type AgentConfigSchema = z.ZodType<AgentConfig>;
export type ConversationMessageSchema = z.ZodType<Message>;
export type ToolExecutionSchema = z.ZodType<ToolExecution>;
export type AgentEventSchema = z.ZodType<AgentEvent>;

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Utility type to make specific fields optional
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Utility type to make specific fields required
 */
export type RequiredBy<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * Extract event payload type by event type
 */
export type EventPayload<T extends string> = Extract<AnyAgentEvent, { type: T }>['payload'];

/**
 * Type-safe event handler function
 */
export type EventHandler<T extends string = string> = (event: Extract<AnyAgentEvent, { type: T }>) => void | Promise<void>;

/**
 * Event subscription interface
 */
export interface EventSubscription {
  /** Unsubscribe from the event */
  unsubscribe(): void;
  /** Check if subscription is still active */
  isActive(): boolean;
}