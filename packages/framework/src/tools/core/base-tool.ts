import { v4 as uuidv4 } from 'uuid';
import type { z } from 'zod';
import type { 
  ToolExecutionResult, 
  ToolExecutionMetadata,
  ToolExecutionContext,
  ToolValidationContext,
  ToolInstance 
} from './types/tool.js';
import { validateWithSchema, validateSize } from '../../utils/validation.js';
import { logger } from '../../utils/logger.js';
import { MAX_INPUT_SIZE_BYTES, MAX_OUTPUT_SIZE_BYTES } from '../../utils/constants.js';
import { 
  createToolValidationError, 
  createToolExecutionError,
  ToolValidationErrorClass,
  isToolErrorClass
} from './errors.js';

/**
 * Abstract base class for all tools in the framework
 */
export abstract class BaseTool<TInput = unknown, TOutput = unknown, TLLMOutput = unknown> 
  implements ToolInstance<TInput, TOutput> {
  
  protected abstract readonly inputSchema: z.ZodType<TInput>;
  protected abstract readonly outputSchema: z.ZodType<TOutput>;
  protected abstract readonly toolName: string;

  /**
   * Extract minimal content for LLM consumption from the full tool result
   * Each tool implementation decides what essential information to include
   */
  public abstract getLLMOutput(result: ToolExecutionResult<TOutput>): TLLMOutput;

  /**
   * Execute the tool with input validation and error handling
   */
  public async execute(input: TInput, abortSignal?: AbortSignal, cwd?: string): Promise<ToolExecutionResult<TOutput>> {
    const executionId = uuidv4();
    const startTime = new Date();
    
    const context: ToolExecutionContext = {
      executionId,
      toolName: this.toolName,
      startTime,
      ...(abortSignal && { abortSignal }),
      ...(cwd && { cwd })
    };

    logger.debug('Tool execution started', { 
      toolName: this.toolName, 
      executionId 
    });

    try {
      // Check if already aborted
      if (abortSignal?.aborted) {
        throw new Error('Tool execution was aborted before starting');
      }

      // Validate input
      const validatedInput = this.validateInput(input);
      
      // Check again after validation
      if (abortSignal?.aborted) {
        throw new Error('Tool execution was aborted during validation');
      }
      
      // Execute the tool
      const result = await this.executeInternal(validatedInput, context);
      
      // Validate output
      const validatedOutput = this.validateOutput(result);
      
      const endTime = new Date();
      const metadata = this.createExecutionMetadata(executionId, startTime, endTime, input, validatedOutput);
      
      logger.debug('Tool execution completed successfully', { 
        toolName: this.toolName, 
        executionId,
        duration: metadata.duration 
      });

      return {
        success: true,
        data: validatedOutput,
        metadata
      };

    } catch (error) {
      const endTime = new Date();
      const metadata = this.createExecutionMetadata(executionId, startTime, endTime, input);
      
      logger.error('Tool execution failed', error as Error, { 
        toolName: this.toolName, 
        executionId 
      });

      if (isToolErrorClass(error)) {
        return {
          success: false,
          error: error.toolError,
          metadata
        };
      }

      return {
        success: false,
        error: createToolExecutionError(
          this.toolName,
          error instanceof Error ? error.message : 'Unknown error occurred',
          error instanceof Error ? error : undefined
        ),
        metadata
      };
    }
  }

  /**
   * Internal execution method to be implemented by concrete tools
   */
  protected abstract executeInternal(
    input: TInput, 
    context: ToolExecutionContext
  ): Promise<TOutput>;

  /**
   * Validate input against the tool's schema
   */
  protected validateInput(input: unknown): TInput {
    // Size validation
    if (!validateSize(input, MAX_INPUT_SIZE_BYTES)) {
      throw new ToolValidationErrorClass(createToolValidationError(
        this.toolName,
        [`Input size exceeds maximum allowed size of ${MAX_INPUT_SIZE_BYTES} bytes`]
      ));
    }

    const validationContext: ToolValidationContext = {
      toolName: this.toolName,
      phase: 'input',
      data: input
    };

    const result = validateWithSchema(this.inputSchema, input, validationContext);
    
    if (!result.success) {
      throw new ToolValidationErrorClass(createToolValidationError(this.toolName, result.errors || []));
    }

    return result.data!;
  }

  /**
   * Validate output against the tool's schema
   */
  protected validateOutput(output: TOutput): TOutput {
    // Size validation
    if (!validateSize(output, MAX_OUTPUT_SIZE_BYTES)) {
      throw new ToolValidationErrorClass(createToolValidationError(
        this.toolName,
        [`Output size exceeds maximum allowed size of ${MAX_OUTPUT_SIZE_BYTES} bytes`]
      ));
    }

    const validationContext: ToolValidationContext = {
      toolName: this.toolName,
      phase: 'output',
      data: output
    };

    const result = validateWithSchema(this.outputSchema, output, validationContext);
    
    if (!result.success) {
      throw new ToolValidationErrorClass(createToolValidationError(this.toolName, result.errors || []));
    }

    return result.data!;
  }

  /**
   * Get the effective working directory from context or fallback to process.cwd()
   * This should be used by tools instead of directly calling process.cwd()
   */
  protected getEffectiveCwd(context: ToolExecutionContext): string {
    return context.cwd || process.cwd();
  }

  /**
   * Create execution metadata for tracing
   */
  private createExecutionMetadata(
    executionId: string,
    startTime: Date,
    endTime: Date,
    input: unknown,
    output?: unknown
  ): ToolExecutionMetadata {
    const inputSize = new TextEncoder().encode(JSON.stringify(input)).length;
    const outputSize = output ? new TextEncoder().encode(JSON.stringify(output)).length : undefined;

    return {
      toolName: this.toolName,
      executionId,
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
      inputSize,
      ...(outputSize !== undefined && { outputSize })
    };
  }
}