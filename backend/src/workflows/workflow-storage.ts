// Workflow storage interface for checkpoint persistence

import { UpdateAgentStepInput, WorkflowStep } from '@/types/database'
import { WorkflowState, ParallelWorkflowConfig, BaseWorkflowContext, AgenticCheckpointConfig, AgenticCheckpointResult, AgentConfigVersions } from './workflow-types'
import { AgentStep } from '@prisma/client'
import { WorkflowStepStatus } from './types/workflow-enums'
import { Agent } from 'agentic-framework'
import type { KnowledgeLearning } from './utils/knowledge-generator'
import { GitInfo } from './workflow-types'

// Framework types for storage operations
export interface FrameworkExecutionResult {
  messages: readonly any[]
  toolExecutions: readonly any[]
  metrics: any
  status: 'completed' | 'max_turns' | 'interrupted' | 'error'
  error?: string
  gitInfo?: GitInfo
}

export interface WorkflowStepData {
  stepName?: string | null
  data?: string | null
  createdAt: Date
}

export interface ChildWorkflowExecution {
  id: string
  status: string
  parentWorkflowExecutionId?: string | null
  sourceStepsId?: string | null
}

export interface WorkflowStorage {
  // Context and output storage (NEW)
  saveInitialContext<TContext extends BaseWorkflowContext>(
    workflowExecutionId: string,
    context: TContext
  ): Promise<void>
  loadInitialContext<TContext extends BaseWorkflowContext>(
    workflowExecutionId: string
  ): Promise<TContext | null>
  saveWorkflowOutput<TOutput>(
    workflowExecutionId: string,
    output: TOutput
  ): Promise<void>
  loadWorkflowOutput<TOutput>(
    workflowExecutionId: string
  ): Promise<TOutput | null>

  // Existing methods
  // New step-centric storage methods
  saveStepInput<Args extends unknown[]>(workflowExecutionId: string, stepId: string, args: Args, lookupParentIfInheriting?: boolean): Promise<string | null>
  saveStepOutput<R>(workflowExecutionId: string, stepId: string, result: R): Promise<void>
  loadStepOutput<R>(workflowExecutionId: string, stepId: string): Promise<R | null>
  loadStepOutputWithParentChain<R>(workflowExecutionId: string, stepId: string): Promise<R | null>

  // Legacy checkpoint pattern (keeping for other methods for now)
  isCheckpointCompleted(workflowExecutionId: string, checkpointId: string): Promise<boolean>
  saveCheckpointInputIfNotExists<TContext extends BaseWorkflowContext>(workflowExecutionId: string, checkpointId: string, state: WorkflowState<TContext>, parentStepId?: string): Promise<void>
  saveCheckpointState<TContext extends BaseWorkflowContext>(workflowExecutionId: string, checkpointId: string, state: WorkflowState<TContext>, parentStepId?: string): Promise<void>
  loadCheckpointState<TContext extends BaseWorkflowContext>(workflowExecutionId: string, checkpointId: string): Promise<WorkflowState<TContext> | null>

  // Separate agentic checkpoint storage
  isAgenticCheckpointCompleted(workflowExecutionId: string, checkpointId: string): Promise<boolean>
  isAgenticCheckpointCompletedWithParentChain(workflowExecutionId: string, checkpointId: string): Promise<boolean>
  saveAgenticCheckpointInputIfNotExists(workflowExecutionId: string, checkpointId: string, config: AgenticCheckpointConfig, parentStepId?: string, lookupParentIfInheriting?: boolean): Promise<string | null>
  saveAgenticCheckpointState(workflowExecutionId: string, checkpointId: string, output: AgenticCheckpointResult, parentStepId?: string): Promise<void>
  loadAgenticCheckpointState(workflowExecutionId: string, checkpointId: string): Promise<AgenticCheckpointResult | null>
  loadAgenticCheckpointStateWithParentChain(workflowExecutionId: string, checkpointId: string): Promise<AgenticCheckpointResult | null>

