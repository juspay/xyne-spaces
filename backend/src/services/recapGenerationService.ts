import { db } from '../database/client';
import { logger } from '../utils/logger';
import { redisService } from './redisService';
import { stripHtml } from '../agents/xyne-ai/tools/helpers';
import {
  summarizeThread,
  type ThreadSummaryInput,
  type SummarizerContext,
  type SummaryOutput,
  type EnhancedEntityMetadata,
} from '../agents/summariser';
import { calculateUnreadCount } from '../utils/recapUtils';

interface RecapSummary {
  points: Array<{
    text: string;
    messageId?: string; // Resolved message ID for direct linking
    conversationId?: string; // Resolved conversation ID for navigation
    citationIndex?: number; // The source entity index returned by the agent (for display)
  }>;
  messageCount: number;
}

/**
 * Get the start and end of day for a given date in IST
 * @param date - The date in IST
 * @returns Object with startOfDay (00:00:00) and endOfDay (23:59:59.999) in IST
 */
function getDateRangeInTimezone(date: Date): { startOfDay: Date; endOfDay: Date } {
  // Create date strings in IST timezone
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD format

  // Parse as UTC to get the correct IST boundaries
  // IST is UTC+5:30, so we need to offset by 5:30 hours
  const startOfDay = new Date(`${dateStr}T00:00:00+05:30`);
  const endOfDay = new Date(`${dateStr}T23:59:59.999+05:30`);

  return { startOfDay, endOfDay };
}

interface ChannelRecapResult {
  channelId: string;
  success: boolean;
  error?: string;
  summary?: RecapSummary;
}

/**
 * Recap Generation Service
 *
 * Uses the summarizer agent to generate recaps for channels.
 * Recaps are generated daily by the scheduler and stored in the database.
 */
export class RecapGenerationService {
  /**
   * Convert SummaryOutput to RecapSummary format with enhanced citation metadata
   */
  private convertToRecapSummary(output: SummaryOutput): RecapSummary {
    // Like ask AI: embed resolved IDs directly per point — no separate lookup table needed
    const points = output.keyPoints.map((kp) => ({
      text: kp.point,
      messageId: kp.citation.messageId || undefined,
      conversationId: kp.citation.conversationId || undefined,
      citationIndex: kp.citation.messageIndex,
    }));

    return {
      points,
      messageCount: output.messageCount,
    };
  }

