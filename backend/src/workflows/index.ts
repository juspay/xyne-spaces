// Main exports for the workflow system

// Factory function (recommended entry point)
export { createWorkflowEngineWithDB } from './factory'

// Workflow management (production-ready orchestration)
export { WorkflowManager, workflowManager } from './services/workflowManager'
export {
  WorkflowRegistry,
  workflowRegistry,
  registerWorkflow,
  getWorkflowDefinition,
  executeWorkflow,
  type WorkflowDefinition
} from './registry/workflowRegistry'

// Workflow definitions and registration
export { registerAllWorkflows } from './definitions'

// Workflow types and enums
export {
  WorkflowType,
  WorkflowExecutionStatus,
  WorkflowStepStatus,
  WorkflowPriority,
  type WorkflowContext,
  type BaseWorkflowContext,
  type UserOnboardingContext,
  type WorkflowExecutionResult,
  type WorkflowExecutionProgress,
  type ExternalStepData,
  type WorkflowTriggerRequest,
  isUserOnboardingContext,
  getWorkflowTypeDisplayName,
  isTerminalStatus,
  isActiveStatus
} from './types/workflow-enums'

// Loop control for while loops
export { LoopControl } from './workflow-types'

// Core types
export type {
  WorkflowState,
  WorkflowEngine,
  WorkflowExecutionState,
  CheckpointHandler,
  ConditionalHandler,
  AgenticCheckpointConfig,
  ExternalStepConfig,
  ExternalStepHandler,
  WhileLoopConfig,
  WhileLoopBodyFunction,
  ExternalResponseProcessor
} from './workflow-types'

// Storage interface and implementations
export type { WorkflowStorage } from './workflow-storage'
export { DBWorkflowStorage } from './storage/db-storage'

// Engine implementation (for advanced usage)
export {
  WorkflowEngineImpl,
  createWorkflowEngine
} from './workflow-engine'

// Step types and utilities (for storage implementations)
export {
  STEP_TYPES,
  type StepType,
  type StepInput,
  type StepOutput,
  type CheckpointStepInput,
  type CheckpointStepOutput,
  type ConditionalStepInput,
  type ConditionalStepOutput,
  type ExternalStepInput,
  type ExternalStepOutput,
  type WhileLoopStepInput,
  type WhileLoopStepOutput,
  isStepType,
  isCheckpointStep,
  isConditionalStep,
  isExternalStep,
  isWhileLoopStep,
  validateStepInput,
  validateStepOutput
} from './storage/step-types'

// Serialization utilities (for storage implementations)
export {
  SerializationError,
  DeserializationError,
  safeSerialize,
  safeDeserialize,
  serializeWorkflowState,
  serializeStepInput,
  deserializeStepInput,
  serializeStepOutput,
  deserializeStepOutput,
  serializeConditionalResult,
  deserializeConditionalResult,
  serializeExternalStepData,
  deserializeExternalStepData,
  serializeLoopState,
  deserializeLoopState,
  serializeParentStepIds,
  deserializeParentStepIds
} from './storage/serialization'