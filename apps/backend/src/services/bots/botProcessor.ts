import { botQueueService, BotJobData } from './botQueueService';
import { BotExecutionSession } from './botExecutionSession';
import { MessageRepository } from '@/database/repositories/messageRepository';
import { ConversationRepository } from '@/database/repositories/conversationRepository';
import { botRegistry } from '@/bots/core/bot-registry';
import { BotExecutionContext } from '@/bots/core/types/bot';
import { logger } from '@/utils/logger';

export class BotProcessor {
  private messageRepository: MessageRepository;
  private conversationRepository: ConversationRepository;
  private isInitialized = false;

  constructor() {
    this.messageRepository = new MessageRepository();
    this.conversationRepository = new ConversationRepository();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Initialize the queue service first
    await botQueueService.initialize();
    
    // Then setup the queue processor
    this.setupQueueProcessor();
    
    this.isInitialized = true;
    logger.info('Bot processor initialized successfully');
  }

  private setupQueueProcessor(): void {
    const queue = botQueueService.getQueue();
    if (!queue) {
      logger.error('Bot queue not available for processing');
      return;
    }

    // Process bot execution jobs
    queue.process('execute-bot', async (job) => {
      const { executionId, conversationId, botName, input, userId } = job.data;
      
      try {
        await this.processBotExecution(executionId, conversationId, botName, input, userId);
        return { success: true };
      } catch (error) {
        logger.error(`Bot execution failed for ${executionId} (attempt ${job.attemptsMade + 1}/${job.opts.attempts}):`, error);

        // Only send error message on the final attempt (when all retries are exhausted)
        if (job.attemptsMade + 1 >= (job.opts.attempts || 1)) {
          logger.info(`Sending error message for ${executionId} after final attempt`);
          await this.sendErrorMessage(executionId, conversationId, botName, error);
        } else {
          logger.info(`Retry ${job.attemptsMade + 1}/${job.opts.attempts} for ${executionId}, not sending error message yet`);
        }

        throw error; // Re-throw to mark job as failed
      }
    });

    logger.info('Bot queue processor initialized');
  }

  private async processBotExecution(
    executionId: string,
    conversationId: string,
    botName: string,
    input: any,
    userId: string
  ): Promise<void> {
    // Get trigger message
    const triggerMessage = await this.messageRepository.findById(executionId);
    if (!triggerMessage) {
      throw new Error(`Trigger message not found for execution ${executionId}`);
    }

    // Create execution session
    const session = new BotExecutionSession(executionId, conversationId, botName);

    // Get bot instance
    const botEntry = botRegistry.getBot(botName);
    if (!botEntry) {
      logger.error(`Bot ${botName} not found in registry, skipping execution and decrementing reply count`);
      try {
        await this.conversationRepository.decrementReplyCount(conversationId);
      } catch (decrementErr) {
        logger.error(`[BotProcessor] Failed to decrement reply count for conversation ${conversationId}:`, decrementErr);
      }
      return;
    }

    // Create bot instance
    const botInstance = new botEntry.botClass();

    // Create execution context
    const context: BotExecutionContext = {
      executionId,
      botName,
      startTime: new Date(),
      conversationId,
      userId,
      triggerMessage,
      session,
      abortSignal: undefined, // TODO: Implement abort signal for timeouts
      services: undefined // TODO: Add bot services if needed
    };

    // Execute bot
    const result = await botInstance.execute(input, context);

    if (!result.success && result.error) {
      throw new Error(result.error.message);
    }

    logger.info(`Bot execution completed successfully: ${executionId}`);
  }

  private async sendErrorMessage(
    executionId: string,
    conversationId: string,
    botName: string,
    error: any
  ): Promise<void> {
    try {
      const session = new BotExecutionSession(executionId, conversationId, botName);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      await session.sendError(errorMessage);
    } catch (sendError) {
      logger.error(`Failed to send error message for execution ${executionId}:`, sendError);
    }
  }

  async queueBotExecution(data: BotJobData): Promise<boolean> {
    if (!this.isInitialized) {
      logger.error('Bot processor not initialized');
      return false;
    }
    
    const job = await botQueueService.queueBotExecution(data);
    return job !== null;
  }

  async getQueueStats() {
    return await botQueueService.getQueueStats();
  }

  async isHealthy(): Promise<boolean> {
    return await botQueueService.isHealthy();
  }
}

// Export singleton instance
export const botProcessor = new BotProcessor();