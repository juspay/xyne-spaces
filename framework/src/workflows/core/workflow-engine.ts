/**
 * Core Workflow Engine Implementation
 */

import type {
  WorkflowState,
  StepConfig,
  ExecutionNode,
  WorkflowExecutionResult,
  AgenticStepConfig,
  FunctionStepConfig,
  ConditionalExecuteConfig
} from '../types/index.js';
import {
  WorkflowExecutionError,
  WorkflowValidationError
} from '../types/index.js';
import { Agent } from '../../agents/core/agent.js';
import type { ConversationResult } from '../../agents/core/agent.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// WorkFlow Builder Class
// ============================================================================

export class WorkFlow<T> {
  private steps: Map<string, StepConfig<T>> = new Map();
  private executionOrder: ExecutionNode<T>[] = [];

  /**
   * Add an agentic step that uses the Agent framework
   */
  addAgenticStep(config: AgenticStepConfig<T>): WorkFlow<T> {
    this.steps.set(config.name, { type: 'agentic', config });
    return this;
  }

  /**
   * Add a function step that executes custom TypeScript code
   */
  addFunctionStep(config: FunctionStepConfig<T>): WorkFlow<T> {
    this.steps.set(config.name, { type: 'function', config });
    return this;
  }

  /**
   * Initialize the execution graph (placeholder for future graph validation)
   */
  createGraph(): WorkFlow<T> {
    // Future: Add graph validation and optimization logic
    return this;
  }

  /**
   * Add a step execution to the workflow
   */
  execute(nodeName: string): WorkFlow<T> {
    this.executionOrder.push({ type: 'execute', target: nodeName });
    return this;
  }

  /**
   * Add a conditional execution point
   */
  conditionalExecute(config: ConditionalExecuteConfig<T>): WorkFlow<T> {
    this.executionOrder.push({ type: 'conditional', config });
    return this;
  }

  /**
   * Build and validate the workflow, returning an executable instance
   */
  build(): WorkflowExecutor<T> {
    this.validateWorkflow();
    return new WorkflowExecutor(this.steps, this.executionOrder);
  }

  /**
   * Validate the workflow configuration
   */
  private validateWorkflow(): void {
    const errors: string[] = [];

    // Check that all referenced steps exist
    for (const node of this.executionOrder) {
      if (node.type === 'execute' && node.target) {
        if (!this.steps.has(node.target)) {
          errors.push(`Step '${node.target}' referenced in execution order but not defined`);
        }
      } else if (node.type === 'conditional' && node.config) {
        for (const [path, target] of Object.entries(node.config.paths)) {
          if (target !== 'exit' && !this.steps.has(target)) {
            errors.push(`Conditional path '${path}' targets undefined step '${target}'`);
          }
        }
      }
    }

    // Check for duplicate step names
    const stepNames = Array.from(this.steps.keys());
    const duplicates = stepNames.filter((name, index) => stepNames.indexOf(name) !== index);
    if (duplicates.length > 0) {
      errors.push(`Duplicate step names found: ${duplicates.join(', ')}`);
    }

    if (errors.length > 0) {
      throw new WorkflowValidationError(errors);
    }
  }
}

// ============================================================================
// WorkflowExecutor Class
// ============================================================================

export class WorkflowExecutor<T> {
  private nodeHistory: Record<string, WorkflowState<T>[]> = {};

  constructor(
    private steps: Map<string, StepConfig<T>>,
    private executionOrder: ExecutionNode<T>[]
  ) {}

  /**
   * Start workflow execution from the state's current stage
   */
  async start(
    initialState: WorkflowState<T>
  ): Promise<WorkflowExecutionResult<T>> {
    const workflowState: WorkflowState<T> = {
      ...initialState,
      metadata: {
        ...initialState.metadata,
        startTime: new Date() // Update start time for this execution
      }
    };

    logger.info('Starting workflow execution', {
      workflowId: workflowState.metadata.workflowId,
      currentStage: workflowState.stage,
      totalSteps: this.steps.size
    });

    try {
      const finalState = await this.executeFromNode(workflowState.stage, workflowState);

      return {
        state: finalState,
        status: 'completed',
        nodeHistory: this.nodeHistory,
        metadata: {
          workflowId: finalState.metadata.workflowId,
          totalDuration: Date.now() - finalState.metadata.startTime.getTime(),
          nodesExecuted: Object.keys(this.nodeHistory),
          totalIterations: finalState.metadata.totalIterations
        }
      };
    } catch (error) {
      logger.error('Workflow execution failed', error as Error, {
        workflowId: workflowState.metadata.workflowId,
        currentStage: workflowState.stage
      });

      return {
        state: workflowState,
        status: 'error',
        error: error as Error,
        nodeHistory: this.nodeHistory,
        metadata: {
          workflowId: workflowState.metadata.workflowId,
          totalDuration: Date.now() - workflowState.metadata.startTime.getTime(),
          nodesExecuted: Object.keys(this.nodeHistory),
          totalIterations: workflowState.metadata.totalIterations
        }
      };
    }
  }

  /**
   * Resume workflow from a previous execution state
   */
  async resumeFromHistory(
    nodeHistory: Record<string, WorkflowState<T>[]>,
    nodeName: string,
    historyIndex: number = -1
  ): Promise<WorkflowExecutionResult<T>> {
    const nodeStates = nodeHistory[nodeName];
    if (!nodeStates || nodeStates.length === 0) {
      throw new WorkflowExecutionError(`No history found for node '${nodeName}'`);
    }

    const stateIndex = historyIndex < 0 ? nodeStates.length + historyIndex : historyIndex;
    const resumeState = nodeStates[stateIndex];

    if (!resumeState) {
      throw new WorkflowExecutionError(`Invalid history index ${historyIndex} for node '${nodeName}'`);
    }

    logger.info('Resuming workflow from history', {
      workflowId: resumeState.metadata.workflowId,
      nodeName,
      historyIndex: stateIndex
    });

    // Restore node history for continued tracking
    this.nodeHistory = { ...nodeHistory };

    // Update the stage to the specified node and start from there
    const updatedState = { ...resumeState, stage: nodeName };
    return await this.start(updatedState);
  }

