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
 * Execution options for tool execution
 */
export interface ToolExecutionOptions {
  readonly timeout?: number;
  readonly metadata?: Record<string, unknown>;
  readonly abortSignal?: AbortSignal;
  readonly cwd?: string;
}

/**
 * Tool executor for running tools with additional orchestration features
 */
export class ToolExecutor {
  private cwd: string | undefined;

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
   * Execute a tool by name with input
   */
  public async executeToolByName<TInput = unknown, TOutput = unknown>(
    toolName: string,
    input: TInput,
    options: ToolExecutionOptions = {}
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