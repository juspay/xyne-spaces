
import { z } from 'zod';
import { MessageType } from '@xyne/shared';
import { Request, Response } from 'express';
import { Bot, UnifiedBaseBot } from '@/bots/unified/index.js';
import type { BotExecutionContext, InternalBotDefinition, BotEvent } from '@/bots/unified/types/index.js';
import { logger } from '@/utils/logger';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { ConversationService } from '@/services/conversationService';
import { MessageRepository } from '@/database/repositories/messageRepository';
import { ConversationRepository } from '@/database/repositories/conversationRepository';

import { unifiedBotUserService } from '@/bots/unified/index.js';
import { UserGroupRepository } from '@/database/repositories/userGroups';
import { MessagesSideEffectHandler } from '@/zero/side-effects/tables/messages-handler';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { UserRepository } from '@/database/repositories/users';
import {
  formatGroupMention,
  formatJenkinsAlertMessage,
  formatUserMention,
  type JenkinsWebhookPayload,
} from './alert-formatting';
import { prThreadNotificationService } from '@/services/prThreadNotificationService';
type QaAlertBotInput = { message: string };
type QaAlertBotOutput = { response: string };

const QaAlertBotInputSchema = z.object({
  message: z.string(),
});

const QaAlertBotOutputSchema: z.ZodType<QaAlertBotOutput> = z.object({
  response: z.string(),
});

@Bot({
  id: 'qa-alert',
  name: 'QA Alert Bot',
  email: 'qa-alert-bot@bot.xyne.ai',
  description: 'System bot for Jenkins CI/CD build alerts',
  inputSchema: QaAlertBotInputSchema,
  outputSchema: QaAlertBotOutputSchema,
  scope: 'all',
  interactionMode: 'execute',
})
export class QaAlertBot extends UnifiedBaseBot<QaAlertBotInput, QaAlertBotOutput> {
  protected readonly definition: InternalBotDefinition<QaAlertBotInput, QaAlertBotOutput> = {
    id: 'qa-alert',
    name: 'QA Alert Bot',
    email: 'qa-alert-bot@bot.xyne.ai',
    description: 'System bot for Jenkins CI/CD build alerts',
    runtimeType: 'internal',
    inputSchema: QaAlertBotInputSchema,
    outputSchema: QaAlertBotOutputSchema,
    scope: 'all',
  };

  private ticketRepository = new TicketRepository();
  private conversationService = new ConversationService();
  private userGroupRepository = new UserGroupRepository();
  private userRepository = new UserRepository();
  private messageRepository = new MessageRepository();
  private conversationRepository = new ConversationRepository();

  /**
   * Fetch complete context for bot user including workspaceId, role, and memberId
   */
  private async fetchBotContext(botUser: { id: string; email: string; workspaceId?: string | null; role?: string | null }): Promise<{ workspaceId: string; role: string; orgRole: string; memberId: string }> {
    const workspaceId = botUser.workspaceId ?? config.defaultWorkspaceId ?? '';
    if (!workspaceId) {
      throw new Error('QA Alert Bot has no workspace assigned');
    }
    
    // Email is globally unique in orgMember, single lookup is sufficient
    const orgMember = await db.orgMember.findUnique({
      where: { email: botUser.email },
    });
    if (!orgMember) {
      throw new Error(`QA Alert Bot is not a member of any organization`);
    }
    
    return {
      workspaceId,
      role: botUser.role ?? 'MEMBER',
      orgRole: orgMember.role,
      memberId: orgMember.memberId,
    };
  }


  protected async *executeInternal(
    _input: QaAlertBotInput,
    _context: BotExecutionContext
  ): AsyncGenerator<BotEvent> {
    
    yield this.createErrorEvent(
      'This bot does not accept commands. It is used internally for posting Jenkins CI/CD build alerts.',
    );
  }

