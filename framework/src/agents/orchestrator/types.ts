/**
 * Lean Agent Orchestrator Types
 * 
 * Minimal types for lean orchestration engine that focuses
 * only on conversation execution.
 */

import type { AgentExecutionRequest, AgentExecutionResult, ToolExecution } from '../core/types.js';
import type { ToolCall, ToolResultMessage, Message, UserMessage } from '../../llm/core/types/messages.js';
import type { ToolDefinition } from '../../llm/core/types/tools.js';

// ============================================================================
// Tool Authorization Types
// ============================================================================

/**
 * Context provided to tool authorization hooks
 */
export interface ToolAuthorizationContext {
  /** Unique execution ID for this conversation */
  readonly executionId: string;
  /** Agent ID that is executing this tool */
  readonly agentId: string;
  /** Current conversation turn number */
  readonly conversationTurns: number;
  /** ID of the specific tool call being authorized */
  readonly toolCallId: string;
  /** Timestamp when authorization was requested */
  readonly timestamp: Date;
  /** Total number of messages in conversation */
  readonly messageCount: number;
  /** Additional metadata that might be useful for authorization */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Result returned by authorization hook when denying tool execution
 */
export interface ToolAuthorizationResult {
  /** Must be true to indicate denial */
  readonly denied: true;
  /** Human-readable reason for denial (will be included in conversation) */
  readonly reason: string;
  /** Whether this denial should terminate the entire conversation loop */
  readonly shouldTerminate: boolean;
  /** Optional additional metadata about the denial */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Tool authorization hook function type
 * 
 * @param toolName - Name of the tool being called
 * @param parameters - Parameters being passed to the tool
 * @param context - Execution context for authorization decision
 * @returns null/undefined to approve, ToolAuthorizationResult to deny
 */
export type ToolAuthorizationHook = (
  toolName: string,
  parameters: Record<string, unknown>,
  context: ToolAuthorizationContext
) => Promise<ToolAuthorizationResult | null> | ToolAuthorizationResult | null;





/**
 * Orchestrator execution state
 */
export type OrchestratorState = 
  | 'idle'
  | 'processing' 
  | 'interrupted'
  | 'error'
  | 'disposed';

/**
 * Orchestrator event handler for agent proxying
 */
export interface OrchestratorEventHandler {
  // State and lifecycle events
  onStateChange?: (newState: OrchestratorState, previousState: OrchestratorState) => void | Promise<void>;
  onError?: (error: Error, context: Record<string, unknown>) => void | Promise<void>;
  onInterrupted?: (context: { 
    executionId: string; 
    completedTurns: number; 
    duration: number 
  }) => void | Promise<void>;
  
  // Turn-level events
  onTurnStart?: (turn: number, context: { messageCount: number; iteration: number }) => void | Promise<void>;
  onTurnComplete?: (turn: number, result: AgentExecutionResult) => void | Promise<void>;
  
  // LLM events
  onLLMRequest?: (request: { messages: Message[]; systemPrompt?: string; tools: unknown[] }) => void | Promise<void>;
  onLLMResponse?: (response: { content: string; thinking?: string; toolCalls?: ToolCall[]; tokens?: number }) => void | Promise<void>;
  
  // Tool events  
  onToolCallsRequested?: (toolCalls: ToolCall[]) => void | Promise<void>;
  onToolAuthorizationRequested?: (details: {
    toolName: string;
    parameters: Record<string, unknown>;
    context: ToolAuthorizationContext;
  }) => void | Promise<void>;
  onToolDenied?: (details: {
    toolName: string;
    parameters: Record<string, unknown>;
    reason: string;
    shouldTerminate: boolean;
    context: ToolAuthorizationContext;
  }) => void | Promise<void>;
  onToolResult?: (result: ToolResultMessage & { duration: number; fullToolResult?: unknown }) => void | Promise<void>;
  onToolsComplete?: (results: Array<{ id: string; name: string; success: boolean }>) => void | Promise<void>;
  
  // Message events
  onMessageAdded?: (message: Message) => void | Promise<void>;
  
  // Compacting events
  onCompactingStarted?: (details: {
    currentMessageCount: number;
    estimatedTokens: number;
    contextWindowLimit: number;
    thresholdPercentage: number;
  }) => void | Promise<void>;
  
  onCompactingCompleted?: (details: {
    originalMessageCount: number;
    compactedMessageCount: number;
    tokensReduced: number;
    compactSummary: UserMessage;
  }) => void | Promise<void>;
  
  // Context monitoring events
  onContextUsageUpdate?: (details: {
    currentTokens: number;
    contextWindow: number;
    usagePercentage: number;
    conversationTurns: number;
  }) => void | Promise<void>;
}

/**
 * Lean Agent Orchestrator Interface
 * 
 * Minimal interface focused on conversation execution with essential events.
 */
export interface AgentOrchestrator {
  // Core execution
  executeConversation(request: AgentExecutionRequest, abortSignal?: AbortSignal): Promise<AgentExecutionResult>;
  
  // Tool management
  updateResolvedTools(tools: ToolDefinition[]): void;
  
  // Event handling for agent proxying
  addEventListener(handler: OrchestratorEventHandler): string;
  removeEventListener(id: string): boolean;
  
  // Cleanup
  dispose(): Promise<void>;
}


/**
 * Orchestrator error class
 */
export class OrchestratorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'OrchestratorError';
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      stack: this.stack
    };
  }
}

/**
 * Abort error with partial execution state
 */
export interface AbortError extends Error {
  name: 'AbortError';
  partialState: {
    messages: Message[];
    toolExecutions: ToolExecution[];
    llmCalls: number;
    totalTokens: number;
    conversationTurns: number;
  };
}

// Note: ToolExecution is imported from core/types.js to avoid export conflicts