/**
 * Unified Bot Controller
 *
 * Unified API controller for all bot operations.
 * Delegates to the ExecutionOrchestrator for bot execution.
 */

import { Request, Response } from 'express';
import {
  executionOrchestrator,
  botCatalog,
  unifiedDMService,
  type BotEvent,
} from '@/bots/unified/index.js';
import { ConversationRepository } from '@/database/repositories/conversationRepository';
import { MessageRepository } from '@/database/repositories/messageRepository';
import { MessageType } from '@prisma/client';
import {logger} from '@/utils/logger';
import { messageMetadataService } from '@/services/messageMetadataService';

const conversationRepository = new ConversationRepository();
const messageRepository = new MessageRepository();

/**
 * List all available bots
 */
export async function listBots(req: Request, res: Response): Promise<void> {
  try {
    const { scope, q } = req.query;

    let bots;

    if (q && typeof q === 'string') {
      bots = botCatalog.search(q);
    } else if (scope && typeof scope === 'string') {
      bots = botCatalog.getByScope(scope as 'conversation' | 'thread' | 'dm' | 'all');
    } else {
      bots = botCatalog.getAll();
    }

    const botInfos = bots.map((entry) => ({
      id: entry.definition.id,
      name: entry.definition.name,
      email: entry.definition.email,
      picture: entry.definition.picture,
      description: entry.definition.description,
      scope: entry.definition.scope,
      runtimeType: entry.definition.runtimeType,
      interactionMode: entry.definition.interactionMode ?? 'execute',
      dbUserId: entry.dbUserId,
    }));

    res.json({
      success: true,
      data: {
        bots: botInfos,
        totalCount: botInfos.length,
      },
    });
  } catch (error) {
    logger.error('[UnifiedBotController] Error listing bots:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list bots',
    });
  }
}

/**
 * Get a bot by ID
 */
export async function getBot(req: Request, res: Response): Promise<void> {
  try {
    const { botId } = req.params;
    const entry = botCatalog.getById(botId);

    if (!entry) {
      res.status(404).json({
        success: false,
        error: `Bot not found: ${botId}`,
      });
      return;
    }

    res.json({
      success: true,
      data: {
        id: entry.definition.id,
        name: entry.definition.name,
        email: entry.definition.email,
        picture: entry.definition.picture,
        description: entry.definition.description,
        scope: entry.definition.scope,
        runtimeType: entry.definition.runtimeType,
        dbUserId: entry.dbUserId,
      },
    });
  } catch (error) {
    logger.error('[UnifiedBotController] Error getting bot:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get bot',
    });
  }
}

/**
 * Chat with a bot (streaming SSE response)
 */
export async function chatWithBot(req: Request, res: Response): Promise<void> {
  try {
    const { botId } = req.params;
    const { message } = req.body;
    const user = (req as any).user;

    if (!user?.id) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    if (!message || typeof message !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Message is required',
      });
      return;
    }

    // Get or create DM channel
    const channel = await unifiedDMService.getOrCreateBotDMByBotId(user.id, botId, user.workspaceId ?? '');
    if (!channel) {
      res.status(404).json({
        success: false,
        error: `Bot not found: ${botId}`,
      });
      return;
    }

    // Create conversation for the message
    const conversation = await conversationRepository.create({
      channelId: channel.id,
      createdBy: user.id,
      initialMessageId: 'temp', // Will be updated after message creation
    });

    // Create user message
    const userMessage = await messageRepository.create({
      conversationId: conversation.conversationId,
      senderId: user.id,
      content: message,
      msgType: MessageType.USER,
    });

    // Update conversation with the actual initial message ID
    await conversationRepository.update(conversation.conversationId, {
      initialMessageId: userMessage.messageId,
    });
    await messageMetadataService.syncInitialMessageMd(conversation.conversationId);

    // Set up SSE response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send message_created event with channelId and conversationId
    // This is critical for the frontend to know where to navigate
    const messageCreatedEvent = {
      type: 'message_created',
      channelId: channel.id,
      conversationId: conversation.conversationId,
      messageId: userMessage.messageId,
    };
    res.write(`data: ${JSON.stringify(messageCreatedEvent)}\n\n`);

    // Execute bot
    const result = await executionOrchestrator.execute({
      botId,
      message,
      channelId: channel.id,
      conversationId: conversation.conversationId,
      userMessageId: userMessage.messageId,
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      isFromCanvas: true, // Controller endpoint is used by canvas genius blocks
    });

    if (result.stream) {
      // Stream events to client
      for await (const event of result.stream) {
        const sseData = formatEventForSSE(event);
        // Inject channelId and conversationId into done event for navigation
        if (event.type === 'done') {
          sseData.channelId = channel.id;
          sseData.conversationId = conversation.conversationId;
        }
        res.write(`data: ${JSON.stringify(sseData)}\n\n`);

        // Check if client disconnected
        if (res.closed) {
          break;
        }
      }
    }

    // Send done signal
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    logger.error('[UnifiedBotController] Error chatting with bot:', error);

    // If headers not sent, send error response
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to chat with bot',
      });
    } else {
      // Headers already sent, write error as SSE
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Internal server error' })}\n\n`);
      res.end();
    }
  }
}

/**
 * Execute/trigger a bot (async queue-based execution)
 */
export async function executeBot(req: Request, res: Response): Promise<void> {
  try {
    const { botId } = req.params;
    const { channelId, conversationId, parameters } = req.body;
    const user = (req as any).user;

    if (!user?.id) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    if (!channelId || !conversationId) {
      res.status(400).json({
        success: false,
        error: 'channelId and conversationId are required',
      });
      return;
    }

    // Create a trigger message
    const triggerMessage = await messageRepository.create({
      conversationId,
      senderId: user.id,
      content: parameters?.message || `@${botId}`,
      msgType: MessageType.USER,
    });

    // Execute via orchestrator
    const result = await executionOrchestrator.execute({
      botId,
      message: parameters?.message || '',
      channelId,
      conversationId,
      userMessageId: triggerMessage.messageId,
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      parameters,
    });

    res.json({
      success: true,
      data: {
        executionId: triggerMessage.messageId,
        botId,
        channelId,
        conversationId,
        status: result.isStreaming ? 'streaming' : 'queued',
      },
    });
  } catch (error) {
    logger.error('[UnifiedBotController] Error executing bot:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute bot',
    });
  }
}

/**
 * Format BotEvent for SSE response
 */
function formatEventForSSE(event: BotEvent): Record<string, unknown> {
  switch (event.type) {
    case 'content':
      return {
        type: 'content',
        content: event.content,
        messageId: event.messageId,
      };

    case 'tool_input':
      return {
        type: 'tool_input',
        toolName: event.toolName,
        toolInput: event.toolInput,
        messageId: event.messageId,
      };

    case 'tool_output':
      return {
        type: 'tool_output',
        toolOutput: event.toolOutput,
        toolName: event.toolName,
        messageId: event.messageId,
      };

    case 'message_created':
      return {
        type: 'message_created',
        messageId: event.messageId,
        channelId: event.channelId,
        conversationId: event.conversationId,
      };

    case 'done':
      return {
        type: 'done',
        messageId: event.messageId,
        toolOutputs: event.toolOutputs,
      };

    case 'error':
      return {
        type: 'error',
        error: event.error,
        messageId: event.messageId,
      };

    default:
      return event;
  }
}
