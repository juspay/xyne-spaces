import { Request, Response } from 'express';
import {
  summarizeStream,
  type ThreadSummaryInput,
  type SummarizerContext,
  type StreamChunk,
} from '@/agents/summariser';
import { AgentsConfig } from '@/agents/config';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { redisService } from '@/services/redisService';

const EMAIL_SUMMARY_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
const EMAIL_SUMMARY_CACHE_PREFIX = 'email-summary';

/**
 * Controller for summarization using JAF agent
 * Supports both thread and channel summarization
 */
export class SummarizeController {
  /**
   * GET /api/summarize/thread/:conversationId
   */
  summarizeThread = async (req: Request, res: Response): Promise<void> => {
    const { conversationId } = req.params;

    if (!conversationId) {
      res.status(400).json({ error: 'Missing required param: conversationId is required' });
      return;
    }

    const userId = (req as any).user?.id || 'anonymous';
    const agentsConfig = await AgentsConfig.fetch({ email: (req as any).user?.email });

    try {
      logger.info(`Fetching messages for conversation: ${conversationId}`);

      const conversation = await db.conversation.findUnique({
        where: { conversationId },
      });

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const channelMember = await db.channelParticipant.findUnique({
        where: { channelId_userId: { channelId: conversation.channelId, userId } },
      });

      if (!channelMember) {
        res.status(403).json({ error: 'Forbidden: You do not have access to this conversation' });
        return;
      }

      const messages = await db.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        take: 1000,
      });

      if (messages.length === 0) {
        res.status(400).json({ error: 'No messages found in this conversation' });
        return;
      }

      const senderIds = [...new Set(messages.map((m: { senderId: string }) => m.senderId))];
      const users = await db.user.findMany({
        where: { id: { in: senderIds } },
        select: { id: true, name: true, email: true },
      });
      const userMap = new Map(users.map((u: { id: string; name: string | null; email: string | null }) => [u.id, u]));

      const threadMessages = messages.map((msg) => {
        const user = userMap.get(msg.senderId);
        return {
          id: msg.messageId,
          content: msg.content,
          authorName: user?.name || user?.email || 'Unknown User',
          createdAt: msg.createdAt,
          hasAttachment: msg.hasAttachment,
        };
      });

      logger.info(`Found ${threadMessages.length} messages in conversation: ${conversationId}`);

      const input: ThreadSummaryInput = { messages: threadMessages };
      const context: SummarizerContext = {
        userId,
        conversationId,
        channelId: conversation.channelId,
        summarizationType: 'thread',
        modelName: agentsConfig.summariserModelName,
      };

      const messageIdMappingObj: { [index: number]: string } = {};
      const conversationIdMappingObj: { [index: number]: string } = {};
      const messageIdMapping = new Map<number, string>();
      threadMessages.forEach((msg, idx) => {
        messageIdMappingObj[idx + 1] = msg.id;
        conversationIdMappingObj[idx + 1] = conversationId;
        messageIdMapping.set(idx + 1, msg.id);
      });

      const inputWithMapping: ThreadSummaryInput = { ...input, messageIdMapping };

      const getISOString = (createdAt: Date | number | bigint): string => {
        if (createdAt instanceof Date) return createdAt.toISOString();
        return new Date(Number(createdAt)).toISOString();
      };
      
      const dateFrom = threadMessages.length > 0 ? getISOString(threadMessages[0].createdAt) : undefined;
      const dateTo = threadMessages.length > 0 ? getISOString(threadMessages[threadMessages.length - 1].createdAt) : undefined;

