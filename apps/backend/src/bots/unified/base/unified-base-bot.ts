/**
 * Unified Bot Framework - Base Bot Class
 *
 * Abstract base class for internal (class-based) bots.
 * Implements the BotRuntime interface and yields unified BotEvents.
 */

import type {
  BotRuntime,
  BotExecutionContext,
  InternalBotDefinition,
  FlowJson,
  ToolOutput,
} from '../types/index.js';
import type { BotEvent } from '../types/events.js';
import {
  createContentEvent,
  createDoneEvent,
  createErrorEvent,
  createMessageCreatedEvent,
  createToolOutputEvent,
} from '../types/events.js';

/**
 * Bot input/output size limits
 */
const MAX_INPUT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Abstract base class for all internal bots in the unified framework
 */
export abstract class UnifiedBaseBot<TInput = unknown, TOutput = unknown>
  implements BotRuntime
{
  /**
   * Bot definition - must be provided by concrete implementations
   */
  protected abstract readonly definition: InternalBotDefinition<TInput, TOutput>;

  /**
   * Run the bot and yield events
   * This is the main entry point implementing BotRuntime
   */
  async *run(input: unknown, context: BotExecutionContext): AsyncGenerator<BotEvent> {
    try {
      // Check if already aborted
      if (context.abortSignal?.aborted) {
        yield createErrorEvent('Bot execution was aborted before starting');
        return;
      }

      // Validate input
      const validationResult = this.validateInput(input);
      if (!validationResult.success) {
        yield createErrorEvent(`Validation error: ${validationResult.errors.join(', ')}`);
        return;
      }

      const validatedInput = validationResult.data;

      // Check again after validation
      if (context.abortSignal?.aborted) {
        yield createErrorEvent('Bot execution was aborted during validation');
        return;
      }

      // Execute the bot and yield events
      yield* this.executeInternal(validatedInput, context);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      yield createErrorEvent(errorMessage, {
        channelId: context.channelId,
      });
    }
  }

  /**
   * Internal execution method - to be implemented by concrete bots
   * Should yield BotEvents as the bot executes
   */
  protected abstract executeInternal(
    input: TInput,
    context: BotExecutionContext
  ): AsyncGenerator<BotEvent>;

  /**
   * Get the bot definition
   */
  getDefinition(): InternalBotDefinition<TInput, TOutput> {
    return this.definition;
  }

  /**
   * Get bot ID
   */
  getBotId(): string {
    return this.definition.id;
  }

  /**
   * Get bot display name
   */
  getBotName(): string {
    return this.definition.name;
  }

  /**
   * Get bot email
   */
  getBotEmail(): string {
    return this.definition.email;
  }

  /**
   * Get bot picture
   */
  getBotPicture(): string | undefined {
    return this.definition.picture;
  }

  /**
   * Validate input against the bot's schema
   */
  protected validateInput(input: unknown): { success: true; data: TInput } | { success: false; errors: string[] } {
    // Size validation
    if (!this.validateSize(input, MAX_INPUT_SIZE_BYTES)) {
      return {
        success: false,
        errors: [`Input size exceeds maximum allowed size of ${MAX_INPUT_SIZE_BYTES} bytes`],
      };
    }

    const result = this.definition.inputSchema.safeParse(input);

    if (result.success) {
      return { success: true, data: result.data };
    }

    const errors = result.error.errors.map(
      (err) => `${err.path.join('.')}: ${err.message}`
    );

    return { success: false, errors };
  }

  /**
   * Validate output against the bot's schema
   */
  protected validateOutput(output: unknown): { success: true; data: TOutput } | { success: false; errors: string[] } {
    const result = this.definition.outputSchema.safeParse(output);

    if (result.success) {
      return { success: true, data: result.data };
    }

    const errors = result.error.errors.map(
      (err) => `${err.path.join('.')}: ${err.message}`
    );

    return { success: false, errors };
  }

  /**
   * Helper: Yield a content event
   */
  protected createContentEvent(
    content: string,
    options?: { messageId?: string | null; channelId?: string }
  ): BotEvent {
    return createContentEvent(content, options);
  }

  /**
   * Helper: Yield a done event
   */
  protected createDoneEvent(options?: {
    fullContent?: string;
    messageId?: string | null;
    channelId?: string;
    toolOutputs?: readonly ToolOutput[];
    flowJson?: FlowJson;
    sessionId?: string;
  }): BotEvent {
    return createDoneEvent(options);
  }

  /**
   * Helper: Yield an error event
   */
  protected createErrorEvent(error: string, options?: { channelId?: string }): BotEvent {
    return createErrorEvent(error, options);
  }

  /**
   * Helper: Yield a message created event
   */
  protected createMessageCreatedEvent(
    messageId: string,
    channelId: string,
    conversationId: string,
    senderId: string,
    content?: string
  ): BotEvent {
    return createMessageCreatedEvent(messageId, channelId, conversationId, senderId, content);
  }

  /**
   * Helper: Yield a tool output event
   */
  protected createToolOutputEvent(
    toolOutput: ToolOutput,
    options?: { toolName?: string; channelId?: string }
  ): BotEvent {
    return createToolOutputEvent(toolOutput, options);
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
}