  private async buildMentions(
    payload: JenkinsWebhookPayload,
    ticket: { workspaceId: string; createdBy: string | null },
  ): Promise<string[]> {
    const mentions: string[] = [];
    const seenMentions = new Set<string>();

    const addMention = (mention: string | null): void => {
      if (!mention || seenMentions.has(mention)) {
        return;
      }
      seenMentions.add(mention);
      mentions.push(mention);
    };

    if (!payload.alertCategory) {
      logger.warn('[QaAlertBot] No alertCategory in payload, no mentions will be generated');
      return mentions;
    }

    if (payload.alertCategory === 'automation_failed' || payload.alertCategory === 'automation_skipped') {
      const userGroupAlias = payload.userGroupAlias || 'qa-xyne';
      const userGroup = await this.userGroupRepository.findByAlias(userGroupAlias, ticket.workspaceId);
      if (userGroup) {
        const memberCount = await this.userGroupRepository.getUserCount(userGroup.id);
        addMention(formatGroupMention(userGroup.id, userGroup.name, userGroup.alias, memberCount));
      } else {
        logger.warn(`[QaAlertBot] Configured QA user group not found: ${userGroupAlias}`);
      }

      if (payload.alertCategory === 'automation_failed') {
        if (ticket.createdBy) {
          const ticketCreator = await this.userRepository.findById(ticket.createdBy);
          if (ticketCreator) {
            addMention(
              formatUserMention(ticketCreator.id, ticketCreator.name, {
                email: ticketCreator.email,
                picture: ticketCreator.picture,
              }),
            );
          }
        }
      }

      return mentions;
    }

    if (payload.alertCategory === 'non_automation_failed') {
      if (ticket.createdBy) {
        const ticketCreator = await this.userRepository.findById(ticket.createdBy);
        if (ticketCreator) {
          addMention(
            formatUserMention(ticketCreator.id, ticketCreator.name, {
              email: ticketCreator.email,
              picture: ticketCreator.picture,
            }),
          );
        }
      }
    }

    if (
      payload.alertCategory !== 'automation_failed' &&
      payload.alertCategory !== 'automation_skipped' &&
      payload.alertCategory !== 'non_automation_failed'
    ) {
      logger.warn(`[QaAlertBot] Unhandled alertCategory "${payload.alertCategory}", no mentions generated`);
    }

    return mentions;
  }

