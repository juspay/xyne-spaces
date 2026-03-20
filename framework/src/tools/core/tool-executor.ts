import { v4 as uuidv4 } from 'uuid';
import type { ToolExecutionResult } from './types/tool.js';
import { logger } from '../../utils/logger.js';
import { toolRegistry } from './tool-registry.js';
import { 
  createToolExecutionError,
  ToolExecutionErrorClass,
  isToolErrorClass
} from './errors.js';

/**
 * Result that requires user input (from ask_question tool)
 */
export interface UserInputRequiredResult {
  readonly _requiresUserInput: true;
  readonly _toolName: string;
  readonly [key: string]: unknown;
}

/**
 * Check if a tool result requires user input
 */
export function requiresUserInput<T>(result: ToolExecutionResult<T>): result is ToolExecutionResult<T> & { data: UserInputRequiredResult } {
  return result.success && 
         result.data !== undefined && 
         typeof result.data === 'object' && 
         result.data !== null &&
         '_requiresUserInput' in result.data &&
         (result.data as Record<string, unknown>)['_requiresUserInput'] === true;
}

/**
 * Event handler for user input required events
 */
export type UserInputRequiredHandler = (details: {
  executionId: string;
  toolName: string;
  toolCallId: string;
  data: Record<string, unknown>;
  resume: (answers: Record<string, unknown>) => Promise<void>;
  cancel: (reason?: string) => void;
}) => void;

/**
 * Execution options for tool execution
 */
export interface ToolExecutionOptions {
  readonly timeout?: number;
  readonly metadata?: Record<string, unknown>;
  readonly abortSignal?: AbortSignal;
  readonly cwd?: string;
}

/**
 * Pending execution waiting for user input
 */
interface PendingExecution {
  executionId: string;
  toolName: string;
  toolCallId: string;
  originalInput: unknown;
  options: ToolExecutionOptions;
  resolve: (result: ToolExecutionResult<unknown>) => void;
  reject: (error: Error) => void;
}

/**
 * Tool executor for running tools with additional orchestration features
 * Handles two-phase execution for tools that require user input
 */
export class ToolExecutor {
  private cwd: string | undefined;
  private pendingExecutions = new Map<string, PendingExecution>();
  private userInputHandler?: UserInputRequiredHandler;

  /**
   * Set the working directory for tool operations
   */
  public setCwd(cwd?: string): void {
    if (cwd !== undefined) {
      this.cwd = cwd;
    } else {
      this.cwd = undefined;
    }
  }

  /**
   * Get the effective working directory (configured cwd or process.cwd())
   */
  public getEffectiveCwd(): string {
    return this.cwd || process.cwd();
  }

  /**
   * Set the handler for user input required events
   */
  public setUserInputHandler(handler: UserInputRequiredHandler): void {
    this.userInputHandler = handler;
  }

