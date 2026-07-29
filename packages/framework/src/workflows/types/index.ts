/**
 * Core workflow types and interfaces
 */

import type { Message } from '../../llm/core/types/index.js';
import type { AgentConfig } from '../../agents/core/config.js';
import type { ConversationResult } from '../../agents/core/agent.js';

// ============================================================================
// Core Workflow State
// ============================================================================

export interface WorkflowState<T = unknown> {
  /** Complete message history from all workflow steps */
  messages: Message[];
  /** Current stage/step name */
  stage: string;
  /** User-defined context data */
  context: T;
  /** Workflow execution metadata */
  metadata: {
    workflowId: string;
    startTime: Date;
    totalIterations: number;
    currentIteration: number;
  };
}

// ============================================================================
// Step Configuration Types
// ============================================================================

export interface AgenticStepConfig<T> {
  /** Unique name for this step */
  name: string;
  /** Function to generate agent configuration based on current state */
  agenticConfig: (state: WorkflowState<T>) => Promise<AgentConfig>;
  /** Optional function to generate system prompt based on current state */
  systemPrompt?: (state: WorkflowState<T>) => Promise<string>;
  /** Optional pre-processing hook */
  before?: (state: WorkflowState<T>) => Promise<WorkflowState<T>>;
  /** Optional post-processing hook */
  after?: (state: WorkflowState<T>, result: ConversationResult) => Promise<WorkflowState<T>>;
}

export interface FunctionStepConfig<T> {
  /** Unique name for this step */
  name: string;
  /** Function to execute for this step */
  handler: (state: WorkflowState<T>) => Promise<WorkflowState<T>>;
}

export interface ConditionalExecuteConfig<T> {
  /** Function to determine which path to take */
  handler: (state: WorkflowState<T>) => Promise<string>;
  /** Map of handler return values to target step names */
  paths: Record<string, string>;
}

// ============================================================================
// Internal Workflow Types
// ============================================================================

export interface StepConfig<T> {
  type: 'agentic' | 'function';
  config: AgenticStepConfig<T> | FunctionStepConfig<T>;
}

export interface ExecutionNode<T> {
  type: 'execute' | 'conditional';
  target?: string;
  config?: ConditionalExecuteConfig<T>;
}

// ============================================================================
// Execution Results
// ============================================================================

export interface WorkflowExecutionResult<T> {
  /** Final workflow state */
  state: WorkflowState<T>;
  /** Execution status */
  status: 'completed' | 'error' | 'interrupted';
  /** Error information if status is 'error' */
  error?: Error;
  /** Complete history of all node executions for resumption */
  nodeHistory: Record<string, WorkflowState<T>[]>;
  /** Execution metadata */
  metadata: {
    workflowId: string;
    totalDuration: number;
    nodesExecuted: string[];
    totalIterations: number;
  };
}

// ============================================================================
// Error Types
// ============================================================================

export class WorkflowError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

export class WorkflowValidationError extends WorkflowError {
  constructor(errors: string[]) {
    super(`Workflow validation failed: ${errors.join(', ')}`, 'VALIDATION_ERROR');
  }
}

export class WorkflowExecutionError extends WorkflowError {
  constructor(
    message: string,
    public readonly stepName?: string,
    cause?: Error
  ) {
    super(message, 'EXECUTION_ERROR', { stepName, cause: cause?.message });
    if (cause) {
      // this.cause = cause;
    }
  }
}

// ============================================================================
// Utility Types
// ============================================================================

export type StepType = 'agentic' | 'function';

export interface NodeExecutionMetadata {
  nodeId: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  success: boolean;
  error?: string;
}