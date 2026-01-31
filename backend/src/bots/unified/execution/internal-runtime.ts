/**
 * Unified Bot Framework - Internal Runtime
 *
 * Handles execution of internal (class-based) bots.
 * Supports both queue-based and direct execution.
 */

import type {
  BotCatalogEntry,
  BotExecutionContext,
  BotEvent,
  BotRuntime,
  InternalBotDefinition,
} from '../types/index.js';
import type { ExecutionRequest, ExecutionResult } from '../orchestrator/execution-orchestrator.js';
import {
  createErrorEvent,
  isInternalBot,
} from '../types/index.js';
import {logger} from '@/utils/logger';


/**
 * Internal Bot Runtime
 *
 * Executes internal bots either directly or via queue.
 */
class InternalBotRuntime {
  /**
   * Execute an internal bot directly (non-queued)
   * Returns an async generator of BotEvents
   */
  async *executeDirect(
    entry: BotCatalogEntry,
    context: BotExecutionContext,
    request: ExecutionRequest
  ): AsyncGenerator<BotEvent> {
    const definition = entry.definition;

    if (!isInternalBot(definition)) {
      throw new Error('Expected internal bot definition');
    }

    // Get the bot class from the catalog entry
    const BotClass = entry.botClass;
    if (!BotClass) {
      throw new Error(`No bot class registered for bot: ${definition.id}`);
    }

    // Create bot instance
    const botInstance = new BotClass() as BotRuntime;

    // Validate input against schema
    const input = this.parseInput(definition, request);

    try {
      // Execute bot - returns AsyncGenerator<BotEvent>
      const generator = botInstance.run(input, context);

      // Forward all events from the bot
      for await (const event of generator) {
        yield event;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[InternalBotRuntime] Execution error for ${definition.id}:`, errorMessage);
      yield createErrorEvent(errorMessage);
    }
  }

  /**
   * Execute an internal bot via queue
   * Returns immediately with a placeholder result
   */
  async executeQueued(
    entry: BotCatalogEntry,
    _context: BotExecutionContext,
    request: ExecutionRequest
  ): Promise<ExecutionResult> {
    const definition = entry.definition;

    if (!isInternalBot(definition)) {
      throw new Error('Expected internal bot definition');
    }

    // Import queue service dynamically to avoid circular deps
    const { botQueueService } = await import('@/services/bots/botQueueService.js');

    // Validate input
    const input = this.parseInput(definition, request);

    // Queue the job
    const job = await botQueueService.queueBotExecution({
      executionId: request.userMessageId,
      conversationId: request.conversationId,
      botName: definition.id,
      input,
      userId: request.userId,
    });

    if (!job) {
      throw new Error('Failed to queue bot execution');
    }

    logger.info(`[InternalBotRuntime] Queued bot execution: ${definition.id} (job: ${job.id})`);

    // For queued execution, return non-streaming result
    // The queue processor will handle message creation
    return {
      isStreaming: false,
      messageId: null, // Will be created by queue processor
      channelId: request.channelId,
      conversationId: request.conversationId,
    };
  }

  /**
   * Parse and validate input from request
   */
  private parseInput(
    definition: InternalBotDefinition,
    request: ExecutionRequest
  ): unknown {
    // Try to parse input from parameters or message
    let rawInput: unknown = request.parameters;

    // If no parameters, try to create input object from message
    if (!rawInput || Object.keys(rawInput).length === 0) {
      rawInput = {
        message: request.message,
        query: request.message,
        input: request.message,
      };
    }

    // Validate against input schema if available
    if (definition.inputSchema) {
      try {
        return definition.inputSchema.parse(rawInput);
      } catch (error) {
        // If validation fails, try just the message
        try {
          return definition.inputSchema.parse({ message: request.message });
        } catch {
          // Return raw input if all validation fails
          logger.warn(
            `[InternalBotRuntime] Input validation failed for ${definition.id}, using raw input`
          );
          return rawInput;
        }
      }
    }

    return rawInput;
  }
}

// Export singleton instance
export const internalBotRuntime = new InternalBotRuntime();
