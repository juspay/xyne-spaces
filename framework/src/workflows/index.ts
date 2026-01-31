/**
 * Workflow Module - Main Export
 *
 * Provides agentic and deterministic workflow composition capabilities
 * with state management, resumption, and integration with the Agent framework.
 */

// Core workflow classes
export { WorkFlow, WorkflowExecutor } from './core/workflow-engine.js';
import { WorkFlow } from './core/workflow-engine.js';
import type { WorkflowState } from './types/index.js';

// Types and interfaces
export type {
  WorkflowState,
  AgenticStepConfig,
  FunctionStepConfig,
  ConditionalExecuteConfig,
  WorkflowExecutionResult,
  StepConfig,
  ExecutionNode,
  NodeExecutionMetadata,
  StepType
} from './types/index.js';

// Error classes
export {
  WorkflowError,
  WorkflowValidationError,
  WorkflowExecutionError
} from './types/index.js';

// ============================================================================
// Convenience Factory Function
// ============================================================================

/**
 * Create a new workflow builder instance
 *
 * @template T - Type of the workflow context
 * @returns A new WorkFlow builder instance
 *
 * @example
 * ```typescript
 * interface MyContext {
 *   userId: string;
 *   progress: number;
 * }
 *
 * const workflow = createWorkflow<MyContext>()
 *   .addAgenticStep({
 *     name: 'analyze',
 *     agenticConfig: async (state) => ({
 *       // agent configuration
 *     })
 *   })
 *   .addFunctionStep({
 *     name: 'process',
 *     handler: async (state) => {
 *       // custom processing
 *       return state;
 *     }
 *   })
 *   .createGraph()
 *   .execute('analyze')
 *   .execute('process')
 *   .build();
 * ```
 */
export function createWorkflow<T = unknown>(): WorkFlow<T> {
  return new WorkFlow<T>();
}

/**
 * Create an initial workflow state for starting a new workflow
 *
 * @template T - Type of the workflow context
 * @param stage - The starting stage/step name
 * @param context - The initial context data
 * @param workflowId - Optional workflow ID (auto-generated if not provided)
 * @returns A new WorkflowState instance
 *
 * @example
 * ```typescript
 * interface MyContext {
 *   userId: string;
 *   progress: number;
 * }
 *
 * const initialState = createInitialWorkflowState('start', {
 *   userId: 'user123',
 *   progress: 0
 * });
 *
 * const result = await workflow.start(initialState);
 * ```
 */
export function createInitialWorkflowState<T>(
  stage: string,
  context: T,
  workflowId?: string
): WorkflowState<T> {
  return {
    messages: [],
    stage,
    context,
    metadata: {
      workflowId: workflowId || `workflow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      startTime: new Date(),
      totalIterations: 0,
      currentIteration: 0
    }
  };
}

// ============================================================================
// Re-export related types from other modules
// ============================================================================

export type { Message } from '../llm/core/types/index.js';
export type { AgentConfig } from '../agents/core/config.js';
export type { ConversationResult } from '../agents/core/agent.js';