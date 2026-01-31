import { v4 as uuidv4 } from 'uuid';
import type { z } from 'zod';
import type {
  BotExecutionResult,
  BotExecutionMetadata,
  BotExecutionContext,
  BotValidationContext,
  BotInstance
} from './types/bot.js';
import {
  createBotValidationError,
  createBotExecutionError,
  BotValidationErrorClass,
  isBotErrorClass
} from './errors.js';
import { createSingleLineText, createFlexLayout, createFlowJson } from '@/bots/json-ui';
import type { FlowJson } from '../json-ui/types.js';

/**
 * Bot input/output size limits
 */
const MAX_INPUT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_OUTPUT_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

/**
 * Abstract base class for all bots in the framework
 */
export abstract class BaseBot<TInput = unknown, TOutput = unknown> 
  implements BotInstance<TInput, TOutput> {
  
  protected abstract readonly inputSchema: z.ZodSchema<TInput>;
  protected abstract readonly outputSchema: z.ZodType<TOutput>;
  protected abstract readonly botName: string;



  /**
   * Execute the bot with input validation and error handling
   */
  public async execute(input: TInput, context: BotExecutionContext): Promise<BotExecutionResult<TOutput>> {
    const executionId = context.executionId || uuidv4();
    const startTime = context.startTime || new Date();
    
    const executionContext: BotExecutionContext = {
      ...context,
      executionId,
      startTime,
      botName: this.botName
    };



    try {
      // Check if already aborted
      if (context.abortSignal?.aborted) {
        throw new Error('Bot execution was aborted before starting');
      }

      // Validate input
      const validatedInput = this.validateInput(input);
      
      // Check again after validation
      if (context.abortSignal?.aborted) {
        throw new Error('Bot execution was aborted during validation');
      }
      
      // Execute the bot
      const result = await this.executeInternal(validatedInput, executionContext);
      
      // Validate output
      const validatedOutput = this.validateOutput(result);
      
      const endTime = new Date();
      const metadata = this.createExecutionMetadata(executionId, startTime, endTime, input, validatedOutput, context);
      


      return {
        success: true,
        data: validatedOutput,
        metadata
      };

    } catch (error) {
      const endTime = new Date();
      const metadata = this.createExecutionMetadata(executionId, startTime, endTime, input, undefined, context);
      


      if (isBotErrorClass(error)) {
        return {
          success: false,
          error: error.botError,
          metadata
        };
      }

      return {
        success: false,
        error: createBotExecutionError(
          this.botName,
          error instanceof Error ? error.message : 'Unknown error occurred',
          error instanceof Error ? error : undefined
        ),
        metadata
      };
    }
  }

  /**
   * Internal execution method to be implemented by concrete bots
   */
  protected abstract executeInternal(
    input: TInput, 
    context: BotExecutionContext
  ): Promise<TOutput>;

  /**
   * Validate input against the bot's schema
   */
  protected validateInput(input: unknown): TInput {
    // Size validation
    if (!this.validateSize(input, MAX_INPUT_SIZE_BYTES)) {
      throw new BotValidationErrorClass(createBotValidationError(
        this.botName,
        [`Input size exceeds maximum allowed size of ${MAX_INPUT_SIZE_BYTES} bytes`]
      ));
    }

    const validationContext: BotValidationContext = {
      botName: this.botName,
      phase: 'input',
      data: input
    };

    const result = this.validateWithSchema(this.inputSchema, input, validationContext);

    if (!result.success) {
      const errorResult = result as { success: false; errors: string[] };
      throw new BotValidationErrorClass(createBotValidationError(this.botName, errorResult.errors));
    }

    return result.data!;
  }

  /**
   * Validate output against the bot's schema
   */
  protected validateOutput(output: TOutput): TOutput {
    // Size validation
    if (!this.validateSize(output, MAX_OUTPUT_SIZE_BYTES)) {
      throw new BotValidationErrorClass(createBotValidationError(
        this.botName,
        [`Output size exceeds maximum allowed size of ${MAX_OUTPUT_SIZE_BYTES} bytes`]
      ));
    }

    const validationContext: BotValidationContext = {
      botName: this.botName,
      phase: 'output',
      data: output
    };

    const result = this.validateWithSchema(this.outputSchema, output, validationContext);

    if (!result.success) {
      const errorResult = result as { success: false; errors: string[] };
      throw new BotValidationErrorClass(createBotValidationError(this.botName, errorResult.errors));
    }

    return result.data!;
  }

  /**
   * Get services from context with type safety
   */
  protected getServices(context: BotExecutionContext) {
    return context.services || {};
  }

  /**
   * Get bot display name (formatted from bot name)
   */
  public getBotName(): string {
    return this.botName
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Get bot email
   */
  public getBotEmail(): string {
    return 'bot@system.in';
  }

  /**
   * Get bot image/picture
   */
  public getBotImage(): string | undefined {
    return "data:image/jpeg;base64,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";
  }

  /**
   * Get complete bot info object
   */
  public getBotInfo(): { id: string; name: string; email: string; picture: string | undefined } {
    return {
      id: this.botName,
      name: this.getBotName(),
      email: this.getBotEmail(),
      picture: this.getBotImage(),
    };
  }

  /**
   * Validate input schema and return FlowJson string representation with validated input
   * Returns success with FlowJson string and validated input, or error with FlowJson error string
   */
  public validateInputSchema(input: Record<string, string>): { success: true; flowJson: string; validatedInput: TInput } | { success: false; flowJson: string } {
    try {
      const result = this.inputSchema.safeParse(input);
      
      if (result.success) {
        // Create FlowJson representation of successful input
        const inputFlowJson = this.createInputFlowJson(result.data);
        return { 
          success: true, 
          flowJson: JSON.stringify(inputFlowJson),
          validatedInput: result.data
        };
      } else {
        // Create FlowJson representation of validation errors
        const errorFlowJson = this.createErrorFlowJson(result.error.errors);
        return { success: false, flowJson: JSON.stringify(errorFlowJson) };
      }
    } catch (error) {
      // Create FlowJson for unexpected errors
      const errorFlowJson = this.createErrorFlowJson([{
        path: [],
        message: error instanceof Error ? error.message : 'Unknown validation error'
      }]);
      return { success: false, flowJson: JSON.stringify(errorFlowJson) };
    }
  }

  /**
   * Create FlowJson representation of successful input
   */
  protected abstract createInputFlowJson(input: TInput): FlowJson;

  /**
   * Create FlowJson representation of validation errors
   */
  protected createErrorFlowJson(errors: any[]): FlowJson {
    // Using imported functions from top of file
    
    const titleComponent = createSingleLineText('Validation Error', {
      weight: 'bold',
      size: 'lg'
    });

    const errorComponents = errors.map(err => 
      createSingleLineText(`${err.path.join('.')}: ${err.message}`, {
        weight: 'medium'
      })
    );

    const rootComponent = createFlexLayout([
      titleComponent,
      ...errorComponents
    ], {
      direction: 'column',
      gap: 8
    });

    const flowJsonResult = createFlowJson(this.botName, rootComponent);
    return flowJsonResult.success ? flowJsonResult.data : {
      version: '1.0',
      metadata: { botName: this.botName, timestamp: new Date().toISOString() },
      root: { type: 'singleLineText', props: { text: 'Validation failed' } }
    };
  }

  /**
   * Create execution metadata for tracing
   */
  private createExecutionMetadata(
    executionId: string,
    startTime: Date,
    endTime: Date,
    input: unknown,
    output?: unknown,
    context?: BotExecutionContext
  ): BotExecutionMetadata {
    const inputSize = new TextEncoder().encode(JSON.stringify(input)).length;
    const outputSize = output ? new TextEncoder().encode(JSON.stringify(output)).length : undefined;

    return {
      botName: this.botName,
      executionId,
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
      inputSize,
      ...(outputSize !== undefined && { outputSize }),
      ...(context?.conversationId && { conversationId: context.conversationId }),
      ...(context?.userId && { userId: context.userId })
    };
  }

  /**
   * Validate data size
   */
  private validateSize(data: unknown, maxSizeBytes: number): boolean {
    try {
      const size = new TextEncoder().encode(JSON.stringify(data)).length;
      return size <= maxSizeBytes;
    } catch {
      return false;
    }
  }

  /**
   * Validate data with Zod schema
   */
  private validateWithSchema<T>(
    schema: z.ZodType<T>, 
    data: unknown, 
    _context: BotValidationContext
  ): { success: true; data: T } | { success: false; errors: string[] } {
    try {
      const result = schema.safeParse(data);
      
      if (result.success) {
        return { success: true, data: result.data };
      }
      
      const errors = result.error.errors.map(err => 
        `${err.path.join('.')}: ${err.message}`
      );
      
      return { success: false, errors };
    } catch (error) {
      return { 
        success: false, 
        errors: [`Schema validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`] 
      };
    }
  }


}