  /**
   * Generate recaps for all subscribed channels for a given date
   */
  async generateRecapsForDate(targetDate: Date): Promise<{
    totalChannels: number;
    successful: number;
    failed: number;
    results: ChannelRecapResult[];
  }> {
    const istDate = targetDate.toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    logger.info(`Starting recap generation for date: ${istDate} (IST)`);

    // Step 1: Get all subscribed channels
    const subscribedChannels = await this.getSubscribedChannels();
    logger.info(`Found ${subscribedChannels.length} subscribed channels`);

    // Step 2: Process each channel
    const results: ChannelRecapResult[] = [];
    const failedChannels: string[] = [];

    for (const channelId of subscribedChannels) {
      try {
        const result = await this.generateRecapForChannel(channelId, targetDate);
        results.push(result);

        if (!result.success) {
          failedChannels.push(channelId);
        }
      } catch (error) {
        logger.error(`Unexpected error processing channel ${channelId}:`, error);
        results.push({
          channelId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        failedChannels.push(channelId);
      }
    }

    // Step 3: Retry failed channels once
    if (failedChannels.length > 0) {
      logger.info(`Retrying ${failedChannels.length} failed channels`);

      for (const channelId of failedChannels) {
        try {
          const result = await this.generateRecapForChannel(channelId, targetDate);

          // Update the result in the array
          const existingIndex = results.findIndex((r) => r.channelId === channelId);
          if (existingIndex !== -1) {
            results[existingIndex] = result;
          }
        } catch (error) {
          logger.error(`Retry failed for channel ${channelId}:`, error);
        }
      }
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    logger.info(`Recap generation complete: ${successful} successful, ${failed} failed`);

    // Broadcast unread count updates to subscribed users
    await this.broadcastUnreadCountUpdates(subscribedChannels);

    return {
      totalChannels: subscribedChannels.length,
      successful,
      failed,
      results,
    };
  }

  /**
   * Broadcast unread count updates to users subscribed to recap channels
   * Uses Redis pub/sub to communicate with the main API server's WebSocket service
   */
  private async broadcastUnreadCountUpdates(channelIds: string[]): Promise<void> {
    try {
      // Get all users subscribed to these channels
      const subscriptions = await db.channelUserStatus.findMany({
        where: {
          channelId: { in: channelIds },
          isRecapSubscribed: true,
        },
        select: {
          userId: true,
        },
        distinct: ['userId'],
      });

      const userIds = subscriptions.map((s) => s.userId);
      logger.info(`Broadcasting unread count updates to ${userIds.length} subscribed users`);

      // Broadcast to each user via Redis pub/sub
      // The main API server will receive this and emit via WebSocket to connected clients
      for (const userId of userIds) {
        const unreadCount = await calculateUnreadCount(userId);
        await redisService.broadcastUserEvent(userId, {
          type: 'recap_unread_count_updated',
          userId,
          data: { count: unreadCount },
          timestamp: new Date(),
        });
      }
    } catch (error) {
      logger.error('Error broadcasting unread count updates:', error);
    }
  }

  /**
   * Get all subscribed channels that exist and have DEFAULT scopeType
   */
  private async getSubscribedChannels(): Promise<string[]> {
    const subscriptions = await db.channelUserStatus.findMany({
      where: {
        isRecapSubscribed: true,
      },
      select: {
        channelId: true,
      },
      distinct: ['channelId'],
    });

    const channelIds = subscriptions.map((s) => s.channelId);

    // Filter to only existing channels with DEFAULT scopeType
    const channels = await db.channel.findMany({
      where: {
        id: { in: channelIds },
        scopeType: 'DEFAULT',
      },
      select: {
        id: true,
      },
    });

    return channels.map((c) => c.id);
  }

  /**
   * Generate recap for a single channel (non-streaming)
   */
  private async generateRecapForChannel(
    channelId: string,
    targetDate: Date
  ): Promise<ChannelRecapResult> {
    logger.info(`Generating recap for channel: ${channelId}`);

    // Calculate message window using IST timezone
    // This ensures recaps are based on IST day boundaries
    const { startOfDay, endOfDay } = getDateRangeInTimezone(targetDate);

    // Get channel info
    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: { id: true, name: true },
    });

    const channelName = channel?.name || channelId;

    try {
      // Fetch entities for the channel
      const { messages, entityMapping } = await this.fetchChannelEntitiesForRecap(
        channelId,
        channelName,
        startOfDay,
        endOfDay
      );

      if (messages.length === 0) {
        const istDate = targetDate.toLocaleDateString('en-IN', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
        logger.info(`[Recap] No messages found for channel ${channelId} on ${istDate} (IST)`);
        return {
          channelId,
          success: true,
          summary: { points: [], messageCount: 0 },
        };
      }

      // Generate summary using summarizer agent
      const input: ThreadSummaryInput = {
        messages,
        entityMapping,
      };

      const context: SummarizerContext = {
        userId: 'recap-system',
        conversationId: '',
        channelId,
        summarizationType: 'recap',
      };

      const output = await summarizeThread(input, context);
      const summary = this.convertToRecapSummary(output);

      // Persist recap and broadcast to subscribers
      await this.persistRecap(channelId, targetDate, summary);

      // Broadcast recap generation event to subscribed users for real-time updates
      await this.broadcastRecapGenerated(channelId, targetDate);

      return {
        channelId,
        success: true,
        summary,
      };
    } catch (error) {
      logger.error(`Failed to generate recap for channel ${channelId}:`, error);
      return {
        channelId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Broadcast recap generation event to subscribed users for real-time updates
   * Uses Redis pub/sub to communicate with the main API server's WebSocket service
   */
  private async broadcastRecapGenerated(channelId: string, recapDate: Date): Promise<void> {
    try {
      // Get all users subscribed to this channel
      const subscriptions = await db.channelUserStatus.findMany({
        where: { channelId, isRecapSubscribed: true },
        select: { userId: true },
      });

      const userIds = subscriptions.map((s) => s.userId);

      if (userIds.length === 0) {
        return;
      }

      logger.info(
        `Broadcasting recap generated event to ${userIds.length} subscribed users for channel ${channelId}`
      );

      // Broadcast to each user via Redis pub/sub
      // The main API server will receive this and emit via WebSocket to connected clients
      for (const userId of userIds) {
        const istDate = recapDate.toLocaleDateString('en-IN', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
        await redisService.broadcastUserEvent(userId, {
          type: 'recap_generated',
          userId,
          data: {
            channelId,
            date: istDate,
          },
          timestamp: new Date(),
        });
      }
    } catch (error) {
      logger.error('Error broadcasting recap generated event:', error);
    }
  }

  /**
   * Persist recap to database
   */
  private async persistRecap(
    channelId: string,
    recapDate: Date,
    summary: RecapSummary
  ): Promise<void> {
    const summaryData = JSON.stringify(summary);

    // Normalize date to midnight UTC to ensure consistent storage
    // Get the date string in IST timezone
    const dateStr = recapDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    // Store at midnight UTC so PostgreSQL DATE extraction gets the correct calendar day
    // Example: 2026-02-19T00:00:00Z stores as 2026-02-19 in database
    const normalizedDate = new Date(`${dateStr}T00:00:00Z`);

    // Display IST date directly
    const istDisplayDate = normalizedDate.toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    logger.info(`Persisted recap for channel ${channelId} on ${istDisplayDate} (IST)`);

    await db.channelDailyRecap.upsert({
      where: {
        channelId_recapDate: {
          channelId,
          recapDate: normalizedDate,
        },
      },
      update: {
        summary: summaryData,
      },
      create: {
        channelId,
        recapDate: normalizedDate,
        summary: summaryData,
      },
    });
  }

  /**
   * Fetch channel entities for recap with enhanced entity support
   * Fetches messages, attachments, canvases, calls, and tickets for comprehensive citations
   * Optimized to avoid N+1 queries by fetching all messages in a single query
   */
  private async fetchChannelEntitiesForRecap(
    channelId: string,
    channelName: string,
    startOfDay: Date,
    endOfDay: Date
  ): Promise<{
    messages: any[];
    entityMapping: Map<number, EnhancedEntityMetadata>;
    channelId: string;
    channelName: string;
  }> {
    logger.info(
      `[Recap] Fetching entities for channel ${channelId} from ${startOfDay.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' })} to ${endOfDay.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' })}`
    );

    // Get all conversations from the channel
    const conversations = await db.conversation.findMany({
      where: { channelId },
      select: { conversationId: true, channelId: true },
    });

    const conversationIds = conversations.map((c) => c.conversationId);

    if (conversationIds.length === 0) {
      return {
        messages: [],
        entityMapping: new Map(),
        channelId,
        channelName,
      };
    }

    // Fetch all messages for all conversations in a single query (avoids N+1)
    const allMessages = await db.message.findMany({
      where: {
        conversationId: { in: conversationIds },
        isDeleted: false,
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Fetch attachments for these conversations
    const attachments = await db.messageAttachment.findMany({
      where: {
        conversationId: { in: conversationIds },
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
      select: {
        id: true,
        conversationId: true,
        originalFilename: true,
        mimetype: true,
        createdAt: true,
        url: true,
      },
    });

    // Fetch canvases created in this channel during the date range
    const canvases = await db.canvas.findMany({
      where: {
        channelId: channelId,
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        docType: true,
      },
    });

    // Fetch calls in this channel during the date range
    const calls = await db.call.findMany({
      where: {
        channelId: channelId,
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
      select: {
        id: true,
        title: true,
        callType: true,
        status: true,
        createdAt: true,
      },
    });

    // Fetch tickets linked to this channel during the date range
    const tickets = await db.ticket.findMany({
      where: {
        channelId: channelId,
        createdAt: { gte: startOfDay, lte: endOfDay },
      },
      select: {
        id: true,
        title: true,
        status: true,
        xyneId: true,
        createdAt: true,
      },
    });

    // Collect all unique user IDs
    const allUserIds = new Set<string>(allMessages.map((m) => m.senderId));
    const users = await db.user.findMany({
      where: { id: { in: Array.from(allUserIds) } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Transform messages to ThreadMessage format
    const threadMessages: any[] = allMessages.map((msg) => {
      const user = userMap.get(msg.senderId);
      return {
        id: msg.messageId,
        content: stripHtml(msg.content),
        authorName: user?.name || user?.email || 'Unknown User',
        createdAt: msg.createdAt,
        hasAttachment: msg.hasAttachment,
      };
    });

    // Add tickets as synthetic messages for summarization
    for (const ticket of tickets) {
      const ticketUser = userMap.get(ticket.xyneId);
      threadMessages.push({
        id: `ticket-${ticket.id}`,
        content: `🎫 Ticket created: ${ticket.title}\nStatus: ${ticket.status}\nTicket ID: ${ticket.id}`,
        authorName: ticketUser?.name || ticketUser?.email || 'System',
        createdAt: ticket.createdAt,
        hasAttachment: false,
        entityType: 'ticket',
      });
    }

    // Add canvases as synthetic messages for summarization
    for (const canvas of canvases) {
      threadMessages.push({
        id: `canvas-${canvas.id}`,
        content: `📄 Canvas created: ${canvas.title}\nType: ${canvas.docType}\nCanvas ID: ${canvas.id}`,
        authorName: 'System',
        createdAt: canvas.createdAt,
        hasAttachment: false,
        entityType: 'canvas',
      });
    }

    // Add calls as synthetic messages for summarization
    for (const call of calls) {
      threadMessages.push({
        id: `call-${call.id}`,
        content: `📞 Call started: ${call.title}\nType: ${call.callType}\nStatus: ${call.status}\nCall ID: ${call.id}`,
        authorName: 'System',
        createdAt: call.createdAt,
        hasAttachment: false,
        entityType: 'call',
      });
    }

    // Sort all items chronologically (oldest first for summarizer)
    threadMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Build enhanced entity mapping
    const entityMapping = new Map<number, EnhancedEntityMetadata>();
    let entityIndex = 1;

    // Add messages to entity mapping
    for (const msg of threadMessages) {
      const originalMsg = allMessages.find((m) => m.messageId === msg.id);
      entityMapping.set(entityIndex++, {
        entityType: 'message',
        entityId: msg.id,
        messageId: msg.id,
        conversationId: originalMsg?.conversationId,
        channelId: channelId,
      });
    }

    // Add attachments to entity mapping
    for (const att of attachments) {
      entityMapping.set(entityIndex++, {
        entityType: 'attachment',
        entityId: att.id,
        conversationId: att.conversationId ?? undefined,
        channelId: channelId,
      });
    }

    // Add canvases to entity mapping
    for (const canvas of canvases) {
      entityMapping.set(entityIndex++, {
        entityType: 'canvas',
        entityId: canvas.id,
        canvasId: canvas.id,
        channelId: channelId,
      });
    }

    // Add calls to entity mapping
    for (const call of calls) {
      entityMapping.set(entityIndex++, {
        entityType: 'call',
        entityId: call.id,
        callId: call.id,
        channelId: channelId,
      });
    }

    // Add tickets to entity mapping
    for (const ticket of tickets) {
      entityMapping.set(entityIndex++, {
        entityType: 'ticket',
        entityId: ticket.id,
        ticketId: ticket.id,
        channelId: channelId,
      });
    }

    logger.info(
      `[Recap] Fetched ${threadMessages.length} messages, ${attachments.length} attachments, ${canvases.length} canvases, ${calls.length} calls, ${tickets.length} tickets for channel ${channelId}`
    );

    return {
      messages: threadMessages,
      entityMapping,
      channelId,
      channelName,
    };
  }
}

export const recapGenerationService = new RecapGenerationService();
