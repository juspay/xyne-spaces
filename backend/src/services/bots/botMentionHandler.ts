import { logger } from '@/utils/logger';
import { executionOrchestrator } from '@/bots/unified/orchestrator/execution-orchestrator';
import { typingService } from '@/services/typingService';
import { botCatalog } from '@/bots/unified/catalog/bot-catalog';
import { extractUserMentions } from '@/utils/mentionParser';
import { db } from '@/database/client';
import { UserType } from '@prisma/client';
import type { BotDefinition } from '@/bots/unified/types/unified-bot';

export interface BotMentionInfo {
  botUserId: string;
  botId: string;
  botDefinition: BotDefinition;
}

/**
 * Parse @mentioned user IDs from HTML content, filter to BOT users,
 * and resolve each to its bot catalog entry via DB user id.
 */
export async function extractBotMentions(content: string): Promise<BotMentionInfo[]> {
  const mentions = extractUserMentions(content);
  if (mentions.length === 0) return [];

  const users = await db.user.findMany({
    where: { id: { in: mentions }, userType: UserType.BOT },
    select: { id: true },
  });

  const botMentions: BotMentionInfo[] = [];
  for (const user of users) {
    const botEntry = botCatalog.getAll().find(
      e => botCatalog.getDbUserId(e.definition.id) === user.id
    );
    if (botEntry) {
      botMentions.push({
        botUserId: user.id,
        botId: botEntry.definition.id,
        botDefinition: botEntry.definition,
      });
    }
  }
  return botMentions;
}

export interface BotMentionExecutionParams {
  bot: { botUserId: string; botId: string; botDefinition: BotDefinition };
  message: { messageId: string; senderId: string; content: string; conversationId: string };
  conversation: { channelId: string; initialMessageId: string | null };
  question: string;
  sender: { name: string; userType?: string } | null;
  channelParticipants: Array<{ userId: string; user: { email: string; name: string } }>;
}

/**
 * Execute a bot in response to an @mention or thread reply.
 * Handles typing indicator lifecycle, orchestrator invocation, and stream draining.
 * Mirrors the pattern used in conversationController → botProcessor.
 */
export async function executeBotForMention({
  bot,
  message,
  conversation,
  question,
  sender,
  channelParticipants,
}: BotMentionExecutionParams): Promise<void> {
  const { botUserId, botId, botDefinition } = bot;

  const botTypingUser = {
    userId: botUserId,
    userName: botDefinition.name,
    userEmail: botDefinition.email,
  };

  const typingUsers = await typingService.startTypingInConversation(
    message.conversationId,
    botTypingUser
  );
  await typingService.broadcastTypingUpdate(
    message.conversationId,
    typingUsers,
    false,
    'typing_start'
  );

  try {
    const senderEmail = channelParticipants.find(p => p.userId === message.senderId)?.user.email;
    const result = await executionOrchestrator.execute({
      botId: botDefinition.id,
      message: question,
      channelId: conversation.channelId,
      conversationId: message.conversationId,
      userMessageId: message.messageId,
      userId: message.senderId,
      userName: sender?.name,
      userEmail: senderEmail,
      sessionId: message.conversationId,
    });

    if (result.stream) {
      for await (const event of result.stream) {
        if (event.type === 'error') {
          logger.error('[BOT-MENTION] Bot error event', {
            botId,
            messageId: message.messageId,
            error: event.error,
          });
        }
      }
    }
  } catch (botExecutionError) {
    logger.error('[BOT-MENTION] Bot execution failed', {
      botId,
      messageId: message.messageId,
      error: botExecutionError instanceof Error ? botExecutionError.message : String(botExecutionError),
    });
  } finally {
    const remainingTypingUsers = await typingService.stopTypingInConversation(
      message.conversationId,
      botUserId
    );
    await typingService.broadcastTypingUpdate(
      message.conversationId,
      remainingTypingUsers,
      false,
      'typing_stop'
    );
  }
}
