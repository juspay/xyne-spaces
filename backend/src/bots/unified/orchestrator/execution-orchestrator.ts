/**
 * Unified Bot Framework - Execution Orchestrator
 *
 * THE single entry point for all bot execution in the unified framework.
 * Handles resolution, context building, persistence, and streaming.
 */

import { MessageType } from '@prisma/client';
import { MessageRepository } from '@/database/repositories/messageRepository';
import { ConversationRepository } from '@/database/repositories/conversationRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { websocketService } from '@/services/websocketService';
import {
  botCatalog,
  type BotDefinition,
  type BotCatalogEntry,
  type BotExecutionContext,
  type BotEvent,
  isInternalBot,
  isExternalBot,
  createErrorEvent,
} from '../index.js';
import { processStreamAndCreateCanvas, createCanvasWithGeniusBlock, CANVAS_ENABLED_BOTS } from './canvas-creator.js';
import {logger} from '@/utils/logger';

const messageRepository = new MessageRepository();
const conversationRepository = new ConversationRepository();
const channelRepository = new ChannelRepository();

/**
 * Convert tool outputs to HTML elements for embedding in message content
 * Tool outputs are serialized as data attributes and parsed by RenderMessageWithHTML
 */
function serializeToolOutputsToHtml(outputs: unknown[]): string {
  return outputs
    .map((output) => {
      const toolData = JSON.stringify(output);
      const escapedData = toolData.replace(/"/g, '&quot;');
      return `<div data-bot-tool="true" data-tool-data="${escapedData}"></div>`;
    })
    .join('');
}

/**
 * Input parameters for bot execution
 */
export interface ExecutionRequest {
  /** Bot ID to execute */
  botId: string;
  /** User's message/input */
  message: string;
  /** Channel where execution occurs */
  channelId: string;
  /** Conversation ID */
  conversationId: string;
  /** User message ID that triggered this execution */
  userMessageId: string;
  /** User ID triggering the bot */
  userId: string;
  /** User's email (for context) */
  userEmail?: string;
  /** User's name (for context) */
  userName?: string;
  /** Session ID for context continuity */
  sessionId?: string;
  /** Additional parameters for bot execution */
  parameters?: Record<string, unknown>;
  /** Whether the query originated from a canvas genius block */
  isFromCanvas?: boolean;
}

/**
 * Result from bot execution
 */
export interface ExecutionResult {
  /** Whether execution is streaming */
  isStreaming: boolean;
  /** Message ID (null for streaming until created) */
  messageId: string | null;
  /** Channel ID */
  channelId: string;
  /** Conversation ID */
  conversationId: string;
  /** Final content (for non-streaming) */
  content?: string;
  /** Stream of bot events */
  stream?: AsyncGenerator<BotEvent>;
}

/**
 * Execution Orchestrator - THE entry point for all bot execution
 */
class ExecutionOrchestrator {
  private internalRuntime?: typeof import('../execution/internal-runtime.js');
  private externalRuntime?: typeof import('../execution/external-runtime.js');

  /**
   * Execute a bot request
   *
   * This is THE unified entry point for all bot execution:
   * 1. Resolves bot from catalog
   * 2. Builds execution context
   * 3. Delegates to appropriate runtime (internal/external)
   * 4. Handles message persistence and streaming
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    // 1. Resolve bot from catalog
    const entry = botCatalog.getById(request.botId);
    if (!entry) {
      throw new Error(`Bot not found: ${request.botId}`);
    }

    // 2. Build execution context
    const context = await this.buildContext(request, entry);

    // 3. Update conversation activity
    await this.updateConversationActivity(request);

    // 4. Delegate to appropriate runtime
    if (isInternalBot(entry.definition)) {
      return this.executeInternal(entry, context, request);
    } else if (isExternalBot(entry.definition)) {
      return this.executeExternal(entry, context, request);
    }

    throw new Error(`Unknown bot runtime type: ${request.botId}`);
  }

  /**
   * Execute an internal (class-based) bot
   */
  private async executeInternal(
    entry: BotCatalogEntry,
    context: BotExecutionContext,
    request: ExecutionRequest
  ): Promise<ExecutionResult> {
    // Lazy load internal runtime
    if (!this.internalRuntime) {
      this.internalRuntime = await import('../execution/internal-runtime.js');
    }

    const { internalBotRuntime } = this.internalRuntime;
    const definition = entry.definition;

    if (!isInternalBot(definition)) {
      throw new Error('Expected internal bot definition');
    }

    // Check if queue execution is enabled
    if (definition.useQueue !== false) {
      // Queue-based execution
      return internalBotRuntime.executeQueued(entry, context, request);
    }

    // Direct execution with streaming
    const rawStream = internalBotRuntime.executeDirect(entry, context, request);

    // For DM queries from canvas-enabled bots, create canvas first
    let canvasId: string | undefined;
    let canvasUrl: string | undefined;
    
    if (!request.isFromCanvas && CANVAS_ENABLED_BOTS.includes(request.botId)) {
        const canvasResult = await createCanvasWithGeniusBlock({
            botId: request.botId,
            userId: request.userId,
            channelId: request.channelId,
            conversationId: request.conversationId,
            query: request.message,
        });
        canvasId = canvasResult.canvasId;
        canvasUrl = canvasResult.canvasUrl;
    }

    // Wrap with canvas creation for Genius bot (must be BEFORE persistence to suppress content)
    const canvasWrappedStream = await processStreamAndCreateCanvas(rawStream, {
        botId: request.botId,
        userId: request.userId,
        channelId: request.channelId,
        conversationId: request.conversationId,
        query: request.message,
        isFromCanvas: request.isFromCanvas,
        canvasId,
        canvasUrl,
    });

    // Wrap with persistence (canvas creator has already transformed the stream)
    const wrappedStream = this.wrapWithPersistence(
        canvasWrappedStream,
        request,
        entry
    );

    return {
      isStreaming: true,
      messageId: null,
      channelId: request.channelId,
      conversationId: request.conversationId,
      stream: wrappedStream,
    };
  }

  /**
   * Execute an external (config-based) bot
   */
  private async executeExternal(
    entry: BotCatalogEntry,
    context: BotExecutionContext,
    request: ExecutionRequest
  ): Promise<ExecutionResult> {
    // Lazy load external runtime
    if (!this.externalRuntime) {
      this.externalRuntime = await import('../execution/external-runtime.js');
    }

    const { externalBotRuntime } = this.externalRuntime;

    // External bots always execute directly (no queue)
    const rawStream = externalBotRuntime.execute(entry, context, request);

    // For DM queries from canvas-enabled bots, create canvas first
    let canvasId: string | undefined;
    let canvasUrl: string | undefined;
    
    if (!request.isFromCanvas && CANVAS_ENABLED_BOTS.includes(request.botId)) {
        const canvasResult = await createCanvasWithGeniusBlock({
            botId: request.botId,
            userId: request.userId,
            channelId: request.channelId,
            conversationId: request.conversationId,
            query: request.message,
        });
        canvasId = canvasResult.canvasId;
        canvasUrl = canvasResult.canvasUrl;
    }

    // Wrap with canvas creation for Genius bot (must be BEFORE persistence to suppress content)
    const canvasWrappedStream = await processStreamAndCreateCanvas(rawStream, {
        botId: request.botId,
        userId: request.userId,
        channelId: request.channelId,
        conversationId: request.conversationId,
        query: request.message,
        isFromCanvas: request.isFromCanvas,
        canvasId,
        canvasUrl,
    });

    // Wrap with persistence (canvas creator has already transformed the stream)
    const wrappedStream = this.wrapWithPersistence(
        canvasWrappedStream,
        request,
        entry
    );

    return {
      isStreaming: true,
      messageId: null,
      channelId: request.channelId,
      conversationId: request.conversationId,
      stream: wrappedStream,
    };
  }

  /**
   * Wrap a bot event stream with persistence logic
   * Handles message creation, updates, and WebSocket broadcasts
   */
  private async *wrapWithPersistence(
    stream: AsyncGenerator<BotEvent>,
    request: ExecutionRequest,
    entry: BotCatalogEntry
  ): AsyncGenerator<BotEvent> {
    let messageId: string | null = null;
    let fullContent = '';
    const toolOutputs: BotEvent[] = [];

    /**
     * Ensure bot message exists - creates lazily on first content
     */
    const ensureMessageExists = async (initialContent: string): Promise<string> => {
      if (messageId) return messageId;

      // Use the bot's DB user ID as sender
      const senderId = entry.dbUserId || entry.definition.id;

      const botMessage = await messageRepository.create({
        conversationId: request.conversationId,
        senderId,
        content: initialContent,
        msgType: MessageType.BOT,
      });
      messageId = botMessage.messageId;
      logger.info('[ExecutionOrchestrator] Created bot message:', messageId);
      return messageId;
    };

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'content':
            // Accumulate content
            if (event.content) {
              fullContent += event.content;
              const msgId = await ensureMessageExists(fullContent);
              await messageRepository.update(msgId, { content: fullContent });
              await this.broadcastMessageUpdate(request.channelId, msgId, fullContent);
            }
            // Forward event with messageId
            yield { ...event, messageId };
            break;

          case 'tool_input':
            // Forward tool input events (for thinking/processing UI)
            yield { ...event, messageId };
            break;

          case 'tool_output':
            // Collect tool outputs
            toolOutputs.push(event);
            yield { ...event, messageId };
            break;

          case 'message_created':
            // Message was created by the runtime
            if (event.messageId) {
              messageId = event.messageId;
            }
            yield event;
            break;

          case 'done':
            // Finalize message with tool outputs embedded in HTML content
            if (fullContent || toolOutputs.length > 0) {
              let finalContent = fullContent || 'No response generated';

              if (toolOutputs.length > 0) {
                const outputs = toolOutputs
                  .filter((e) => e.type === 'tool_output')
                  .map((e) => e.toolOutput)
                  .filter(Boolean);

                // Embed tool outputs as HTML in the message content
                const toolOutputHtml = serializeToolOutputsToHtml(outputs);
                finalContent = fullContent + toolOutputHtml;
              }

              const finalMsgId = await ensureMessageExists(finalContent);
              await messageRepository.update(finalMsgId, { content: finalContent });
            }

            // Save session_id to conversation metadata for follow-up messages
            if (event.sessionId) {
              const existingConversation = await conversationRepository.findById(request.conversationId);
              const existingMetadata = (existingConversation?.metadata as Record<string, unknown>) || {};
              await conversationRepository.update(request.conversationId, {
                metadata: {
                  ...existingMetadata,
                  session_id: event.sessionId,
                },
              });
              logger.info('[ExecutionOrchestrator] Saved session_id to conversation:', event.sessionId);
            }

            yield { ...event, messageId, fullContent };
            break;

          case 'error':
            // Create/update message with error
            const errorContent = `Sorry, I encountered an error: ${event.error}`;
            const errorMsgId = await ensureMessageExists(errorContent);
            await messageRepository.update(errorMsgId, { content: errorContent });
            yield { ...event, messageId: errorMsgId };
            break;

          default:
            yield event;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[ExecutionOrchestrator] Stream error:', errorMessage);

      const errorContent = `Sorry, I encountered an error: ${errorMessage}`;
      const errorMsgId = await ensureMessageExists(errorContent);
      await messageRepository.update(errorMsgId, { content: errorContent });

      yield createErrorEvent(errorMessage, errorMsgId);
    }
  }

  /**
   * Build execution context from request
   */
  private async buildContext(
    request: ExecutionRequest,
    entry: BotCatalogEntry
  ): Promise<BotExecutionContext> {
    // Get trigger message
    const triggerMessage = await messageRepository.findById(request.userMessageId);

    // Get session ID from conversation metadata if not provided
    let sessionId = request.sessionId;
    if (!sessionId) {
      const conversation = await conversationRepository.findById(request.conversationId);
      const metadata = conversation?.metadata as Record<string, unknown> | undefined;
      sessionId = metadata?.session_id as string | undefined;
    }

    return {
      executionId: request.userMessageId,
      botId: entry.definition.id,
      botUserId: entry.dbUserId,
      startTime: new Date(),
      conversationId: request.conversationId,
      channelId: request.channelId,
      userId: request.userId,
      userEmail: request.userEmail,
      userName: request.userName,
      triggerMessage,
      sessionId,
      parameters: request.parameters,
    };
  }

  /**
   * Update conversation activity counts
   */
  private async updateConversationActivity(request: ExecutionRequest): Promise<void> {
    await conversationRepository.incrementReplyCount(request.conversationId);
    await channelRepository.updateLastActivity(request.channelId);
  }

  /**
   * Broadcast message update via WebSocket
   */
  private async broadcastMessageUpdate(
    channelId: string,
    messageId: string,
    content: string
  ): Promise<void> {
    try {
      await websocketService.broadcastToSession(channelId, 'message_update', {
        messageId,
        content,
        channelId,
      });
    } catch (error) {
      logger.error('[ExecutionOrchestrator] WebSocket broadcast error:', error);
    }
  }

  /**
   * Get a bot's info for display
   */
  getBotInfo(botId: string): BotDefinition | undefined {
    return botCatalog.getById(botId)?.definition;
  }

  /**
   * List all available bots
   */
  listBots(): BotDefinition[] {
    return botCatalog.getAll().map((entry) => entry.definition);
  }

  /**
   * Search bots by query
   */
  searchBots(query: string): BotDefinition[] {
    return botCatalog.search(query).map((entry) => entry.definition);
  }
}

// Export singleton instance
export const executionOrchestrator = new ExecutionOrchestrator();