  /**
   * Execute a tool by name with input
   * If the tool requires user input, the execution will pause and emit an event
   * Use submitUserInput() to resume execution with answers
   */
  public async executeToolByName<TInput = unknown, TOutput = unknown>(
    toolName: string,
    input: TInput,
    options: ToolExecutionOptions = {},
    toolCallId?: string
  ): Promise<ToolExecutionResult<TOutput>> {
    const executionId = uuidv4();

    logger.info('Tool execution requested', {
      toolName,
      executionId,
      timeout: options.timeout
    });

    try {
      // Get tool from registry
      const toolInstance = toolRegistry.createToolInstance<TInput, TOutput>(toolName);

      // Execute with timeout if specified
      let result: ToolExecutionResult<TOutput>;
      const effectiveCwd = options.cwd || this.cwd;
      
      if (options.timeout) {
        result = await this.executeWithTimeout(
          () => toolInstance.execute(input, options.abortSignal, effectiveCwd),
          options.timeout,
          toolName,
          options.abortSignal
        );
      } else {
        result = await toolInstance.execute(input, options.abortSignal, effectiveCwd);
      }

      
      if (requiresUserInput(result)) {
        logger.info('Tool requires user input, pausing execution', {
          toolName,
          executionId,
          toolCallId
        });
       

        // Return a promise that resolves when user input is submitted
        return new Promise<ToolExecutionResult<TOutput>>((resolve, reject) => {
          // Store pending execution with toolCallId as key (if available) for easier lookup
          const mapKey = toolCallId || executionId;

          const pending: PendingExecution = {
            executionId,
            toolName,
            toolCallId: mapKey,
            originalInput: input,
            options,
            resolve: resolve as (result: ToolExecutionResult<unknown>) => void,
            reject
          };
          this.pendingExecutions.set(mapKey, pending);

          // Reject the promise when the abort signal fires so it doesn't hang forever.
          // The external-wait flow (ask_question) aborts after marking the child WAIT_FOR_EVENT.
          if (options.abortSignal) {
            if (options.abortSignal.aborted) {
              this.pendingExecutions.delete(mapKey);
              reject(new Error('Tool execution was aborted'));
              return;
            }
            options.abortSignal.addEventListener('abort', () => {
              if (this.pendingExecutions.has(mapKey)) {
                this.pendingExecutions.delete(mapKey);
                reject(new Error('Tool execution was aborted'));
              }
            }, { once: true });
          }

          // Emit user input required event
          
          if (this.userInputHandler) {
            
            this.userInputHandler({
              executionId,
              toolName,
              toolCallId: toolCallId || executionId,
              data: result.data as Record<string, unknown>,
              resume: (answers) => this.resumeExecution(mapKey, answers),
              cancel: (reason) => this.cancelExecution(mapKey, reason)
            });
          } else {
            
            this.cancelExecution(mapKey, 'No user input handler registered');
          }
        });
      }

      logger.info('Tool execution completed', {
        toolName,
        executionId,
        success: result.success,
        duration: result.metadata.duration
      });

      return result;

    } catch (error) {
      logger.error('Tool execution failed', error as Error, {
        toolName,
        executionId
      });

      // If it's already a tool error, re-throw
      if (error instanceof Error && error.name.includes('Tool')) {
        throw error;
      }

      // Wrap other errors
      throw new ToolExecutionErrorClass(createToolExecutionError(
        toolName,
        error instanceof Error ? error.message : 'Unknown execution error',
        error instanceof Error ? error : undefined
      ));
    }
  }

  /**
   * Resume execution with user answers
   * Called by the frontend when user submits answers
   */
  private async resumeExecution(
    executionId: string,
    answers: Record<string, unknown>
  ): Promise<void> {
    const pending = this.pendingExecutions.get(executionId);
    if (!pending) {
      logger.warn('Attempted to resume non-existent execution', { executionId });
      return;
    }

    logger.info('Resuming tool execution with user answers', {
      toolName: pending.toolName,
      executionId
    });

    try {
      // Combine original input with answers
      const combinedInput = {
        ...(pending.originalInput as Record<string, unknown>),
        ...answers
      };

      // Execute tool again with combined input
      const result = await this.executeToolByName(
        pending.toolName,
        combinedInput,
        pending.options
      );

      // Resolve the pending promise
      pending.resolve(result);
      this.pendingExecutions.delete(executionId);

    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
      this.pendingExecutions.delete(executionId);
    }
  }

  /**
   * Cancel a pending execution
   */
  private cancelExecution(executionId: string, reason?: string): void {
    const pending = this.pendingExecutions.get(executionId);
    if (!pending) {
      return;
    }

    logger.info('Cancelling tool execution', {
      toolName: pending.toolName,
      executionId,
      reason
    });

    pending.reject(new Error(reason || 'Execution cancelled'));
    this.pendingExecutions.delete(executionId);
  }

  /**
   * Check if an execution is pending user input
   */
  public isExecutionPending(executionId: string): boolean {
    return this.pendingExecutions.has(executionId);
  }

  /**
   * Get pending execution info
   */
  public getPendingExecution(executionId: string): { toolName: string; toolCallId: string; data: unknown } | null {
    const pending = this.pendingExecutions.get(executionId);
    if (!pending) {
      return null;
    }
    return {
      toolName: pending.toolName,
      toolCallId: pending.toolCallId,
      data: pending.originalInput
    };
  }