  // For conditional steps - store boolean results
  saveConditionalInputIfNotExists<Args extends unknown[]>(workflowExecutionId: string, conditionalId: string, args: Args, parentStepId?: string, lookupParentIfInheriting?: boolean): Promise<string | null>
  saveConditionalResult(workflowExecutionId: string, conditionalId: string, result: boolean): Promise<void>
  loadConditionalResult(workflowExecutionId: string, conditionalId: string): Promise<boolean | null>
  loadConditionalResultWithParentChain(workflowExecutionId: string, conditionalId: string): Promise<boolean | null>
  // For external steps - simple workflowExecutionId + stepId based storage

  saveExternalStepInputIfNotExists(workflowExecutionId: string, stepId: string,  data: unknown, stepSubType?: string, parentStepId?: string, lookupParentIfInheriting?: boolean): Promise<WorkflowStep | null>
  saveExternalStepData<R>(workflowExecutionId: string, stepId: string, data: R, timeToIgnore?: number): Promise<void>
  updateExternalStepRequestHandlerFlag(workflowExecutionId: string, stepId: string, updatedData: unknown): Promise<void>
  getExternalStepData<R>(workflowExecutionId: string, stepId: string): Promise<R | null>
  getExternalStepDataWithParentChain<R>(workflowExecutionId: string, stepId: string): Promise<R | null>
  getExternalStepRawResponse(workflowExecutionId: string, stepId: string): Promise<string | null>
  // For while loops - hierarchical step tracking
  saveWhileLoopInputIfNotExists(workflowExecutionId: string, loopId: string, maxIterations: number, parentStepId?: string): Promise<string>
  getLoopState(workflowExecutionId: string, loopId: string): Promise<{currentIteration: number, status: string} | null>
  updateLoopState(workflowExecutionId: string, loopId: string, iteration: number, status: string): Promise<void>
  saveWhileLoopOutput(workflowExecutionId: string, loopId: string, finalIteration: number, completionReason: 'break' | 'max_iterations'): Promise<void>

  // Framework child workflow methods
  findExistingChildExecution(parentExecutionId: string, checkpointId: string): Promise<ChildWorkflowExecution | null>
  createChildWorkflowExecution(parentExecutionId: string, workflowId: string, checkpointId: string): Promise<string>
  getChildWorkflowSteps(childExecutionId: string): Promise<WorkflowStepData[]>
  getCompletedExecutionResult(childExecutionId: string): Promise<FrameworkExecutionResult | null>
  markChildExecutionCompleted(childExecutionId: string, result: FrameworkExecutionResult): Promise<void>
  markChildExecutionFailed(childExecutionId: string, reason: string): Promise<void>
  markChildExecutionCancelled(childExecutionId: string, reason: string): Promise<void>

  // Framework step creation methods
  createToolExecutionStep(childExecutionId: string, toolExecution: any): Promise<void>
  updateToolExecutionStep(childExecutionId: string, toolData: any, toolCallStatus: string, toolInput?: Record<string, unknown>): Promise<void>
  updateToolExecutionAgentStep(toolExecutionId: string, updateData: UpdateAgentStepInput): Promise<AgentStep>
  createLLMCallStep(childExecutionId: string, llmCall: any): Promise<void>
  createAssistantMessageStep(childExecutionId: string, message: any): Promise<void>
  createUserMessageStep(childExecutionId: string, userMessage: string): Promise<void>
  createErrorStep(childExecutionId: string, error: Error): Promise<void>

  // Pause and cancel status checking
  checkWorkflowPauseOrCancelStatus(childExecutionId: string): Promise<{ isPaused: boolean; isCancelled: boolean; parentExecutionId?: string }>

  // For parallel workflows - child workflow coordination
  saveParallelWorkflowInputIfNotExists<
    Tasks extends readonly import('./workflow-types').ValidatedWorkflowTask[],
    TFinalResult
  >(workflowExecutionId: string, parallelId: string, config: ParallelWorkflowConfig<Tasks, TFinalResult>, parentStepId?: string, lookupParentIfInheriting?: boolean): Promise<string | null>
  getOrCreateChildExecutions<
    Tasks extends readonly import('./workflow-types').ValidatedWorkflowTask[],
    TFinalResult
  >(workflowExecutionId: string, parallelId: string, parallelStepDbId: string, config: ParallelWorkflowConfig<Tasks, TFinalResult>): Promise<Array<{
    executionId: string
    workflowId: string
    workflowType: string
    context: BaseWorkflowContext
    status: string
  }>>
  saveParallelWorkflowResult<TResult = unknown>(workflowExecutionId: string, parallelId: string, result: TResult): Promise<void>
  loadParallelWorkflowResult<R>(workflowExecutionId: string, parallelId: string): Promise<R | null>
  loadParallelWorkflowResultWithParentChain<R>(workflowExecutionId: string, parallelId: string): Promise<R | null>
  isParallelWorkflowCompleted(workflowExecutionId: string, parallelId: string): Promise<boolean>
  isParallelWorkflowCompletedWithParentChain(workflowExecutionId: string, parallelId: string): Promise<boolean>
  updateChildWorkflowStatus(childExecutionId: string, status: string): Promise<void>

