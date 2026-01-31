import {
  WorkflowState,
  CheckpointHandler,
  WorkflowEngine,
  AgenticCheckpointConfig,
  AgenticCheckpointResult,
  AgenticContinuationOverride,
  ConditionalHandler,
  ExternalStepHandler,
  ExternalResponseProcessor,
  ExternalStepMetadata,
  WhileLoopBodyFunction,
  LoopControl,
  ParallelWorkflowConfig,
  BaseWorkflowContext,
  AnyEnum,
} from './workflow-types'
import { IterationScopedEngine } from './engines/iteration-scoped-engine'
import { WorkflowStorage } from './workflow-storage'
import { AgentExecutor } from './framework/agent-executor'
import type { ConversationRequest } from './framework/types'
import { createUserMessage } from 'agentic-framework'
import { WorkflowPausedException, WorkflowCancelledException, WorkflowExternalWaitException, WorkflowLockLostException } from './exceptions/workflow-exceptions'
import { WorkflowExecutionStatus, WorkflowStatus, WorkflowStepStatus } from './types/workflow-enums'
import { LockService } from '@/services/lockService'
import { generateMarkdownSummary } from './utils/markdown-generator'
import {logger} from '@/utils/logger';

export class WorkflowEngineImpl<
  TContext extends BaseWorkflowContext,
  TEnum extends AnyEnum
