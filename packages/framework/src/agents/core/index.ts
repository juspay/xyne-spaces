/**
 * Core Agent Module Exports
 * 
 * This file exports the core classes and types for the simplified Agent architecture.
 */

// Only export types that are actually used
export type {
  // Used by orchestrator
  AgentExecutionResult,
  
  // Used by tools resolver
  AgentToolConfig,
  
  // Used by agent for public API
  ToolExecution,
} from './types.js';

// Main classes - the primary API
export { Agent, ConversationRequest, ConversationResult, ConversationMetrics } from './agent.js';
export { AgentBuilder } from './builder.js';

// Configuration exports - needed for builder and factory
export type { AgentConfig, LogLevel } from './config.js';
export { validateAgentConfig, createDefaultAgentConfig, AgentConfigError, validateAndThrow } from './config.js';


