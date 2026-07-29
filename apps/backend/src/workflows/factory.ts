// Factory function for creating workflow engines with database storage

import { WorkflowState, WorkflowEngine, BaseWorkflowContext, AnyEnum } from './workflow-types'
import { createWorkflowEngine } from './workflow-engine'
import { DBWorkflowStorage } from './storage/db-storage'
import { WorkflowStorage } from './workflow-storage'

// Result type for createWorkflowEngineWithDB that includes both engine and storage
export interface WorkflowEngineWithStorage<
  TContext extends BaseWorkflowContext = BaseWorkflowContext,
  TEnum extends AnyEnum = AnyEnum
> {
  engine: WorkflowEngine<TContext, TEnum>
  storage: WorkflowStorage
}

/**
 * Creates a workflow engine with database storage backend
 *
 * @param initialState - The initial workflow state
 * @returns A fully configured WorkflowEngine instance and its storage
 */
export function createWorkflowEngineWithDB<TContext extends BaseWorkflowContext = BaseWorkflowContext, TEnum extends AnyEnum = AnyEnum>(
  initialState: WorkflowState<TContext>
): WorkflowEngineWithStorage<TContext, TEnum> {
  const storage = new DBWorkflowStorage()
  const engine = createWorkflowEngine<TContext, TEnum>(initialState, storage)
  return { engine, storage }
}