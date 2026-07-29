import {
  WorkflowEngine,
  WorkflowState,
  CheckpointHandler,
  AgenticCheckpointConfig,
  AgenticCheckpointResult,
  ConditionalHandler,
  ExternalStepHandler,
  ExternalResponseProcessor,
  ExternalStepMetadata,
  WhileLoopBodyFunction,
  ParallelWorkflowConfig,
  BaseWorkflowContext,
  AnyEnum
} from '../workflow-types'

/**
 * IterationScopedEngine provides automatic step scoping for while loop iterations.
 * It wraps a base WorkflowEngine and automatically prefixes all step IDs with
 * the loop context: {loopId}.iter_{iteration}.{stepId}
 *
 * This eliminates the need for developers to manually manage step naming
 * conventions within while loops while maintaining full pause/resume functionality.
 */
export class IterationScopedEngine<
  TContext extends BaseWorkflowContext,
  TEnum extends AnyEnum
> implements WorkflowEngine<TContext, TEnum> {
  private readonly stepPrefix: string

  constructor(
    private readonly baseEngine: WorkflowEngine<TContext, TEnum>,
    private readonly loopId: string,
    private readonly iteration: number
  ) {
    this.stepPrefix = `${loopId}.iter_${iteration}`
  }

  /**
   * Creates a scoped step ID by prefixing with loop context
   */
  private createScopedId(stepId: string): string {
    return `${this.stepPrefix}.${stepId}`
  }

  /**
   * Creates a checkpoint with automatic step scoping
   */
  async createCheckpoint<R, Args extends unknown[]>(
    id: TEnum[keyof TEnum],
    handler: CheckpointHandler<R, Args>,
    ...args: Args
  ): Promise<R> {
    const scopedId = this.createScopedId(String(id))
    return this.baseEngine.createCheckpoint(scopedId as TEnum[keyof TEnum], handler, ...args)
  }

  /**
   * Creates an agentic checkpoint with automatic step scoping
   */
  async createAgenticCheckpoint(
    id: TEnum[keyof TEnum],
    name: string,
    config: AgenticCheckpointConfig,
    parentStepId?: string
  ): Promise<AgenticCheckpointResult> {
    const scopedId = this.createScopedId(String(id))
    const scopedParentId = parentStepId || this.loopId
    return this.baseEngine.createAgenticCheckpoint(scopedId as TEnum[keyof TEnum], name, config, scopedParentId)
  }


  /**
   * Creates a conditional step with automatic step scoping
   */
  async createConditionalStep<Args extends unknown[]>(
    id: TEnum[keyof TEnum],
    condition: ConditionalHandler<Args>,
    ...args: Args
  ): Promise<boolean> {
    const scopedId = this.createScopedId(String(id))
    return this.baseEngine.createConditionalStep(scopedId as TEnum[keyof TEnum], condition, ...args)
  }

  /**
   * Creates an external step with automatic step scoping
   */
  async createExternalStep<R, Args extends unknown[], E = never>(
    id: TEnum[keyof TEnum],
    metadata: ExternalStepMetadata,
    requestHandler: ExternalStepHandler<Args, E>,
    responseProcessor: ExternalResponseProcessor<R, E>,
    ...args: Args
  ): Promise<R> {
    const scopedId = this.createScopedId(String(id))
    return this.baseEngine.createExternalStep(scopedId as TEnum[keyof TEnum], metadata, requestHandler, responseProcessor, ...args)
  }

  /**
   * Creates a nested while loop with automatic step scoping
   * Supports unlimited nesting depth by creating another scoped engine
   */
  async createWhileLoop(
    id: TEnum[keyof TEnum],
    maxIterations: number,
    body: WhileLoopBodyFunction<TContext>,
    parentStepId?: string
  ): Promise<void> {
    const scopedId = this.createScopedId(String(id))
    const scopedParentId = parentStepId || this.stepPrefix

    // Create a scoped body function that creates nested scoped engines
    const scopedBody: WhileLoopBodyFunction<TContext> = async (iteration, _engine, nestedParentStepId) => {
      // Create a new iteration-scoped engine for the nested loop
      const nestedScopedEngine = new IterationScopedEngine<TContext, TEnum>(this, scopedId, iteration)
      return await body(iteration, nestedScopedEngine, nestedParentStepId)
    }

    return this.baseEngine.createWhileLoop(scopedId as TEnum[keyof TEnum], maxIterations, scopedBody, scopedParentId)
  }

  /**
   * Creates parallel workflows with automatic step scoping
   */
  async createParallelWorkflows<
    const Tasks extends readonly import('../workflow-types').ValidatedWorkflowTask[],
    TFinalResult = void
  >(
    id: TEnum[keyof TEnum],
    config: ParallelWorkflowConfig<Tasks, TFinalResult>,
    parentStepId?: string
  ): Promise<TFinalResult> {
    const scopedId = this.createScopedId(String(id))
    const scopedParentId = parentStepId || this.stepPrefix
    return this.baseEngine.createParallelWorkflows<Tasks, TFinalResult>(scopedId as TEnum[keyof TEnum], config, scopedParentId)
  }

  /**
   * Get readonly context
   */
  getContext(): Readonly<TContext> {
    return this.baseEngine.getContext()
  }

  /**
   * Delegates to base engine - state is shared across all scoped engines
   */
  getCurrentState(): WorkflowState<TContext> {
    return this.baseEngine.getCurrentState()
  }

  /**
   * Delegates to base engine
   */
  getWorkflowId(): string {
    return this.baseEngine.getWorkflowId()
  }

  /**
   * Delegates to base engine
   */
  getWorkflowExecutionId(): string {
    return this.baseEngine.getWorkflowExecutionId()
  }

  /**
   * Delegates to base engine for pending agentic results
   */
  getPendingAgenticResults(): Array<{
    checkpointId: string
    result: import('@framework').ConversationResult
    gitInfo: import('../workflow-types').GitInfo
  }> {
    return this.baseEngine.getPendingAgenticResults()
  }

  /**
   * Gets the current loop context for debugging/logging
   */
  getLoopContext(): { loopId: string; iteration: number; stepPrefix: string } {
    return {
      loopId: this.loopId,
      iteration: this.iteration,
      stepPrefix: this.stepPrefix
    }
  }
}