  /**
   * Push a Jenkins alert message to a ticket's conversation channel
   * @param payload - Jenkins webhook payload
   * @returns Success status and details
   */
  async pushMessageToChannel(payload: JenkinsWebhookPayload): Promise<{
    success: boolean;
    message: string;
    conversationId?: string;
  }> {
    const { ticketXyneId } = payload;

    if (!ticketXyneId) {
      logger.info('[QaAlertBot] No ticketXyneId provided, skipping conversation post');
      return { success: false, message: 'No ticketXyneId provided' };
    }

    try {
      const ticket = await this.ticketRepository.getTicketByXyneId(ticketXyneId, config.defaultWorkspaceId);

      if (!ticket) {
        logger.warn(`[QaAlertBot] Ticket not found for XyneId: ${ticketXyneId}`);
        return { success: false, message: `Ticket not found: ${ticketXyneId}` };
      }

      if (!ticket.conversationId) {
        logger.warn(`[QaAlertBot] Ticket ${ticketXyneId} has no conversationId`);
        return { success: false, message: `Ticket ${ticketXyneId} has no conversation` };
      }

      const qaAlertBot = await unifiedBotUserService.getBotByEmail('qa-alert-bot@bot.xyne.ai', ticket.workspaceId);

      if (!qaAlertBot) {
        logger.error('[QaAlertBot] QA Alert bot user not found');
        return { success: false, message: 'QA Alert bot user not found' };
      }

      payload.mentionHtmlList = await this.buildMentions(payload, {
        workspaceId: ticket.workspaceId,
        createdBy: ticket.createdBy,
      });

      const lastMessage = await this.messageRepository.findLastMessage({
        conversationId: ticket.conversationId,
        senderId: qaAlertBot.id,
      });

      // Fetch complete bot context
      const { workspaceId, role, orgRole, memberId } = await this.fetchBotContext(qaAlertBot);
      const handler = new MessagesSideEffectHandler({ userID: qaAlertBot.id, workspaceId, role, orgRole, memberId });

      if (lastMessage) {
        try {
          await this.messageRepository.delete(lastMessage.messageId);
    
          await this.conversationRepository.decrementReplyCount(ticket.conversationId).catch((err) => {
            logger.error(`[QaAlertBot] Failed to decrement reply count:`, err);
          });
          
         await handler
            .onDelete({
              entityId: lastMessage.messageId,
              entityType: 'messages',
              operation: 'delete',
            })
            
        } catch (err) {
          logger.error(`[QaAlertBot] Failed to delete message ${lastMessage.messageId}:`, err);
        }
      }

      const alertMessage = formatJenkinsAlertMessage(payload);

       const result = await this.conversationService.addMessageToConversation({
        conversationId: ticket.conversationId,
        userId: qaAlertBot.id,
        content: alertMessage,
        msgType: MessageType.BOT,
        isBot: true,
      });

      logger.info(
        `[QaAlertBot] Alert posted to ticket ${ticketXyneId} conversation ${ticket.conversationId}`
      );

      // Mirror the alert to channel threads where the ticket's PR link was
      // posted (pr_thread_links, e.g. -merge channels). Fire-and-forget.
      void this.broadcastAlertToPrThreads(payload, ticket, qaAlertBot.id, alertMessage);

      handler
        .onInsert({
          entityId: result.message.messageId,
          entityType: 'messages',
          operation: 'insert',
        })
        .catch((err) => logger.error('[QaAlertBot] Side-effect handler error:', err));

      return {
        success: true,
        message: `Alert posted to ticket ${ticketXyneId}`,
        conversationId: ticket.conversationId,
      };
    } catch (error) {
      logger.error('[QaAlertBot] Error posting alert to ticket conversation:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Mirror a Jenkins alert into channel threads subscribed to the ticket's
   * PR(s) via pr_thread_links. Uses the payload's prUrl when present,
   * otherwise the PRs linked to the ticket.
   *
   * Intentionally mirrors every alert category (failures and successes):
   * merge-channel threads track "is this PR safe to merge", so both signals
   * are relevant there.
   */
  private async broadcastAlertToPrThreads(
    payload: JenkinsWebhookPayload,
    ticket: { id: string; conversationId: string | null },
    senderId: string,
    alertMessage: string
  ): Promise<void> {
    try {
      let prUrls: string[];
      if (payload.prUrl) {
        prUrls = [payload.prUrl];
      } else {
        const prs = await db.pullRequests.findMany({
          where: { ticketId: ticket.id },
          select: { prUrl: true },
          distinct: ['prUrl'],
        });
        prUrls = prs.map(pr => pr.prUrl);
      }

      if (prUrls.length === 0) {
        logger.debug(`[QaAlertBot] No PRs linked to ticket ${ticket.id} — nothing to mirror`);
        return;
      }

      // Independent per-PR broadcasts — run concurrently. broadcastPRUpdate is
      // best-effort and handles its own errors, so allSettled just preserves that.
      await Promise.allSettled(
        prUrls.map(prUrl =>
          prThreadNotificationService.broadcastPRUpdate({
            prUrl,
            content: alertMessage,
            senderId,
            excludeConversationId: ticket.conversationId ?? undefined,
            metadata: { activityType: 'JENKINS_ALERT', prUrl },
          })
        )
      );
    } catch (error) {
      logger.error('[QaAlertBot] Failed to broadcast alert to PR threads:', error);
    }
  }
}


export const qaAlertBot = new QaAlertBot();



/**
 * Express handler for Jenkins webhook alerts
 * Receives webhook from Jenkins and posts alert to ticket conversation
 */
export async function handleJenkinsWebhook(req: Request, res: Response): Promise<void> {
  try {
    logger.info('[JenkinsWebhook] Received webhook:', req.body);
    let payload: JenkinsWebhookPayload;

if (Buffer.isBuffer(req.body)) {
  payload = JSON.parse(req.body.toString('utf-8'));
} else if (typeof req.body === 'string') {
  payload = JSON.parse(req.body);
} else {
  payload = req.body;
}

   
    if (!payload) {
      logger.warn('[JenkinsWebhook] No payload received');
      res.status(400).json({ success: false, error: 'No payload provided' });
      return;
    }

    if (!payload.event) {
      logger.warn('[JenkinsWebhook] Missing event type in payload');
      res.status(400).json({ success: false, error: 'Missing event type' });
      return;
    }

    logger.info(`[JenkinsWebhook] Received ${payload.event} event for branch ${payload.branch}`);

    const result = await qaAlertBot.pushMessageToChannel(payload);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: result.message,
        conversationId: result.conversationId,
      });
    } else {
      logger.warn(`[JenkinsWebhook] Failed to post message: ${result.message}`);
      res.status(200).json({
        success: true,
        message: 'Webhook acknowledged but message not posted',
        reason: result.message,
      });
    }
  } catch (error) {
    logger.error('[JenkinsWebhook] Error handling webhook:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
