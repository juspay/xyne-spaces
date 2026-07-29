/**
 * Framework Type Bridge
 *
 * Centralized imports and re-exports of framework types for workflow integration.
 * Provides type-safe access to framework types without direct dependencies.
 */

// Core framework types
export type {
  Agent,
  AgentConfig,
  ConversationRequest,
  ConversationResult,
  ToolExecution,
  ConversationMetrics,
  Message
} from '@framework'

// Workflow-specific interfaces for database integration
export interface AgentStepData {
  name: string
  type: 'tool' | 'llm-call' | 'hooks'  // Maps to AgentStep.stepType from schema
  data: Record<string, unknown>
  success: boolean
  toolName?: string
  agentId?: string
}