> implements WorkflowEngine<TContext, TEnum> {
  private currentState: WorkflowState<TContext>
  private storage: WorkflowStorage
  private lockService: LockService

  // Restore/rerun inheritance flags
  private shouldInheritFromParent: boolean = false
  private reachedRestorePoint: boolean = false
  private restoreStepDbId: string | null = null
  private stepInputOverrideData: unknown | null = null

  constructor(initialState: WorkflowState<TContext>, storage: WorkflowStorage) {
    // Deep freeze context to enforce immutability
    this.currentState = {
      ...initialState,
      context: Object.freeze({ ...initialState.context }) as Readonly<TContext>
    }
    this.storage = storage
    this.lockService = new LockService()

    // Initialize inheritance flags asynchronously (will be called by workflow executor)
    this.initializeInheritanceFlags().catch(error => {
      logger.error('Failed to initialize inheritance flags:', error)
    })
  }

  private async initializeInheritanceFlags(): Promise<void> {
    try {
      const executionInfo = await this.storage.getExecutionInfo(this.currentState.workflowExecutionId)

      if (executionInfo && executionInfo.tag === 'rerun' && executionInfo.sourceStepsId) {
        // This is a rerun execution - enable parent chain inheritance
        this.shouldInheritFromParent = true
        this.restoreStepDbId = executionInfo.sourceStepsId // DB ID of INPUT step to restore from
        this.reachedRestorePoint = false

        // Load step input override data once
        if (executionInfo.stepInputOverrideData) {
          this.stepInputOverrideData = JSON.parse(executionInfo.stepInputOverrideData)
          logger.info(`[WorkflowEngine] Step input override loaded for restore point: ${this.restoreStepDbId}`)
        }

        logger.info(`[WorkflowEngine] Rerun execution detected: ${this.currentState.workflowExecutionId}, restore point DB ID: ${this.restoreStepDbId}`)
      }
    } catch (error) {
      logger.error(`Failed to initialize inheritance flags for ${this.currentState.workflowExecutionId}:`, error)
    }
  }

  // Get readonly context
  getContext(): Readonly<TContext> {
    return this.currentState.context
  }

  async createCheckpoint<R, Args extends unknown[]>(
    id: TEnum[keyof TEnum],
    handler: CheckpointHandler<R, Args>,
    ...args: Args
  ): Promise<R> {
    // All workflows manage locks (child workflows now run on separate workers)
    const lockRenewed = await this.lockService.renewLock(this.currentState.workflowExecutionId)
    if (!lockRenewed) {
      throw new WorkflowLockLostException(this.currentState.workflowExecutionId, id, "Lock lost - another worker may have taken over")
    }

    await this.checkPauseStatus(id)

    // Determine if we should lookup parent for INPUT step
    const lookupParent = this.shouldInheritFromParent && !this.reachedRestorePoint

    // Save step inputs (lookup parent chain if inheriting, or create new)
    await this.storage.updateStepStatus(this.currentState.workflowExecutionId, id, 'input', WorkflowStepStatus.RUNNING)
    let inputStepDbId = await this.storage.saveStepInput(
      this.currentState.workflowExecutionId,
      id,
      args,
      lookupParent  // Lookup parent's INPUT if inheriting
    )

    // Check if this INPUT step is the restore point
    if (inputStepDbId && this.shouldInheritFromParent &&
        !this.reachedRestorePoint && inputStepDbId === this.restoreStepDbId) {
      this.reachedRestorePoint = true
      logger.info(`[WorkflowEngine] Reached restore point: ${id} (DB ID: ${inputStepDbId})`)


      // Now create INPUT for this step (the restore point)
      // Always save ORIGINAL args from function call
      inputStepDbId = await this.storage.saveStepInput(
        this.currentState.workflowExecutionId,
        id,
        args,
        false  // Don't lookup parent, create new INPUT
      )

      // If override exists, replace args for execution only
      if (this.stepInputOverrideData) {
        args = this.stepInputOverrideData as Args
      }
    }

    // Conditional lookup: use parent chain if inheriting and haven't reached restore point
    const existingResult = this.shouldInheritFromParent && !this.reachedRestorePoint
      ? await this.storage.loadStepOutputWithParentChain<R>(this.currentState.workflowExecutionId, id)
      : await this.storage.loadStepOutput<R>(this.currentState.workflowExecutionId, id)

    if (existingResult !== null) {
      return existingResult
    }

    // Execute the step function with the (potentially overridden) arguments
    const result = await handler(...args)
    await this.storage.updateStepStatus(this.currentState.workflowExecutionId, id, 'input', WorkflowStepStatus.COMPLETED)

    // Save step output (checkpoint returns data, not state)
    await this.storage.saveStepOutput(this.currentState.workflowExecutionId, id, result)

    // Generate markdown summary asynchronously (non-blocking)
    this.generateAndSaveMarkdown(id, args, result).catch(err => {
      logger.error(`Failed to generate markdown for checkpoint ${id}:`, err)
    })

    return result
  }

  async createAgenticCheckpoint(id: TEnum[keyof TEnum], name: string, config: AgenticCheckpointConfig, parentStepId?: string): Promise<AgenticCheckpointResult> {
    // Get agent from database using db-storage and create agentConfig
    const agent = await this.storage.getAgentConfigFromDb(name, config.agentConfigVersions)
    const agentConfig = agent.getConfig()

    // Create the full config with agentConfig for AgentExecutor
    const fullConfig = {
      agentConfig,
      conversationContext: config.conversationContext,
      repoInfo: config.repoInfo
    }

    // All workflows manage locks (child workflows now run on separate workers)
    const lockRenewed = await this.lockService.renewLock(this.currentState.workflowExecutionId)
    if (!lockRenewed) {
      throw new WorkflowLockLostException(this.currentState.workflowExecutionId, id, "Lock lost - another worker may have taken over")
    }

    await this.checkPauseStatus(id)

    // Determine if we should lookup parent for INPUT step
    const lookupParent = this.shouldInheritFromParent && !this.reachedRestorePoint

    // Save agentic checkpoint input (lookup parent chain if inheriting, or create new)
    let inputStepDbId = await this.storage.saveAgenticCheckpointInputIfNotExists(
      this.currentState.workflowExecutionId,
      id,
      config,
      parentStepId,
      lookupParent  // Lookup parent's INPUT if inheriting
    )

    // Check if this INPUT step is the restore point
    if (inputStepDbId && this.shouldInheritFromParent &&
        !this.reachedRestorePoint && inputStepDbId === this.restoreStepDbId) {
      this.reachedRestorePoint = true
      // Now create INPUT for this step (the restore point)
      // Always save ORIGINAL config from function call
      inputStepDbId = await this.storage.saveAgenticCheckpointInputIfNotExists(
        this.currentState.workflowExecutionId,
        id,
        config,
        parentStepId,
        false  // Don't lookup parent, create new INPUT
      )

      // Check if this is a continuation (has sourceChildExecutionId) or full config replacement
      if (this.stepInputOverrideData) {
        const override = this.stepInputOverrideData as AgenticContinuationOverride | AgenticCheckpointConfig
        
        if ('continuationUserMessage' in override && 'sourceChildExecutionId' in override) {
          // This is a continuation - we'll pass the override to AgentExecutor
          // AgentExecutor will reconstruct history from sourceChildExecutionId
          // and append the continuationUserMessage
          logger.info(`🔄 [WORKFLOW-ENGINE] Continuation detected for agentic step ${String(id)}`)
          logger.info(`   Source child execution: ${override.sourceChildExecutionId}`)
          logger.info(`   User message: ${override.continuationUserMessage.substring(0, 100)}...`)
        } else {
          // Full config replacement (existing behavior)
          config = override as AgenticCheckpointConfig
        }
      }
    }

    // Check if we have a continuation override to pass to AgentExecutor
    let continuationOverride: AgenticContinuationOverride | undefined
    if (this.reachedRestorePoint && this.stepInputOverrideData) {
      const override = this.stepInputOverrideData as AgenticContinuationOverride | AgenticCheckpointConfig
      if ('continuationUserMessage' in override && 'sourceChildExecutionId' in override) {
        continuationOverride = override
      }
    }

    // Skip completed check if this is a continuation (we want to re-execute with new message)
    if (!continuationOverride) {
      // Conditional lookup - only if NOT a continuation
      const isCompleted = this.shouldInheritFromParent && !this.reachedRestorePoint
        ? await this.storage.isAgenticCheckpointCompletedWithParentChain(this.currentState.workflowExecutionId, id)
        : await this.storage.isAgenticCheckpointCompleted(this.currentState.workflowExecutionId, id)

      if (isCompleted) {
        const savedState = this.shouldInheritFromParent && !this.reachedRestorePoint
          ? await this.storage.loadAgenticCheckpointStateWithParentChain(this.currentState.workflowExecutionId, id)
          : await this.storage.loadAgenticCheckpointState(this.currentState.workflowExecutionId, id)

        if (savedState) {
          return savedState
        }
      }
    }

    let messages = config.conversationContext?.messages || []

    if (config.conversationContext?.initialUserMessage) {
      const userMessage = createUserMessage(config.conversationContext.initialUserMessage)
      messages = [...messages, userMessage]
    }

    const conversationRequest: ConversationRequest = {
      messages,
      systemPrompt: agentConfig?.metadata?.description
    }

    // Execute framework agent with workflow tracking
    const agentExecutor = new AgentExecutor(this.storage)
    const { result, updatedState, gitInfo } = await agentExecutor.executeWithWorkflowTracking(
      this.currentState.workflowExecutionId,
      this.currentState.workflowId,
      fullConfig,
      conversationRequest,
      this.currentState,
      inputStepDbId || id,  // 🎯 FIX: Use WorkflowStep DB ID instead of step name
      continuationOverride  // Pass continuation override if this is a continuation rerun
    )

    // Update current state with framework execution result
    this.currentState = updatedState

    await this.storage.saveAgenticCheckpointState(this.currentState.workflowExecutionId, id, {result, gitInfo}, parentStepId)

    // Store agentic result for consolidated knowledge generation at workflow completion
    // Knowledge will be captured once for all agentic steps when workflow succeeds
    if (config.captureKnowledge) {
      this.storage.addPendingAgenticResult(this.currentState.workflowExecutionId, {
        checkpointId: String(id),
        result,
        gitInfo
      })
      logger.info(`💡 [WORKFLOW-ENGINE] Stored agentic result for consolidated knowledge: ${id}`)
    }

    // Generate markdown summary asynchronously (non-blocking)
    this.generateAndSaveMarkdown(id, config, result).catch((err: Error) => {
      logger.error(`Failed to generate markdown for agentic checkpoint ${id}:`, err)
    })

    return { result, gitInfo }
  }


  async createConditionalStep<Args extends unknown[]>(
    id: TEnum[keyof TEnum],
    condition: ConditionalHandler<Args>,
    ...args: Args
  ): Promise<boolean> {
    // All workflows manage locks (child workflows now run on separate workers)
    const lockRenewed = await this.lockService.renewLock(this.currentState.workflowExecutionId)
    if (!lockRenewed) {
      throw new WorkflowLockLostException(this.currentState.workflowExecutionId, id, "Lock lost - another worker may have taken over")
    }

    await this.checkPauseStatus(id)

    // Determine if we should lookup parent for INPUT step
    const lookupParent = this.shouldInheritFromParent && !this.reachedRestorePoint

    // Save conditional input (lookup parent chain if inheriting, or create new)
    let inputStepDbId = await this.storage.saveConditionalInputIfNotExists(
      this.currentState.workflowExecutionId,
      id,
      args,
      undefined,  // parentStepId
      lookupParent  // Lookup parent's INPUT if inheriting
    )

    // Check if this INPUT step is the restore point
    if (inputStepDbId && this.shouldInheritFromParent &&
        !this.reachedRestorePoint && inputStepDbId === this.restoreStepDbId) {
      this.reachedRestorePoint = true

      // Now create INPUT for this step (the restore point)
      // Always save ORIGINAL args from function call
      inputStepDbId = await this.storage.saveConditionalInputIfNotExists(
        this.currentState.workflowExecutionId,
        id,
        args,
        undefined,  // parentStepId
        false  // Don't lookup parent, create new INPUT
      )

      // If override exists, replace args for execution only
      if (this.stepInputOverrideData) {
        args = this.stepInputOverrideData as Args
      }
    }

    // Conditional lookup
    const existingResult = this.shouldInheritFromParent && !this.reachedRestorePoint
      ? await this.storage.loadConditionalResultWithParentChain(this.currentState.workflowExecutionId, id)
      : await this.storage.loadConditionalResult(this.currentState.workflowExecutionId, id)

    if (existingResult !== null) {
      return existingResult
    }

    // Execute the conditional function with the (potentially overridden) arguments
    const result = await condition(...args)

    // Save step output
    await this.storage.saveConditionalResult(this.currentState.workflowExecutionId, id, result)

    return result
  }

  async createExternalStep<R, Args extends unknown[], E = never>(
    id: TEnum[keyof TEnum],
    metadata: ExternalStepMetadata,
    requestHandler: ExternalStepHandler<Args, E>,
    responseProcessor: ExternalResponseProcessor<R, E>,
    ...args: Args
  ): Promise<R> {
    // All workflows manage locks (child workflows now run on separate workers)
    const lockRenewed = await this.lockService.renewLock(this.currentState.workflowExecutionId)
    if (!lockRenewed) {
      throw new WorkflowLockLostException(this.currentState.workflowExecutionId, id, "Lock lost - another worker may have taken over")
    }

    await this.checkPauseStatus(id)

    // Extract auto-generated schema from metadata (injected by plugin)
    const response_schema = metadata.responseSchema || {}

    // Determine if we should lookup parent for INPUT step
    const lookupParent = this.shouldInheritFromParent && !this.reachedRestorePoint

    // Save step inputs (lookup parent chain if inheriting, or create new)
    let workflowStep = await this.storage.saveExternalStepInputIfNotExists(
      this.currentState.workflowExecutionId,
      id,
      {
        args,
        externalMetadata: {
          type: metadata.type,
          title: metadata.title,
          response_schema  // Store the generated schema
        }
      },
      metadata.type,
      undefined,  // parentStepId
      lookupParent  // Lookup parent's INPUT if inheriting
    )

    // Check if this INPUT step is the restore point
    if (workflowStep?.id && this.shouldInheritFromParent &&
        !this.reachedRestorePoint && workflowStep.id === this.restoreStepDbId) {
      this.reachedRestorePoint = true

      // Now create INPUT for this step (the restore point)
      // Always save ORIGINAL args from function call
      workflowStep = await this.storage.saveExternalStepInputIfNotExists(
        this.currentState.workflowExecutionId,
        id,
        {
          args,
          externalMetadata: {
            type: metadata.type,
            title: metadata.title,
            response_schema
          }
        },
        metadata.type,
        undefined,  // parentStepId
        false  // Don't lookup parent, create new INPUT
      )

      // If override exists, replace args for execution only
      if (this.stepInputOverrideData) {
        args = this.stepInputOverrideData as Args
      }
    }

    // Conditional lookup
    const existingResult = this.shouldInheritFromParent && !this.reachedRestorePoint
      ? await this.storage.getExternalStepDataWithParentChain<R>(this.currentState.workflowExecutionId, id)
      : await this.storage.getExternalStepData<R>(this.currentState.workflowExecutionId, id)

    if (existingResult !== null) {
      return existingResult
    }

    // Check if external response already received
    const rawResponse = await this.storage.getExternalStepRawResponse(this.currentState.workflowExecutionId, id)
    if (rawResponse !== null) {
      // Process the raw response
      const processedResult = await responseProcessor(rawResponse)

      // Save the processed result
      await this.storage.saveExternalStepData(this.currentState.workflowExecutionId, id, processedResult, Date.now() - workflowStep!.createdAt.getTime())

      return processedResult
    }

    // Check if requestHandler has already been executed for this external step
    const stepData = workflowStep!.data ? JSON.parse(workflowStep!.data) : {}
    const requestHandlerExecuted = stepData.externalMetadata?.requestHandlerExecuted || false

    if (!requestHandlerExecuted) {
      const updatedStepData = {
        ...stepData,
        externalMetadata: {
          ...stepData.externalMetadata,
          requestHandlerExecuted: true
        }
      }
      await this.storage.updateExternalStepRequestHandlerFlag(this.currentState.workflowExecutionId, id, updatedStepData)

      const requestResult = await requestHandler(
        this.currentState.workflowExecutionId,
        workflowStep!.id,
        ...args
      )

      if (!requestResult.success) {
        const processedResult = await responseProcessor('', requestResult.data)
        await this.storage.saveExternalStepData(
          this.currentState.workflowExecutionId,
          id,
          processedResult,
          Date.now() - workflowStep!.createdAt.getTime()
        )
        return processedResult
      }
    }
    throw new WorkflowExternalWaitException(this.currentState.workflowExecutionId, id)
  }

  async createWhileLoop(
    id: TEnum[keyof TEnum],
    maxIterations: number,
    body: WhileLoopBodyFunction<TContext>,
    parentStepId?: string
  ): Promise<void> {
    // All workflows manage locks (child workflows now run on separate workers)
    const lockRenewed = await this.lockService.renewLock(this.currentState.workflowExecutionId)
    if (!lockRenewed) {
      throw new WorkflowLockLostException(this.currentState.workflowExecutionId, id, "Lock lost - another worker may have taken over")
    }

    await this.checkPauseStatus(id)

    const existingLoop = await this.storage.getLoopState(this.currentState.workflowExecutionId, id)
    const currentIteration = existingLoop?.currentIteration ?? 0
    const status = existingLoop?.status ?? 'running'

    if (status === 'completed') {
      return
    }

    // Save loop configuration for resumability (includes initial state in INPUT step)
    await this.storage.saveWhileLoopInputIfNotExists(this.currentState.workflowExecutionId, id, maxIterations, parentStepId)

    for (let iteration = currentIteration; iteration < maxIterations; iteration++) {
      await this.storage.updateLoopState(this.currentState.workflowExecutionId, id, iteration, 'running')

      // Create iteration-scoped engine for automatic step naming
      // Steps inside the loop will be automatically prefixed with: {id}.iter_{iteration}.{stepName}
      // Use the human-readable loop name (id) instead of database ID (inputStepId)
      const iterationEngine = new IterationScopedEngine<TContext, TEnum>(this, id, iteration)

      // Execute body and get loop control decision
      const loopControl = await body(iteration, iterationEngine, id)

      // Check if body wants to break the loop
      if (loopControl === LoopControl.BREAK) {
        
        await this.storage.updateLoopState(this.currentState.workflowExecutionId, id, iteration, 'completed')
        await this.storage.saveWhileLoopOutput(this.currentState.workflowExecutionId, id, iteration, 'break')
        return
      }
    }


    await this.storage.updateLoopState(this.currentState.workflowExecutionId, id, maxIterations - 1, 'completed')
    // Save final OUTPUT step (immutable final result)
    await this.storage.saveWhileLoopOutput(this.currentState.workflowExecutionId, id, maxIterations - 1, 'max_iterations')
  }

  async createParallelWorkflows<
    const Tasks extends readonly import('./workflow-types').ValidatedWorkflowTask[],
    TFinalResult = void
  >(
    id: TEnum[keyof TEnum],
    config: ParallelWorkflowConfig<Tasks, TFinalResult>,
    parentStepId?: string
  ): Promise<TFinalResult> {
    // All workflows manage locks (child workflows now run on separate workers)
    const lockRenewed = await this.lockService.renewLock(this.currentState.workflowExecutionId)
    if (!lockRenewed) {
      throw new WorkflowLockLostException(this.currentState.workflowExecutionId, id, "Lock lost - another worker may have taken over")
    }

    await this.checkPauseStatus(id)

    // Determine if we should lookup parent for INPUT step
    const lookupParent = this.shouldInheritFromParent && !this.reachedRestorePoint

    // Save INPUT step (config + processedCallbacks) - lookup parent chain if inheriting
    let parallelStepDbId = await this.storage.saveParallelWorkflowInputIfNotExists(
      this.currentState.workflowExecutionId,
      id,
      config,
      parentStepId,
      lookupParent  // Lookup parent's INPUT if inheriting
    )

    // Check if this INPUT step is the restore point
    if (parallelStepDbId && this.shouldInheritFromParent &&
        !this.reachedRestorePoint && parallelStepDbId === this.restoreStepDbId) {
      this.reachedRestorePoint = true
      logger.info(`[WorkflowEngine] Reached restore point: ${id} (DB ID: ${parallelStepDbId})`)

      // Now create INPUT for this step (the restore point)
      parallelStepDbId = await this.storage.saveParallelWorkflowInputIfNotExists(
        this.currentState.workflowExecutionId,
        id,
        config,
        parentStepId,
        false  // Don't lookup parent, create new INPUT
      )
    }

    // Conditional lookup
    const isCompleted = this.shouldInheritFromParent && !this.reachedRestorePoint
      ? await this.storage.isParallelWorkflowCompletedWithParentChain(this.currentState.workflowExecutionId, id)
      : await this.storage.isParallelWorkflowCompleted(this.currentState.workflowExecutionId, id)

    if (isCompleted) {
      const result = this.shouldInheritFromParent && !this.reachedRestorePoint
        ? await this.storage.loadParallelWorkflowResultWithParentChain<TFinalResult>(this.currentState.workflowExecutionId, id)
        : await this.storage.loadParallelWorkflowResult<TFinalResult>(this.currentState.workflowExecutionId, id)
      return result as TFinalResult
    }

    // Query DB for all child executions (creates them if don't exist with status: PENDING)
    // Pass parallelStepDbId so children get the correct WorkflowStep DB ID in sourceStepsId
    const childExecutions = await this.storage.getOrCreateChildExecutions(this.currentState.workflowExecutionId, id, parallelStepDbId!, config)

    // Load processed callbacks from INPUT step
    const processedCallbacks = await this.storage.getProcessedCallbacks(this.currentState.workflowExecutionId, id)

    // Find unprocessed completed children
    const unprocessedChildren = childExecutions.filter(child =>
      ['SUCCESS', 'FAILURE', 'CANCELLED'].includes(child.status) &&
      !processedCallbacks.includes(child.executionId)
    )

    // Process callbacks for newly completed children
    for (const child of unprocessedChildren) {
      const result = await this.storage.loadChildResult(child.executionId)
      const loopControl = await config.onExecutionComplete(result as import('./workflow-types').WorkflowResultUnion<Tasks>)

      // Mark callback as processed (atomic update within parent's lock)
      await this.storage.markCallbackProcessed(this.currentState.workflowExecutionId, id, child.executionId)

      if (loopControl === LoopControl.BREAK) {
        // Cancel remaining siblings in DB - use parallelStepDbId (DB ID, not step name)
        await this.storage.cancelSiblingWorkflows(this.currentState.workflowExecutionId, parallelStepDbId!, child.executionId)
        break // Stop processing more callbacks
      }
    }

    // Check if all children are terminal (SUCCESS/FAILURE/CANCELLED)
    const allTerminal = childExecutions.every(c =>
      ['SUCCESS', 'FAILURE', 'CANCELLED'].includes(c.status)
    )

    if (!allTerminal) {
      // Still waiting for children - mark parent and throw exception
      await this.storage.updateExecutionStatus(this.currentState.workflowExecutionId, WorkflowExecutionStatus.WAIT_FOR_EVENT)
      throw new WorkflowExternalWaitException(this.currentState.workflowExecutionId, id)
    }

    // All children complete - aggregate results
    const results = await this.storage.loadAllChildResults(childExecutions)

    // Call onAllCompleted if provided
    let finalResult: TFinalResult
    if (config.onAllCompleted) {
      finalResult = await config.onAllCompleted(results as import('./workflow-types').WorkflowResultTuple<Tasks>)
    } else {
      finalResult = undefined as TFinalResult // void case
    }

    // Save OUTPUT step (final result)
    await this.storage.saveParallelWorkflowResult(this.currentState.workflowExecutionId, id, finalResult)

    return finalResult
  }

  getCurrentState(): WorkflowState<TContext> {
    return {
      ...this.currentState,
      context: this.currentState.context // Already frozen
    }
  }

  getWorkflowId(): string {
    return this.currentState.workflowId
  }

  getWorkflowExecutionId(): string {
    return this.currentState.workflowExecutionId
  }

  // Get accumulated agentic checkpoint results for consolidated knowledge generation
  getPendingAgenticResults(): Array<{
    checkpointId: string
    result: import('@framework').ConversationResult
    gitInfo: import('./workflow-types').GitInfo
  }> {
    return this.storage.getPendingAgenticResults(this.currentState.workflowExecutionId)
  }

  // Helper method to generate and save markdown summary
  private async generateAndSaveMarkdown<Args, Result>(
    stepId: string,
    input: Args,
    output: Result
  ): Promise<void> {
    try {
      const markdown = await generateMarkdownSummary(
        stepId,
        { input },
        { output }
      )
      await this.storage.saveStepMarkdownSummary(
        this.currentState.workflowExecutionId,
        stepId,
        markdown
      )
    } catch (error) {
      logger.error(`Markdown generation failed for ${stepId}:`, error)
      // Don't throw - markdown is optional
    }
  }

  // Check if workflow should be paused or cancelled
  private async checkPauseStatus(stepId?: string): Promise<void> {
    try {
      // Get execution info including parent status via storage interface
      const executionInfo = await this.storage.getExecutionInfo(this.currentState.workflowExecutionId)
      if (!executionInfo) {
        return
      }

      // Get workflow info via storage interface
      const workflowInfo = await this.storage.getWorkflowInfo(this.currentState.workflowId)
      if (!workflowInfo) {
        return
      }

      const executionStatus = executionInfo.status as WorkflowExecutionStatus
      const workflowStatus = workflowInfo.status as WorkflowStatus

      if (executionStatus === WorkflowExecutionStatus.WAIT_FOR_EVENT) {
        throw new WorkflowExternalWaitException(this.currentState.workflowId, stepId || 'unknown')
      }

      if (executionStatus === WorkflowExecutionStatus.PAUSED || workflowStatus === WorkflowStatus.PAUSED) {
        throw new WorkflowPausedException(this.currentState.workflowId, stepId)
      }

      if (executionInfo.parentStatus === WorkflowExecutionStatus.PAUSED) {
        throw new WorkflowPausedException(executionInfo.parentWorkflowId || this.currentState.workflowId, stepId)
      }

      if (executionStatus === WorkflowExecutionStatus.CANCELLED) {
        throw new WorkflowCancelledException(this.currentState.workflowId, stepId)
      }

      if (executionInfo.parentStatus === WorkflowExecutionStatus.CANCELLED) {
        throw new WorkflowCancelledException(executionInfo.parentWorkflowId || this.currentState.workflowId, stepId)
      }
    } catch (error) {
      if (error instanceof WorkflowPausedException || error instanceof WorkflowCancelledException || error instanceof WorkflowExternalWaitException) {
        throw error
      }

      logger.error(`Error checking pause status for workflow ${this.currentState.workflowId}:`, error)
    }
  }
}

// Factory function to create a workflow engine
export function createWorkflowEngine<TContext extends BaseWorkflowContext = BaseWorkflowContext, TEnum extends AnyEnum = AnyEnum>(
  initialState: WorkflowState<TContext>,
  storage: WorkflowStorage
): WorkflowEngine<TContext, TEnum> {
  return new WorkflowEngineImpl<TContext, TEnum>(initialState, storage)
}