  /**
   * Execute workflow starting from a specific node
   */
  private async executeFromNode(
    startNode: string,
    state: WorkflowState<T>
  ): Promise<WorkflowState<T>> {
    const startIndex = this.findNodeIndex(startNode);
    let currentState = { ...state };

    for (let i = startIndex; i < this.executionOrder.length; i++) {
      const node = this.executionOrder[i];
      if (!node) continue;

      if (node.type === 'execute' && node.target) {
        currentState = await this.executeStep(node.target, currentState);
      } else if (node.type === 'conditional' && node.config) {
        const nextNode = await this.executeConditional(node.config, currentState);

        if (nextNode === 'exit') {
          logger.info('Workflow exiting via conditional path', {
            workflowId: currentState.metadata.workflowId,
            currentStage: currentState.stage
          });
          break;
        }

        if (node.config.paths[nextNode]) {
          const targetNode = node.config.paths[nextNode];
          if (targetNode === 'exit') {
            logger.info('Workflow exiting via conditional path', {
              workflowId: currentState.metadata.workflowId,
              targetNode
            });
            break;
          }

          // Jump to specified path
          const newIndex = this.findNodeIndex(targetNode);
          i = newIndex - 1; // -1 because loop will increment
          continue;
        }

        // Default: continue to next node (next .execute())
      }
    }

    return currentState;
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    nodeName: string,
    state: WorkflowState<T>
  ): Promise<WorkflowState<T>> {
    logger.debug('Executing workflow step', {
      workflowId: state.metadata.workflowId,
      stepName: nodeName,
      iteration: state.metadata.totalIterations + 1
    });

    // Store state before execution
    this.storeNodeState(nodeName, state);

    const step = this.steps.get(nodeName);
    if (!step) {
      throw new WorkflowExecutionError(`Step '${nodeName}' not found`, nodeName);
    }

    let currentState = { ...state, stage: nodeName };
    currentState.metadata.totalIterations++;

    const startTime = Date.now();

    try {
      if (step.type === 'agentic') {
        currentState = await this.executeAgenticStep(step.config as AgenticStepConfig<T>, currentState);
      } else if (step.type === 'function') {
        currentState = await this.executeFunctionStep(step.config as FunctionStepConfig<T>, currentState);
      }

      const duration = Date.now() - startTime;
      logger.debug('Step execution completed', {
        workflowId: currentState.metadata.workflowId,
        stepName: nodeName,
        duration,
        messageCount: currentState.messages.length
      });

      return currentState;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Step execution failed', error as Error, {
        workflowId: currentState.metadata.workflowId,
        stepName: nodeName,
        duration
      });
      throw new WorkflowExecutionError(
        `Step '${nodeName}' failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        nodeName,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Execute an agentic step using the Agent framework
   */
  private async executeAgenticStep(
    config: AgenticStepConfig<T>,
    state: WorkflowState<T>
  ): Promise<WorkflowState<T>> {
    let currentState = { ...state };

    // Apply before hook
    if (config.before) {
      currentState = await config.before(currentState);
    }

    // Get agent configuration
    const agentConfig = await config.agenticConfig(currentState);

    // Get system prompt if provided
    const systemPrompt = config.systemPrompt ? await config.systemPrompt(currentState) : undefined;

    // Create agent using existing framework
    const agent = Agent.create(agentConfig);

    // Execute conversation with current state messages
    const result: ConversationResult = await agent.execute({
      messages: currentState.messages,
      ...(systemPrompt && { systemPrompt })
    });

    // Apply after hook
    if (config.after) {
      currentState = await config.after(currentState, result);
    } else {
      // Default behavior: append new messages to state
      currentState.messages.push(...result.messages.slice(currentState.messages.length));
    }

    // Dispose agent to free resources
    await agent.dispose();

    return currentState;
  }

  /**
   * Execute a function step
   */
  private async executeFunctionStep(
    config: FunctionStepConfig<T>,
    state: WorkflowState<T>
  ): Promise<WorkflowState<T>> {
    return await config.handler(state);
  }

  /**
   * Execute a conditional branch
   */
  private async executeConditional(
    config: ConditionalExecuteConfig<T>,
    state: WorkflowState<T>
  ): Promise<string> {
    logger.debug('Executing conditional', {
      workflowId: state.metadata.workflowId,
      availablePaths: Object.keys(config.paths)
    });

    const result = await config.handler(state);

    logger.debug('Conditional result', {
      workflowId: state.metadata.workflowId,
      result,
      targetPath: config.paths[result] || 'default (continue)'
    });

    return result;
  }

  /**
   * Store node state for history tracking
   */
  private storeNodeState(nodeName: string, state: WorkflowState<T>): void {
    if (!this.nodeHistory[nodeName]) {
      this.nodeHistory[nodeName] = [];
    }

    this.nodeHistory[nodeName].push({
      ...state
    });
  }

  /**
   * Find the index of a node in the execution order
   */
  private findNodeIndex(nodeName: string): number {
    for (let i = 0; i < this.executionOrder.length; i++) {
      const node = this.executionOrder[i];
      if (node && node.type === 'execute' && node.target === nodeName) {
        return i;
      }
    }

    throw new WorkflowExecutionError(`Node '${nodeName}' not found in execution order`);
  }
}