  /**
   * Resume a pending execution with user answers
   * Public method for external callers (e.g., ConversationService)
   */
  public resumeExecutionWithAnswers(executionId: string, answers: Record<string, unknown>): void {
    void this.resumeExecution(executionId, answers);
  }

  /**
   * Execute multiple tools in sequence
   */
  public async executeToolSequence<TInput = unknown, TOutput = unknown>(
    executions: Array<{
      readonly toolName: string;
      readonly input: TInput;
      readonly options?: ToolExecutionOptions;
    }>
  ): Promise<ToolExecutionResult<TOutput>[]> {
    const results: ToolExecutionResult<TOutput>[] = [];

    for (const execution of executions) {
      const result = await this.executeToolByName<TInput, TOutput>(
        execution.toolName,
        execution.input,
        execution.options
      );
      results.push(result);

      // Stop on first failure
      if (!result.success) {
        logger.warn('Tool sequence stopped due to failure', {
          toolName: execution.toolName,
          executedCount: results.length,
          totalCount: executions.length
        });
        break;
      }
    }

    return results;
  }

  /**
   * Execute multiple tools in parallel
   */
  public async executeToolsParallel<TInput = unknown, TOutput = unknown>(
    executions: Array<{
      readonly toolName: string;
      readonly input: TInput;
      readonly options?: ToolExecutionOptions;
    }>
  ): Promise<ToolExecutionResult<TOutput>[]> {
    const promises = executions.map(execution =>
      this.executeToolByName<TInput, TOutput>(
        execution.toolName,
        execution.input,
        execution.options
      ).catch(error => {
        // Convert errors to failed results instead of throwing
        const toolError = isToolErrorClass(error)
          ? error.toolError
          : createToolExecutionError(
              execution.toolName,
              error instanceof Error ? error.message : 'Unknown error'
            );

        return {
          success: false,
          error: toolError,
          metadata: {
            toolName: execution.toolName,
            executionId: uuidv4(),
            startTime: new Date(),
            endTime: new Date(),
            duration: 0
          }
        } as ToolExecutionResult<TOutput>;
      })
    );

    return Promise.all(promises);
  }

  /**
   * Get the tool registry instance
   */
  public getRegistry(): typeof toolRegistry {
    return toolRegistry;
  }

  /**
   * Execute a tool with timeout and abort signal support
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    toolName: string,
    abortSignal?: AbortSignal
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      // Check if already aborted
      if (abortSignal?.aborted) {
        reject(new Error('Tool execution was aborted before starting'));
        return;
      }

      let completed = false;
      
      const timer = setTimeout(() => {
        if (!completed) {
          completed = true;
          const timeoutError = new ToolExecutionErrorClass(createToolExecutionError(
            toolName,
            `Tool execution timed out after ${timeoutMs}ms`
          ));
          reject(timeoutError);
        }
      }, timeoutMs);

      // Handle abort signal
      const abortHandler = (): void => {
        if (!completed) {
          completed = true;
          clearTimeout(timer);
          reject(new Error('Tool execution was aborted'));
        }
      };

      if (abortSignal) {
        abortSignal.addEventListener('abort', abortHandler);
      }

      operation()
        .then(result => {
          if (!completed) {
            completed = true;
            clearTimeout(timer);
            if (abortSignal) {
              abortSignal.removeEventListener('abort', abortHandler);
            }
            resolve(result);
          }
        })
        .catch(error => {
          if (!completed) {
            completed = true;
            clearTimeout(timer);
            if (abortSignal) {
              abortSignal.removeEventListener('abort', abortHandler);
            }
            // Ensure we reject with an Error object
            if (error instanceof Error) {
              reject(error);
            } else {
              reject(new Error(typeof error === 'string' ? error : 'Unknown error'));
            }
          }
        });
    });
  }
}

/**
 * Global tool executor instance
 */
export const toolExecutor = new ToolExecutor();