      await this.streamSummarization(res, inputWithMapping, context, {
        type: 'thread',
        conversationId,
        channelId: conversation.channelId,
        messageCount: threadMessages.length,
        participants: users.map((u) => ({ id: u.id, name: u.name, email: u.email })),
        messageIdMapping: messageIdMappingObj,
        conversationIdMapping: conversationIdMappingObj,
        dateFrom,
        dateTo,
      });

    } catch (error) {
      this.handleError(res, error, 'thread summarization');
    }
  };

  /**
   * GET /api/summarize/email-thread/:conversationId
   * Summarizes all emails in a conversation thread (Xyne Desk)
   */
  summarizeEmailThread = async (req: Request, res: Response): Promise<void> => {
    const { conversationId } = req.params;
    const regenerate = req.query.regenerate === 'true';

    if (!conversationId) {
      res.status(400).json({ error: 'Missing required param: conversationId is required' });
      return;
    }

    const userId = (req as any).user?.id || 'anonymous';
    const agentsConfig = await AgentsConfig.fetch({ email: (req as any).user?.email });

    try {
      logger.info(`Fetching emails for conversation: ${conversationId}`);

      const conversation = await db.conversation.findUnique({
        where: { conversationId },
      });

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const channelMember = await db.channelParticipant.findUnique({
        where: { channelId_userId: { channelId: conversation.channelId, userId } },
      });

      if (!channelMember) {
        res.status(403).json({ error: 'Forbidden: You do not have access to this conversation' });
        return;
      }

      const emails = await db.email.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        take: 500,
      });

      if (emails.length === 0) {
        res.status(400).json({ error: 'No emails found in this conversation' });
        return;
      }

      const emailCount = emails.length;
      const cacheKey = `${EMAIL_SUMMARY_CACHE_PREFIX}:${conversationId}`;
      if (!regenerate) {
        try {
          const cached = await redisService.get(cacheKey);
          if (cached) {
            const cachedData = JSON.parse(cached);
            if (cachedData.emailCount === emailCount) {
              logger.info(`Serving cached email summary for conversation: ${conversationId}`);
              return this.sendCachedSummary(res, cachedData);
            }
            logger.info(`Cache stale for conversation ${conversationId}: emailCount ${cachedData.emailCount} → ${emailCount}`);
          }
        } catch (cacheErr) {
          logger.warn(`Failed to read email summary cache for ${conversationId}:`, cacheErr);
        }
      }

      // Convert emails to ThreadMessage format
      const threadMessages = emails.map((email) => {
        const fromAddress = Array.isArray(email.from) ? email.from[0] : email.from;
        const toAddresses = Array.isArray(email.to) ? email.to.join(', ') : email.to;
        const ccAddresses = email.cc && email.cc.length > 0 ? `\nCC: ${email.cc.join(', ')}` : '';

        const emailHeader = `Subject: ${email.subject || '(no subject)'}\nTo: ${toAddresses}${ccAddresses}`;
        const plainBody = email.body ? extractPlainTextFromHtml(email.body) : '';
        const content = `${emailHeader}\n\n${plainBody}`;

        return {
          id: email.id,
          content,
          authorName: fromAddress || 'Unknown Sender',
          createdAt: email.createdAt,
          hasAttachment: false,
        };
      });

      logger.info(`Found ${threadMessages.length} emails in conversation: ${conversationId}`);

      const input: ThreadSummaryInput = { messages: threadMessages };
      const context: SummarizerContext = {
        userId,
        conversationId,
        channelId: conversation.channelId,
        summarizationType: 'emailThread',
        modelName: agentsConfig.summariserModelName,
      };

      const messageIdMappingObj: { [index: number]: string } = {};
      const conversationIdMappingObj: { [index: number]: string } = {};
      const messageIdMapping = new Map<number, string>();
      threadMessages.forEach((msg, idx) => {
        messageIdMappingObj[idx + 1] = msg.id;
        conversationIdMappingObj[idx + 1] = conversationId;
        messageIdMapping.set(idx + 1, msg.id);
      });

      const inputWithMapping: ThreadSummaryInput = { ...input, messageIdMapping };

      const getISOString = (createdAt: Date | number | bigint): string => {
        if (createdAt instanceof Date) return createdAt.toISOString();
        return new Date(Number(createdAt)).toISOString();
      };

      const dateFrom = threadMessages.length > 0 ? getISOString(threadMessages[0].createdAt) : undefined;
      const dateTo = threadMessages.length > 0 ? getISOString(threadMessages[threadMessages.length - 1].createdAt) : undefined;

      await this.streamSummarization(res, inputWithMapping, context, {
        type: 'emailThread',
        conversationId,
        channelId: conversation.channelId,
        messageCount: threadMessages.length,
        participants: [...new Set(emails.map(e => Array.isArray(e.from) ? e.from[0] : e.from))].map(email => ({ email })),
        messageIdMapping: messageIdMappingObj,
        conversationIdMapping: conversationIdMappingObj,
        dateFrom,
        dateTo,
      }, cacheKey, emailCount);

    } catch (error) {
      this.handleError(res, error, 'email thread summarization');
    }
  };

  /**
   * GET /api/summarize/channel/:channelId
   */
  summarizeChannel = async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;
    const { dateFrom, dateTo } = req.query;

    if (!channelId) {
      res.status(400).json({ error: 'Missing required param: channelId is required' });
      return;
    }

    const userId = (req as any).user?.id || 'anonymous';
    const agentsConfig = await AgentsConfig.fetch({ email: (req as any).user?.email });

    try {
      logger.info(`Fetching messages for channel: ${channelId}`);

      const channel = await db.channel.findUnique({
        where: { id: channelId },
        select: { id: true, name: true },
      });

      if (!channel) {
        res.status(404).json({ error: 'Channel not found' });
        return;
      }

      const channelMember = await db.channelParticipant.findUnique({
        where: { channelId_userId: { channelId, userId } },
      });

      if (!channelMember) {
        res.status(403).json({ error: 'Forbidden: You do not have access to this channel' });
        return;
      }

      const messageDateFilter: { createdAt?: { gte?: Date; lte?: Date } } = {};
      if (dateFrom || dateTo) {
        messageDateFilter.createdAt = {};
        if (dateFrom) {
          const fromDate = new Date(dateFrom as string);
          if (!isNaN(fromDate.getTime())) messageDateFilter.createdAt.gte = fromDate;
        }
        if (dateTo) {
          const toDate = new Date(dateTo as string);
          if (!isNaN(toDate.getTime())) messageDateFilter.createdAt.lte = toDate;
        }
      }

      const conversations = await db.conversation.findMany({
        where: { channelId },
        select: { conversationId: true },
      });

      const conversationIds = conversations.map(c => c.conversationId);
      logger.info(`Found ${conversationIds.length} conversations in channel: ${channelId}`);

      let messages: any[] = [];
      if (conversationIds.length > 0) {
        messages = await db.message.findMany({
          where: { conversationId: { in: conversationIds }, ...messageDateFilter },
          orderBy: { createdAt: 'asc' },
          take: 1000,
        });
      }

      logger.info(`Found ${messages.length} messages in channel for date range`);

      if (messages.length === 0) {
        let totalMessages = 0;
        if (conversationIds.length > 0) {
          totalMessages = await db.message.count({ where: { conversationId: { in: conversationIds } } });
        }
        
        const noMessagesMessage = conversationIds.length === 0
          ? 'No conversations found in this channel'
          : totalMessages === 0
            ? 'No messages found in this channel'
            : `No messages found in the specified date range. The channel has ${totalMessages} total messages.`;
        
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        
        res.write(`data: ${JSON.stringify({ type: 'no_messages', message: noMessagesMessage, totalMessages })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
        res.end();
        return;
      }

      const senderIds = [...new Set(messages.map((m: { senderId: string }) => m.senderId))];
      const users = await db.user.findMany({
        where: { id: { in: senderIds } },
        select: { id: true, name: true, email: true },
      });
      const userMap = new Map(users.map((u: { id: string; name: string; email: string }) => [u.id, u]));

      const channelMessages = messages.map((msg) => {
        const user = userMap.get(msg.senderId);
        return {
          id: msg.messageId,
          conversationId: msg.conversationId,
          content: msg.content,
          authorName: user?.name || user?.email || 'Unknown User',
          createdAt: msg.createdAt,
          hasAttachment: msg.hasAttachment,
        };
      });

      const input: ThreadSummaryInput = { messages: channelMessages };
      const context: SummarizerContext = {
        userId,
        conversationId: '',
        channelId,
        summarizationType: 'channel',
        modelName: agentsConfig.summariserModelName,
      };

      const messageIdMappingObj: { [index: number]: string } = {};
      const conversationIdMappingObj: { [index: number]: string } = {};
      const messageIdMapping = new Map<number, string>();
      const conversationIdMapping = new Map<number, string>();
      channelMessages.forEach((msg, idx) => {
        messageIdMappingObj[idx + 1] = msg.id;
        conversationIdMappingObj[idx + 1] = msg.conversationId;
        messageIdMapping.set(idx + 1, msg.id);
        conversationIdMapping.set(idx + 1, msg.conversationId);
      });

      const inputWithMapping: ThreadSummaryInput = {
        ...input,
        messageIdMapping,
        conversationIdMapping,
      };

      await this.streamSummarization(res, inputWithMapping, context, {
        type: 'channel',
        channelId,
        channelName: channel.name,
        messageCount: channelMessages.length,
        participants: users.map((u) => ({ id: u.id, name: u.name, email: u.email })),
        dateFrom: dateFrom as string | undefined,
        dateTo: dateTo as string | undefined,
        messageIdMapping: messageIdMappingObj,
        conversationIdMapping: conversationIdMappingObj,
      });

    } catch (error) {
      this.handleError(res, error, 'channel summarization');
    }
  };

/**
 * Summarize search results based on user query with streaming
 * Takes search query and list of messages with metadata
 * 
 * POST /api/summarize/searchMessage
 * 
 * Body params:
 * - searchQuery: string (required) - the user's search query
 * - messages: array (required) - array of message objects with:
 *   - title: string (channel name)
 *   - subtitle: string (sender name)
 *   - context: string (message content)
 *   - timestamp: string (ISO date string)
 *   - messageId: string - the message ID
 *   - conversationId: string - the conversation ID
 *   - senderId: string - the sender's user ID
 */
summarizeSearchMessage = async (req: Request, res: Response): Promise<void> => {
  const { searchQuery, messages } = req.body;

  if (!searchQuery || !Array.isArray(messages)) {
    res.status(400).json({
      error: 'Missing required params: searchQuery (string) and messages (array) are required',
    });
    return;
  }

  // Validate message structure - now messageId and conversationId are required
  const isValidMessages = messages.every(
    (msg) => msg.title && msg.subtitle && msg.context && msg.timestamp && msg.messageId && msg.conversationId
  );

  if (!isValidMessages) {
    res.status(400).json({
      error: 'Invalid message format: Each message must have title, subtitle, context, timestamp, messageId, and conversationId',
    });
    return;
  }

  // Get user ID from auth context
  const userId = (req as any).user?.id || 'anonymous';
  const agentsConfig = await AgentsConfig.fetch({ email: (req as any).user?.email });

  try {
    logger.info(`Summarizing ${messages.length} search results for query: "${searchQuery}"`);

    if (messages.length === 0) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      res.write(
        `data: ${JSON.stringify({
          type: 'no_messages',
          message: 'No messages found for the search query',
        })}\n\n`
      );
      res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
      res.end();
      return;
    }

    // Convert search messages to the expected format
    const searchMessages = messages.map(msg => ({
        id: msg.messageId,
        conversationId: msg.conversationId,
        content: msg.context,
        authorName: msg.subtitle,
        senderId: msg.senderId,
        channelName: msg.title,
        createdAt: new Date(msg.timestamp),
        hasAttachment: false,
    }));

    const input: ThreadSummaryInput = {
      messages: searchMessages,
    };

    const context: SummarizerContext = {
      userId,
      conversationId: '', // Not tied to a specific conversation
      channelId: '', // Not tied to a specific channel
      summarizationType: 'searchMessage',
      searchQuery, // Include search query in context
      modelName: agentsConfig.summariserModelName,
    };

    // Create message index to ID and conversationId mapping for citations (1-based index)
    const messageIdMappingObj: { [index: number]: string } = {};
    const conversationIdMappingObj: { [index: number]: string } = {};
    const messageIdMapping = new Map<number, string>();
    const conversationIdMapping = new Map<number, string>();

    searchMessages.forEach((msg, idx) => {
      messageIdMappingObj[idx + 1] = msg.id;
      conversationIdMappingObj[idx + 1] = msg.conversationId;
      messageIdMapping.set(idx + 1, msg.id);
      conversationIdMapping.set(idx + 1, msg.conversationId);
    });

    // Add mapping to input for the agent
    const inputWithMapping: ThreadSummaryInput = {
      ...input,
      messageIdMapping,
      conversationIdMapping,
    };

    // Get unique participants from messages using senderId
    const uniqueSenderMap = new Map();
    searchMessages.forEach((msg) => {
      if (!uniqueSenderMap.has(msg.senderId)) {
        uniqueSenderMap.set(msg.senderId, {
          id: msg.senderId,
          name: msg.authorName,
          email: null,
        });
      }
    });
    const participants = Array.from(uniqueSenderMap.values());

    // Get date range from messages
    const timestamps = searchMessages.map((m) => m.createdAt.getTime());
    const dateFrom = new Date(Math.min(...timestamps)).toISOString();
    const dateTo = new Date(Math.max(...timestamps)).toISOString();

    // Stream the response
    await this.streamSummarization(res, inputWithMapping, context, {
      type: 'searchMessage',
      searchQuery,
      messageCount: searchMessages.length,
      participants,
      dateFrom,
      dateTo,
      messageIdMapping: messageIdMappingObj,
      conversationIdMapping: conversationIdMappingObj,
    });

  } catch (error) {
    this.handleError(res, error, 'search message summarization');
  }
};

  /**
   * Helper method to stream summarization response
   * Uses appropriate stream function based on type (thread vs channel)
   */
  private sendCachedSummary(res: Response, cachedData: { output: Record<string, any> }): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Content-Encoding', 'none');
    if (res.socket) res.socket.setNoDelay(true);
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ type: 'start' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'complete', output: cachedData.output })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
    res.end();
  }

  private async streamSummarization(
    res: Response,
    input: ThreadSummaryInput,
    context: SummarizerContext,
    metadata: Record<string, any>,
    cacheKey?: string,
    emailCount?: number
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Content-Encoding', 'none');
    
    if (res.socket) res.socket.setNoDelay(true);
    res.flushHeaders();

    logger.info(`Starting ${metadata.type} summarization stream`);

    const startEvent = {
      type: 'start',
      messageCount: metadata.messageCount ?? 0,
      participantCount: metadata.participants?.length ?? 0,
      dateFrom: metadata.dateFrom,
      dateTo: metadata.dateTo,
      messageIdMapping: metadata.messageIdMapping,
      conversationIdMapping: metadata.conversationIdMapping,
    };
    
    res.write(`data: ${JSON.stringify(startEvent)}\n\n`);
    if (typeof (res as any).flush === 'function') (res as any).flush();

    const streamGenerator = summarizeStream(input, context);

    for await (const chunk of streamGenerator) {
      let eventData: string;
      
      if (chunk.type === 'complete') {
        const completeData: Record<string, any> = { ...chunk };
        if (metadata.conversationIdMapping) completeData.conversationIdMapping = metadata.conversationIdMapping;
        if (metadata.messageIdMapping) completeData.messageIdMapping = metadata.messageIdMapping;
        if (completeData.output) {
          completeData.output = {
            ...completeData.output,
            messageCount: completeData.output.messageCount || metadata.messageCount || 0,
            participantCount: completeData.output.participantCount || metadata.participants?.length || 0,
          };
        }
        eventData = JSON.stringify(completeData);

        if (cacheKey && completeData.output) {
          const cacheValue = JSON.stringify({ output: completeData.output, emailCount, cachedAt: Date.now() });
          redisService.set(cacheKey, cacheValue, EMAIL_SUMMARY_CACHE_TTL).catch((err) => {
            logger.warn(`Failed to cache email summary for ${cacheKey}:`, err);
          });
        }
      } else {
        eventData = JSON.stringify(chunk);
      }

      res.write(`data: ${eventData}\n\n`);
      if (typeof (res as any).flush === 'function') (res as any).flush();

      if (chunk.type === 'complete' || chunk.type === 'error') break;
    }

    res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
    res.end();
    logger.info(`${metadata.type} summarization stream completed`);
  }

  private handleError(res: Response, error: unknown, operation: string): void {
    logger.error(`Error in ${operation}:`, error);

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    } else {
      const errorChunk: StreamChunk = {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
      res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
      res.end();
    }
  }
}
