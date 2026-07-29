/**
 * Agent Orchestrator Module
 * 
 * Core orchestration engine for agent-based AI systems. Provides coordination
 * between LLM providers, tool execution, and conversation management with
 * comprehensive event emission and error handling.
 */

export * from './types.js';
export { DefaultAgentOrchestrator } from './agent-orchestrator.js';

// Re-export commonly used types for convenience
export type {
  OrchestratorState,
  OrchestratorEventHandler,
  OrchestratorError,
  ToolAuthorizationHook,
  ToolAuthorizationContext,
  ToolAuthorizationResult,
} from './types.js';