  // Parallel workflow callback tracking
  getProcessedCallbacks(workflowExecutionId: string, parallelId: string): Promise<string[]>
  markCallbackProcessed(workflowExecutionId: string, parallelId: string, childExecutionId: string): Promise<void>

  // Child workflow result loading
  loadChildResult<R>(childExecutionId: string): Promise<import('./workflow-types').ChildWorkflowResult<R>>
  loadAllChildResults(childExecutions: Array<{ executionId: string; workflowType: string; status: string }>): Promise<Array<import('./workflow-types').ChildWorkflowResult<unknown>>>

  // Sibling workflow cancellation
  cancelSiblingWorkflows(parentExecutionId: string, sourceStepsId: string, completedExecutionId: string): Promise<void>

  // Execution status update
  updateExecutionStatus(executionId: string, status: string): Promise<void>

  // Get git info from completed child execution (for continuation)
  getChildExecutionGitInfo(childExecutionId: string): Promise<{
    branch: string
    repoUrl?: string
    commitHash?: string
    baseCommitHash?: string
    pullRequestUrl?: string
    pr_link?: string
  } | null>

  // Get git info from workflow execution steps (for git diff)
  getExecutionGitInfo(executionId: string): Promise<{
    branch: string
    repoUrl?: string
    commitHash?: string
    baseCommitHash?: string
    pr_link?: string
    gitDiff?: Array<{
      oldPath: string
      newPath: string
      type: 'add' | 'delete' | 'modify' | 'rename'
      hunks: Array<{
        oldStart: number
        oldLines: number
        newStart: number
        newLines: number
        content: string
      }>
    }>
    diffStats?: {
      additions: number
      deletions: number
      files: number
    }
  } | null>

  getExecutionInfo(workflowExecutionId: string): Promise<{
    executionId: string
    workflowId: string
    status: string
    parentExecutionId: string | null
    parentWorkflowId: string | null
    parentStatus: string | null
    tag: string
    sourceStepsId: string | null
    stepInputOverrideData: string | null
  } | null>
  getWorkflowInfo(workflowId: string): Promise<{
    workflowId: string
    status: string
    workflowName: string | null
    workflowType: string | null
  } | null>
  // Step status management
  updateStepStatus(workflowExecutionId: string, stepName: string, stepType: 'input' | 'output', status: WorkflowStepStatus): Promise<void>

  // Markdown summary management
  saveStepMarkdownSummary(workflowExecutionId: string, stepName: string, markdownSummary: string): Promise<void>
  // Get agent config from database with version support
  getAgentConfigFromDb(name: string, agentConfigVersions?: AgentConfigVersions, maxTurns?: number, modelName?: string): Promise<Agent>

  // Knowledge base storage
  saveWorkflowKnowledge(workflowExecutionId: string, checkpointId: string, learnings: KnowledgeLearning[]): Promise<void>
  // Trigger consolidated knowledge canvas after all learnings are saved (called at workflow completion)
  triggerConsolidatedKnowledgeCanvas(workflowExecutionId: string, learnings: KnowledgeLearning[]): Promise<void>
  
  // Pending agentic results management for consolidated knowledge generation
  addPendingAgenticResult(workflowExecutionId: string, result: {
    checkpointId: string
    result: import('@framework').ConversationResult
    gitInfo: import('./workflow-types').GitInfo
  }): void
  getPendingAgenticResults(workflowExecutionId: string): Array<{
    checkpointId: string
    result: import('@framework').ConversationResult
    gitInfo: import('./workflow-types').GitInfo
  }>
  clearPendingAgenticResults(workflowExecutionId: string): void
}
