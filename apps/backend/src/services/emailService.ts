/**
 * Email Service
 * Handles email-related operations including creating conversations with emails
 * Similar to ConversationService but specifically for email handling
 */

import {
  ConversationRepository,
  CreateConversationInput,
} from '@/database/repositories/conversationRepository';
import { MessageRepository, CreateMessageInput } from '@/database/repositories/messageRepository';
import { EmailRepository } from '@/database/repositories/emailRepository';
import { syncTicketEmailCount } from '@/database/syncTicketEmailCount';
import {
  MessageAttachmentRepository,
  CreateMessageAttachmentInput,
} from '@/database/repositories/messageAttachmentRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { UserRepository } from '@/database/repositories/users';
import { BoardRepository } from '@/database/repositories/boardRepository';
import { EmailChannelPreferenceRepository } from '@/database/repositories/emailChannelPreferenceRepository';
import { DatabaseClient } from '@/database/client';
import { Prisma } from '@prisma/client';
import { adapterRegistry } from '@/integrations/core/adapterRegistry';
import { ChannelExternalSourceResolver } from '@/services/channelExternalSourceResolver';
import { websocketService } from './websocketService';
import { redisService } from './redisService';
import { isRegisteredBot, getBotInfo } from '@/bots/core/bot-utils';
import { PrismaClient } from '@prisma/client';
import { evaluateAssignmentRule } from '@/utils/assignmentEngine';
import { syncUserWorkload } from '@/utils/workloadUtils';
import { ticketAssignmentService, primaryUserIdOf } from '@/services/ticketAssignmentService';
import {
  BaseTicketType,
  type BoardMetadata,
  isDeskChannelType,
  EmailType,
  ChannelType,
  AttachmentEntityType,
  VespaOperationType,
  VespaInsertionStatus,
  MessageDirection,
  ExternalEntityType,
  TicketPriority,
  ActivityType,
  EmailMergeMode,
  NotificationType, AutoDraftStatus, AutoDraftMode } from '@xyne/shared';
import { UploadedFileResult } from './fileUploadService';
import { config } from '@/config/env';
import { vespaQueue } from '@/queues/vespaQueue';
import { ticketSchema, mailSchema } from '@/vespa/src/types';
import { logger } from '@/utils/logger';
import { resolveChannelDefaultBoard } from '@/utils/channelDefaultBoard';
import { messageMetadataService } from '@/services/messageMetadataService';
import { db } from '@/database/client';
import { currentWorkspaceId, withWorkspaceScope } from '@/database/tenant/context';
import { NAMESPACE } from '@/vespa/vespaConfig';
import { processMeetLinksFromEmail } from './meetLinkService';
import { repositories } from '@/database/repositories';
import { notificationService } from '@/services/notificationService';
import { TicketIdService } from './ticketIdService';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { generateDescription } from './agents/description-generator';
import { dispatchEmailEventForEmailId } from '@/apps/core/emailUtils';
import { normalizeRfcMessageId } from '@/utils/emailRfcMessageId';
import { TICKET_CREATED_EVENT } from '@/automations/triggers/ticket-created.trigger';
import { emitTicketUpdated } from '@/automations/triggers/ticket-updated.trigger';
import { eventRouter } from '@/automations/engine/event-router';
import { v4 as uuidv4 } from 'uuid';
import { marked } from 'marked';
import { findDuplicateEmailConversation } from '@/utils/vespaDuplicateDetector';
import { emailClassificationQueue } from '@/queues/emailClassificationQueue';
import { ticketDuplicateService } from '@/services/ticketDuplicateService';
import { tagGenerationPipeline } from '@/tags/pipeline';
import { DESK_EMAIL_SOURCE_TYPE, deskEmailConfigKey } from '@/tags';
import { buildDraftEmailClawTask } from '@/agents/xyne-ai/prompts/draft';
import { runClawAgent } from '@/services/clawAgentService';
import { convert as htmlToText } from 'html-to-text';
import type { UserInfo as AgentUserInfo } from '@/agents/xyne-ai/tools/types';
import { computeSlaDueDates } from '@/utils/slaCalculator';
import {
  hasExternalInteractionEmailChanged,
  hasExternalInteractionTicketChanged,
} from '@/services/externalInteractionUpdate';
import type { TicketLike } from '@/automations/triggers/ticket-context';

export function stripCitationBlock(text: string): string {
  if (!text) return text;
  return text.replace(/\s*<citation\b[^>]*>([\s\S]*?)<\/citation>\s*/gi, '');
}

export const CLF_TOKEN_RE = /([【[⟦])(clf-[A-Za-z0-9_.:-]+#\d+)([】\]⟧])/g;


interface UserInfo {
  id: string;
  name: string;
  email: string;
  picture?: string;
}

/**
 * App-desk source binding for an ingested message. When set, the ExternalMessage
 * link row binding (externalSourceId, externalId) → Email is written inside the
 * same DB transaction as the Email write, so a crash cannot leave an Email
 * without the link that per-source thread continuation and reply routing rely on.
 */
export interface ExternalSourceLink {
  externalSourceId: string;
  externalId: string;
  externalThreadId: string;
}

export interface CreateConversationWithEmailParams {
  channelId: string;
  boardId?: string; // @deprecated - Target board for ticket creation. Now fetched from EmailChannelPreference table. Kept for backward compatibility.
  userId: string;
  emailSubject: string;
  emailBody: string;
  emailTo: string[];
  emailFrom: string;
  emailCc?: string[];
  emailBcc?: string[];
  emailReplyTo?: string[];
  externalThreadId: string;
  externalMessageId: string;
  externalSourceId?: string;
  rfcMessageId?: string | null;
  ticketMetadata?: Record<string, unknown>;
  uploadedFiles?: UploadedFileResult[];
  receivedAt?: Date;
  // Type of the initial email row. Defaults to DEFAULT (inbound thread root).
  // Outbound-new flows (compose / apps email-ticket creation) pass COMPOSE.
  emailType?: EmailType;
  // User who sent this email, for outbound-new flows. Null/undefined for inbound.
  sentByUserId?: string;
  rating?: number;
  clientVersionName?: string;
  clientVersionCode?: string;
}

export interface AddEmailToConversationParams {
  conversationId: string;
  emailSubject: string;
  emailBody: string;
  emailTo: string[];
  emailFrom: string;
  emailCc?: string[];
  emailBcc?: string[];
  emailReplyTo?: string[];
  externalThreadId: string;
  externalMessageId: string;
  externalSourceId?: string;
  rfcMessageId?: string | null;
  emailType?: EmailType;
  sentByUserId?: string;
  rating?: number;
  clientVersionName?: string;
  clientVersionCode?: string;
  uploadedFiles?: UploadedFileResult[];
  receivedAt?: Date;
}

export interface UpdateExternalInteractionParams {
  emailId: string;
  subject: string;
  body: string;
  from: string;
  externalThreadId: string;
  externalMessageId: string;
  type: EmailType;
  sentByUserId?: string | null;
  rating?: number | null;
  clientVersionName?: string | null;
  clientVersionCode?: string | null;
  syncTicket?: boolean;
  updatedBy?: string | null;
}

export interface CreateConversationFromEmailParams {
  channelId: string;
  userId: string;
  emailSubject: string;
  emailBody: string;
  emailTo: string[];
  emailFrom: string;
  emailCc?: string[];
  emailBcc?: string[];
  externalThreadId: string;
  externalMessageId: string;
  rfcMessageId?: string | null;
  projectId: string;
  boardId: string;
  stageName: string;
  userGroupId?: string;
  ticketMetadata?: Record<string, unknown>;
}

export interface IngestEmailThreadParams {
  channelId: string;
  externalThreadId: string;
  externalSourceId: string;
  userId: string;
  emails: Array<{
    externalMessageId: string;
    rfcMessageId?: string | null;
    subject: string;
    body: string;
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    replyTo?: string[];
    receivedAt: Date;
    type?: EmailType;
    uploadedFiles?: UploadedFileResult[];
  }>;
  ticketMetadata?: Record<string, unknown>;
  referencedMessageIds?: string[];
}

export interface IngestEmailThreadResult {
  conversationId: string;
  ticketId?: string;
  ticketXyneId?: string;
  inserted: number;
  duplicates: number;
  isNew: boolean;
  blocked?: boolean;
  wasVespaMerge?: boolean;
}

interface ThreadTxResult {
  conversationId: string;
  ticketId?: string;
  ticketXyneId?: string;
  inserted: number;
  duplicates: number;
  isNew: boolean;
  wasVespaMerge?: boolean;
  insertedEmailIds: string[];
}

const SUBJECT_PREFIX_REGEX = /^(\s*(re|fwd|fw)\s*:\s*)+/i;

function derivePriorityFromSubject(subject: string): TicketPriority {
  const normalizedSubject = (subject || '').replace(SUBJECT_PREFIX_REGEX, '').toLowerCase();

  if (/\b(critical|sev0|p0)\b/.test(normalizedSubject)) {
    return TicketPriority.CRITICAL;
  }

  if (/\b(urgent|high|sev1|p1)\b/.test(normalizedSubject)) {
    return TicketPriority.HIGH;
  }

  if (/\b(medium|normal|sev2|p2)\b/.test(normalizedSubject)) {
    return TicketPriority.MEDIUM;
  }

  return TicketPriority.LOW;
}

/**
 * Write the ExternalMessage link row inside an existing transaction.
 *
 * The (externalSourceId, externalId) pair being already linked means the same
 * app re-posted an id it already linked — that is a no-op, not an error.
 * `createMany` + `skipDuplicates` covers the concurrent-repost race without
 * raising P2002, which would poison the surrounding interactive transaction.
 */
async function linkExternalMessageInTx(
  tx: Prisma.TransactionClient,
  link: ExternalSourceLink,
  emailId: string,
  workspaceId: string,
): Promise<void> {
  const existing = await tx.externalMessage.findUnique({
    where: {
      externalSourceId_externalId: {
        externalSourceId: link.externalSourceId,
        externalId: link.externalId,
      },
    },
    select: { id: true },
  });
  if (existing) {
    logger.warn('[EmailService] ExternalMessage link already exists, skipping', {
      externalSourceId: link.externalSourceId,
      externalId: link.externalId,
      emailId,
    });
    return;
  }
  await tx.externalMessage.createMany({
    data: [{
      externalSourceId: link.externalSourceId,
      externalId: link.externalId,
      externalThreadId: link.externalThreadId,
      messageId: emailId,
      entityId: emailId,
      direction: MessageDirection.INCOMING,
      entityType: ExternalEntityType.EMAIL,
      workspaceId,
    }],
    skipDuplicates: true,
  });
}

export class EmailService {
  private conversationRepository: ConversationRepository;
  private messageRepository: MessageRepository;
  private emailRepository: EmailRepository;
  private messageAttachmentRepository: MessageAttachmentRepository;
  private channelRepository: ChannelRepository;
  private userRepository: UserRepository;
  private boardRepository: BoardRepository;
  private emailChannelPreferenceRepository: EmailChannelPreferenceRepository;
  private prisma: PrismaClient;

  constructor() {
    this.conversationRepository = new ConversationRepository();
    this.messageRepository = new MessageRepository();
    this.emailRepository = new EmailRepository();
    this.messageAttachmentRepository = new MessageAttachmentRepository();
    this.channelRepository = new ChannelRepository();
    this.userRepository = new UserRepository();
    this.boardRepository = new BoardRepository();
    this.emailChannelPreferenceRepository = new EmailChannelPreferenceRepository();
    this.prisma = DatabaseClient.getInstance();
  }

  /**
   * Looks up the active SLA policy for (boardId, priority) and returns the
   * computed resolution deadline to store in `eta`, but only when the board
   * has `slaPolicyType === 'priority'` in its metadata.
   *
   * The response deadline is intentionally NOT stored — it is derived at
   * runtime from the policy config.  Returns null when:
   *   - boardId is null/undefined
   *   - the board's slaPolicyType is not 'priority'
   *   - no active policy exists for this board+priority combination
   *   - any lookup/computation error occurs
   */
  private async getSlaResolutionDue(
    boardId: string | null | undefined,
    priority: TicketPriority,
    receivedAt: Date,
  ): Promise<Date | null> {
    if (!boardId) return null;
    try {
      // Only apply priority-based SLA when the board has explicitly opted in.
      const board = await this.prisma.board.findUnique({
        where: { id: boardId },
        select: { metadata: true },
      });
      const metadata = board?.metadata as { slaPolicyType?: string } | null;
      if (metadata?.slaPolicyType !== 'priority') return null;

      const policy = await this.prisma.boardSlaPolicy.findUnique({
        where: { boardId_priority: { boardId, priority } },
        select: {
          responseHours: true,
          resolutionHours: true,
          businessHoursOnly: true,
          timezone: true,
          workdayStart: true,
          workdayEnd: true,
          isActive: true,
        },
      });
      if (!policy || !policy.isActive) return null;
      const { slaResolutionDue } = computeSlaDueDates(receivedAt, policy);
      return slaResolutionDue;
    } catch (err) {
      logger.warn('[EmailService] Failed to compute SLA resolution due date:', err);
      return null;
    }
  }

  /**
   * Get user info - checks bot registry first, then user table
   * Similar to ConversationService.getUserInfo
   */
  async getUserInfo(userId: string): Promise<UserInfo> {
    // Check if this is a registered bot
    if (isRegisteredBot(userId)) {
      const botInfo = getBotInfo(userId);
      if (botInfo) {
        return botInfo;
      }
    }

    try {
      const user = await this.userRepository.findById(userId);
      if (user) {
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          picture: user.picture || undefined,
        };
      }
    } catch (error) {
      logger.warn(`Failed to lookup user ${userId}:`, error);
    }

    return {
      id: userId,
      name: 'User',
      email: 'user@example.com',
      picture: undefined,
    };
  }
  private async pushVespaJobForMail(
    emailId: string,
    userId: string,
    workspaceId?: string
  ): Promise<void> {
    vespaQueue.addJob({
      schema: mailSchema,
      jobType: 'feed',
      docId: emailId,
      ...(workspaceId ? { workspaceId } : {}),
    }).catch(async (error) => {
      logger.error('[EmailService] Error queuing Vespa job for mail:', error);
      try {
        const vespaLogs = db.vespaInsertionLogs;
        if (vespaLogs) {
          const ws = workspaceId ?? currentWorkspaceId();
          if (!ws) throw new Error('workspaceId required: no tenant context');
          await vespaLogs.create({
            data: {
              status: VespaInsertionStatus.FAILED,
              type: VespaOperationType.INSERT,
              entityId: emailId,
              entityType: mailSchema,
              namespace: NAMESPACE,
              workspaceId: ws,
              errorMessage: `Failed to enqueue Vespa mail job: ${error instanceof Error ? error.message : String(error)}`,
              errorDetails: JSON.stringify(error),
              userId: userId,
              createdAt: new Date(),
            },
          });
        }
      } catch (dbError) {
        logger.error('[EmailService] Failed to log Vespa mail insertion error to database:', dbError);
      }
    });
  }

  private async pushVespaJobForTicket(
    ticketId: string,
    userId: string,
    workspaceId?: string
  ): Promise<void> {
    vespaQueue.addJob({
      schema: ticketSchema,
      jobType: "feed",
      docId: ticketId,
      ...(workspaceId ? { workspaceId } : {}),
    }).catch(async (error) => {
      logger.error('[EmailService] Error queuing Vespa job for ticket:', error);
      try {
        const vespaLogs = db.vespaInsertionLogs;
        if (vespaLogs) {
          const ws = workspaceId ?? currentWorkspaceId();
          if (!ws) throw new Error('workspaceId required: no tenant context');
          await vespaLogs.create({
            data: {
              status: VespaInsertionStatus.FAILED,
              type: VespaOperationType.INSERT,
              entityId: ticketId,
              entityType: ticketSchema,
              namespace: NAMESPACE,
              workspaceId: ws,
              errorMessage: `Failed to enqueue Vespa job: ${error instanceof Error ? error.message : String(error)}`,
              errorDetails: JSON.stringify(error),
              userId: userId,
              createdAt: new Date(),
            },
          });
        }
      } catch (dbError) {
        logger.error('[EmailService] Failed to log Vespa insertion error to database:', dbError);
      }
    });
  }

  async updateExternalInteraction(
    params: UpdateExternalInteractionParams,
  ) {
    const currentEmail = await this.prisma.email.findUnique({
      where: { id: params.emailId },
    });
    if (!currentEmail) throw new Error(`Email ${params.emailId} not found`);

    const currentTicket = params.syncTicket
      ? await this.prisma.ticket.findFirst({
          where: { conversationId: currentEmail.conversationId },
        })
      : null;

    const emailChanged = hasExternalInteractionEmailChanged(currentEmail, {
      subject: params.subject,
      body: params.body,
      from: params.from,
      externalThreadId: params.externalThreadId,
      externalMessageId: params.externalMessageId,
      type: params.type,
      sentByUserId: params.sentByUserId ?? null,
      rating: params.rating ?? null,
      clientVersionName: params.clientVersionName ?? null,
      clientVersionCode: params.clientVersionCode ?? null,
    });
    const ticketChanged = hasExternalInteractionTicketChanged(currentTicket, {
      title: params.subject,
      description: params.body,
    });

    if (!emailChanged && !ticketChanged) return currentEmail;

    const result = await this.prisma.$transaction(async (tx) => {
      const email = emailChanged
        ? await tx.email.update({
            where: { id: params.emailId },
            data: {
              subject: params.subject,
              body: params.body,
              from: params.from,
              externalThreadId: params.externalThreadId,
              externalMessageId: params.externalMessageId,
              type: params.type,
              sentByUserId: params.sentByUserId,
              rating: params.rating,
              clientVersionName: params.clientVersionName,
              clientVersionCode: params.clientVersionCode,
            },
          })
        : currentEmail;

      if (!currentTicket || !ticketChanged) return { email, ticket: null };

      const ticket = await tx.ticket.update({
        where: { id: currentTicket.id },
        data: {
          title: params.subject,
          description: params.body,
          ...(params.updatedBy && { updatedBy: params.updatedBy }),
        },
      });
      await syncConversationTicketMdFromPrismaTicket(tx, ticket);
      return { email, ticket };
    });

    if (emailChanged) {
      this.pushVespaJobForMail(
        result.email.id,
        params.updatedBy ?? currentTicket?.updatedBy ?? currentEmail.from,
        currentEmail.workspaceId ?? undefined,
      ).catch((error) => {
        logger.error('[EmailService] Failed to reindex updated external interaction', {
          emailId: result.email.id,
          error,
        });
      });
    }

    if (result.ticket && currentTicket) {
      this.pushVespaJobForTicket(
        result.ticket.id,
        params.updatedBy ?? currentTicket.updatedBy,
        result.ticket.workspaceId,
      ).catch((error) => {
        logger.error('[EmailService] Failed to reindex updated external ticket', {
          ticketId: result.ticket!.id,
          error,
        });
      });
      void messageMetadataService
        .syncInitialMessageMd(result.ticket.conversationId)
        .catch((error) => {
          logger.warn('[EmailService] Failed to sync edited external ticket metadata', {
            ticketId: result.ticket!.id,
            error,
          });
        });
      void emitTicketUpdated({
        ticket: result.ticket as TicketLike,
        changes: {
          ...(currentTicket.title !== result.ticket.title && {
            title: {
              previousValue: currentTicket.title,
              newValue: result.ticket.title,
            },
          }),
          ...(currentTicket.description !== result.ticket.description && {
            description: {
              previousValue: currentTicket.description,
              newValue: result.ticket.description,
            },
          }),
        },
        performedById: params.updatedBy ?? null,
      });
    }

    return result.email;
  }

  /**
   * Fire-and-forget: run the description-generator on the email body and update
   * the ticket's description column when it resolves. Never throws. Ticket row
   * stays with the raw body if the AI call fails or times out, so webhook
   * ingestion is never blocked by AI availability.
   */
  private async enrichTicketDescription(params: {
    ticketId: string;
    emailBody: string;
    emailSubject: string;
    userId: string;
    channelId: string;
  }): Promise<void> {
    const { ticketId, emailBody, emailSubject, userId, channelId } = params;
    let updatedTicket;
    try {
      const result = await generateDescription(
        { rawContext: emailBody, title: emailSubject },
        { userId, channelId },
      );

      if (!result.description || result.description.trim().length === 0) return;

      updatedTicket = await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { description: result.description, updatedBy: userId },
      });

      // Re-index so search reflects the cleaned description.
      this.pushVespaJobForTicket(ticketId, userId).catch((error) => {
        // Swallowing this leaves search permanently stale for the ticket.
        logger.error('ticket_vespa_reindex_failed', { ticketId, userId, error });
      });
      logger.info(`[EmailService] Ticket description enriched`, { ticketId });
    } catch (error) {
      logger.warn('[EmailService] Ticket description enrichment failed — keeping raw body', {
        ticketId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return;
    }

    // Description is now persisted. Refresh the denormalised markdown
    // projections so the UI / AI consumers see the enriched version instead of
    // the raw email body. Failures here don't roll back the description — they
    // just leave the md stale, which will self-heal on the next ticket update.
    try {
      await syncConversationTicketMdFromPrismaTicket(this.prisma, updatedTicket);
      if (updatedTicket.conversationId) {
        await messageMetadataService.syncInitialMessageMd(updatedTicket.conversationId);
      }
    } catch (error) {
      logger.warn('[EmailService] Ticket description enriched but md sync failed', {
        ticketId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async notifyAssigneeOfReply(params: {
    ticketId: string;
    conversationId: string;
    channelId: string;
    workspaceId: string | undefined;
    emailSubject: string;
    emailFrom: string;
    emailId: string;
  }): Promise<void> {
    const { ticketId, conversationId, channelId, workspaceId, emailSubject, emailFrom, emailId } =
      params;

    try {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { assignedTo: true, xyneId: true },
      });
      const assignedTo = ticket?.assignedTo;
      if (!assignedTo) return;

      // Resolve assignedTo to concrete recipient user ids.
      let recipientIds: string[];
      if (assignedTo.startsWith('group:')) {
        const groupId = assignedTo.slice('group:'.length);
        const group = await repositories.userGroups.findWithMappings(groupId);
        recipientIds = (group?.userGroupMappings ?? [])
          .map(m => m.user?.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
      } else {
        recipientIds = [assignedTo.replace(/^user:/, '')];
      }

      // Skip the sender: don't notify an assignee about a reply they sent.
      const senderUser = await this.prisma.user.findFirst({
        where: { email: emailFrom },
        select: { id: true },
      });
      if (senderUser) {
        recipientIds = recipientIds.filter(id => id !== senderUser.id);
      }
      if (recipientIds.length === 0) {
        return;
      }

      const actionUrl = ticket?.xyneId
        ? `/${workspaceId ?? ''}/support/${channelId}/${ticket.xyneId}`
        : `/${workspaceId ?? ''}/support/${channelId}`;

      await Promise.all(
        recipientIds.map(userId =>
          notificationService.createNotification(userId, {
            type: NotificationType.EMAIL_REPLY_RECEIVED,
            title: 'New reply on your ticket',
            message: `${emailFrom}: ${emailSubject}`,
            relatedEntityType: 'ticket',
            relatedEntityId: ticketId,
            actionUrl,
            metadata: { conversationId, emailId, from: emailFrom },
          }),
        ),
      );
    } catch (error) {
      logger.error('[EmailService] Failed to notify assignee of reply', {
        ticketId,
        conversationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async triggerAutoDraft(params: {
    ticketId: string;
    conversationId: string;
    channelId: string;
    emailSubject: string;
    emailBody: string;
  }): Promise<void> {
    const { ticketId, conversationId, channelId, emailSubject, emailBody } = params;
    const startTime = Date.now();

    logger.info('[AutoDraft] start', {
      mode: 'autodraft',
      ticketId,
      conversationId,
      channelId,
      subjectLen: emailSubject?.length ?? 0,
      bodyLen: emailBody?.length ?? 0,
    });

    const preference = await this.emailChannelPreferenceRepository.findByChannelId(channelId);
    if (preference?.autoDraftMode !== AutoDraftMode.DRAFT) {
      logger.info('[AutoDraft] skip: auto-draft not enabled for channel', {
        mode: 'autodraft',
        ticketId,
        channelId,
        autoDraftMode: preference?.autoDraftMode ?? 'unset',
        durationMs: Date.now() - startTime,
      });
      return;
    }

    const personaUserId = preference.ownerUserId;
    if (!personaUserId) {
      logger.info('[AutoDraft] skip: no desk owner configured', {
        mode: 'autodraft',
        ticketId,
        channelId,
        durationMs: Date.now() - startTime,
      });
      return;
    }

    const persona = await this.userRepository.findById(personaUserId);
    if (!persona?.email) {
      logger.warn('[AutoDraft] skip: desk owner has no email', {
        mode: 'autodraft',
        ticketId,
        channelId,
        ownerUserId: personaUserId,
        durationMs: Date.now() - startTime,
      });
      return;
    }

    const userInfo: AgentUserInfo = {
      userId: persona.id,
      userName: persona.name || 'Support',
      userEmail: persona.email,
    };

    const signatureCount = await this.prisma.emailSignature.count({
      where: { userId: personaUserId },
    });
    
    const hasDeskSignature = signatureCount > 0;
    const autoDraftAgentSlug = preference.autoDraftAgentSlug?.trim() || null;
    const workspaceId = await this.channelRepository.getWorkspaceId(channelId);

    const streamStart = Date.now();
    logger.info('[AutoDraft] stream invoke', {
      mode: 'autodraft',
      ticketId,
      conversationId,
      channelId,
      hasDeskSignature,
      agentSlug: autoDraftAgentSlug ?? 'default',
    });

    await this.setAutoDraftGenerating(conversationId, channelId);

    try {
      const effectiveAgentSlug = autoDraftAgentSlug ?? 'draft-agent';
      const latestBodyText = htmlToText(emailBody || '', { wordwrap: false }).trim() || emailBody;
      const clawTask = buildDraftEmailClawTask({
        userInfo,
        hasDeskSignature,
        emailSubject,
        emailBody: latestBodyText,
        conversationId,
      });
      const callbackUrl = `${config.backendUrl.replace(/\/$/, '')}/api/internal/email/autodraft-callback/${encodeURIComponent(conversationId)}/${encodeURIComponent(channelId)}`;
      const { dispatched } = await runClawAgent({
        agentSlug: effectiveAgentSlug,
        task: clawTask,
        userId: personaUserId,
        userName: userInfo.userName,
        conversationId,
        channelId,
        workspaceId,
        resultForwardUrl: callbackUrl,
      });
      if (!dispatched) {
        logger.warn('[AutoDraft] no installed-app webhook for agent — skipping', {
          mode: 'autodraft',
          ticketId,
          conversationId,
          agentSlug: effectiveAgentSlug,
        });
        await this.clearAutoDraftGenerating(conversationId);
        return;
      }
      logger.info('[AutoDraft] claw agent fired via APP_MENTIONED (awaiting callback)', {
        mode: 'autodraft',
        ticketId,
        conversationId,
        agentSlug: effectiveAgentSlug,
        fireDurationMs: Date.now() - streamStart,
      });
      return;
    } catch (error) {
      logger.warn('[AutoDraft] s2s run failed', {
        mode: 'autodraft',
        ticketId,
        agentSlug: autoDraftAgentSlug ?? 'default',
        streamDurationMs: Date.now() - streamStart,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.clearAutoDraftGenerating(conversationId);
      return;
    }
  }

  /**
   * Public wrapper for re-triggering autodraft generation on an existing ticket.
   * Used by the per-channel AI retrigger endpoint to fill in missing drafts on
   * older tickets that pre-date the feature being enabled. Resolves the latest
   * inbound email on the ticket's conversation and delegates to triggerAutoDraft.
   * No-ops when ticket / email / autodraft config is missing.
   */
  async retriggerAutoDraftForTicket(ticketId: string): Promise<boolean> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, conversationId: true, channelId: true },
    });
    if (!ticket) return false;

    const email = await this.prisma.email.findFirst({
      where: { conversationId: ticket.conversationId },
      orderBy: { createdAt: 'desc' },
      select: { subject: true, body: true },
    });
    if (!email) return false;

    await this.triggerAutoDraft({
      ticketId: ticket.id,
      conversationId: ticket.conversationId,
      channelId: ticket.channelId,
      emailSubject: email.subject ?? '',
      emailBody: email.body ?? '',
    });
    return true;
  }

  private async setAutoDraftGenerating(conversationId: string, channelId: string): Promise<void> {
    try {
      // The seed row has no owner, so it runs above the caller's own scope.
      await withWorkspaceScope(async () => {
        const existingSeed = await this.prisma.emailDraft.findFirst({
          where: { conversationId, userId: null },
          select: { id: true },
        });
        if (existingSeed) {
          await this.prisma.emailDraft.update({
            where: { id: existingSeed.id },
            data: { autoDraftStatus: AutoDraftStatus.GENERATING, updatedAt: new Date() },
          });
        } else {
          const workspaceId = await this.channelRepository.getWorkspaceId(channelId);
          await this.prisma.emailDraft.create({
            data: {
              conversationId,
              channelId,
              workspaceId,
              userId: null,
              draftContent: '',
              autoDraftStatus: AutoDraftStatus.GENERATING,
            },
          });
        }
      });
    } catch (error) {
      logger.warn('[AutoDraft] failed to mark GENERATING', {
        mode: 'autodraft',
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async clearAutoDraftGenerating(conversationId: string): Promise<void> {
    try {
      // The seed row is ownerless, so it is resolved above the caller's own scope.
      await withWorkspaceScope(async () => {
        const seed = await this.prisma.emailDraft.findFirst({
          where: { conversationId, userId: null, autoDraftStatus: AutoDraftStatus.GENERATING },
          select: { id: true, draftContent: true },
        });
        if (!seed) return;
        if (!seed.draftContent || !seed.draftContent.trim()) {
          await this.prisma.emailDraft.delete({ where: { id: seed.id } });
        } else {
          await this.prisma.emailDraft.update({
            where: { id: seed.id },
            data: { autoDraftStatus: AutoDraftStatus.READY },
          });
        }
      });
    } catch (error) {
      logger.warn('[AutoDraft] failed to clear GENERATING', {
        mode: 'autodraft',
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async persistAutoDraft(params: {
    conversationId: string;
    channelId: string;
    summary: string;
    ticketId?: string;
    sessionId?: string;
    /**
     * Whether `sessionId` refers to a local workflowExecution row that should be
     * tagged as the autodraft session. True only for the inline xyneAIStream
     * path. The Claw webhook path passes a claw-auth sessionId that does NOT
     * live in our DB, so tagging is skipped to avoid a doomed update.
     */
    tagSession?: boolean;
  }): Promise<void> {
    const { conversationId, channelId, summary, ticketId, sessionId, tagSession } = params;

    if (!summary.trim()) {
      logger.warn('[AutoDraft] skip persist: empty summary', {
        mode: 'autodraft',
        ticketId,
        conversationId,
        sessionId,
      });
      await this.clearAutoDraftGenerating(conversationId);
      return;
    }

    const cleanedSummary = stripCitationBlock(summary).replace(CLF_TOKEN_RE, '');
    const html = await marked.parse(cleanedSummary);
    const now = new Date();
    try {
      const existingSeed = await this.prisma.emailDraft.findFirst({
        where: { conversationId, userId: null },
        select: { id: true },
      });
      if (existingSeed) {
        await this.prisma.emailDraft.update({
          where: { id: existingSeed.id },
          data: { draftContent: html, channelId, autoDraftStatus: AutoDraftStatus.READY, updatedAt: now },
        });
      } else {
        const workspaceId = await this.channelRepository.getWorkspaceId(channelId);
        await this.prisma.emailDraft.create({
          data: {
            conversationId,
            channelId,
            workspaceId,
            userId: null,
            draftContent: html,
            autoDraftStatus: AutoDraftStatus.READY,
          },
        });
      }
      logger.info('[AutoDraft] draft persisted', {
        mode: 'autodraft',
        ticketId,
        conversationId,
        sessionId,
        htmlLen: html.length,
      });
    } catch (error) {
      logger.error('[AutoDraft] persist failed', {
        mode: 'autodraft',
        ticketId,
        conversationId,
        sessionId,
        error: error,
      });
      return;
    }

    if (sessionId && tagSession) {
      try {
        await this.prisma.workflowExecution.update({
          where: { id: sessionId },
          data: { tag: 'autodraft' },
        });
        logger.info('[AutoDraft] session tagged', {
          mode: 'autodraft',
          ticketId,
          sessionId,
        });
      } catch (error) {
        logger.warn('[AutoDraft] session tagging failed', {
          mode: 'autodraft',
          ticketId,
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    logger.info('[AutoDraft] done', {
      mode: 'autodraft',
      ticketId,
      conversationId,
      sessionId,
      summaryLen: summary.length,
    });
  }

  /**
   * Private utility function to create attachment entries for email
   */
  private async createEmailAttachments(
    emailId: string,
    conversationId: string,
    userId: string,
    workspaceId: string,
    uploadedFiles: UploadedFileResult[]
  ): Promise<void> {
    if (!uploadedFiles || uploadedFiles.length === 0) {
      return;
    }

    const attachmentData: CreateMessageAttachmentInput[] = uploadedFiles.map((file) => ({
      entityId: emailId,
      entityType: AttachmentEntityType.EMAIL,
      originalFilename: file.originalName,
      size: file.fileSize,
      mimetype: file.mimeType,
      url: file.fileUrl,
      thumbnailUrl: file.thumbnailUrl,
      width: file.width,
      height: file.height,
      uploadedByUserId: userId,
      createdBy: userId,
      storageProvider: config.fileStorage.provider,
      conversationId: conversationId,
      workspaceId: workspaceId,
      metadata: file.metadata || {},
    }));

    await this.messageAttachmentRepository.createMany(attachmentData);
  }

  /**
   * Create new conversation with empty message, ticket, and email entry.
   * Creates conversation first, then ticket, then message.
   * Ensures channel type is set to EMAIL and broadcasts the new conversation.
   */
  async createConversationWithEmail(params: CreateConversationWithEmailParams) {
    const {
      channelId,
      boardId: passedBoardId, // boardId passed from ExternalSource
      userId,
      emailSubject,
      emailBody,
      emailTo,
      emailFrom,
      emailCc = [],
      emailBcc = [],
      emailReplyTo = [],
      externalThreadId,
      externalMessageId,
      externalSourceId,
      rfcMessageId,
      ticketMetadata,
      uploadedFiles = [],
      receivedAt,
      emailType = EmailType.DEFAULT,
      sentByUserId,
      rating,
      clientVersionName,
      clientVersionCode,
    } = params;
    const normalizedRfcMessageId = normalizeRfcMessageId(rfcMessageId);

    // Check if channel exists and get projectId
    const channel = await this.channelRepository.findById(channelId);
    if (!channel) {
      throw new Error('Channel not found');
    }

    // If channel type is not a desk type, set it to EMAIL
    if (!isDeskChannelType(channel.type)) {
      await this.channelRepository.update(channelId, {
        type: ChannelType.EMAIL,
      });
    }

    // Fetch boardId from EmailChannelPreference table
    const emailChannelPreference = await this.emailChannelPreferenceRepository.findByChannelId(channelId);

    // Priority: passedBoardId (explicit, from request) > emailChannelPreference.boardId (admin default) > ChannelBoardMapping (isDefault or oldest)
    let configuredBoardId = passedBoardId || emailChannelPreference?.boardId;

    if (!configuredBoardId) {
      logger.warn(`[EmailService] EmailChannelPreference missing boardId for channel ${channelId}, falling back to ChannelBoardMapping`);
      const resolved = await resolveChannelDefaultBoard(this.prisma, channelId);
      configuredBoardId = resolved?.boardId;
    }

    if (!configuredBoardId) {
      logger.error(`[EmailService] No board found for channel ${channelId}`);
      throw new Error(`EmailChannelPreference must have a boardId configured. Channel: ${channelId}. Please configure boardId in email_channel_preferences table.`);
    }

    // Validate that the configured boardId exists
    const configuredBoard = await this.boardRepository.findById(configuredBoardId);
    if (!configuredBoard) {
      logger.error(`[EmailService] Configured boardId ${configuredBoardId} not found in database`);
      throw new Error(`Configured boardId ${configuredBoardId} not found in database. Please verify email_channel_preferences.boardId points to a valid board.`);
    }

    const projectId = configuredBoard.projectId;

    const boardId = configuredBoardId;
    logger.info(`[EmailService] Using configured boardId ${boardId} from EmailChannelPreference table`);

    // Validate that board has stages before creating conversation
    const stages = await this.prisma.stage.findMany({
      where: {
        boardId: boardId
      },
      orderBy: {
        sequenceNumber: 'asc'
      }
    });

    if (!stages || stages.length === 0) {
      throw new Error(`No stages found for board ${boardId}. Board must have at least one stage.`);
    }

    const firstStage = stages[0];

    // Get assignee user group from EmailChannelPreference (already fetched above)
    const groupId = emailChannelPreference?.assigneeUserGroupId;

    let userGroup = null;
    if (groupId) {
      userGroup = await this.prisma.userGroup.findUnique({
        where: { id: groupId },
        select: { id: true },
      });
    }

    // Derive ticket priority outside the transaction so we can look up the SLA policy.
    const ticketPriorityForSla = derivePriorityFromSubject(emailSubject ?? '');
    const slaResolutionDue = await this.getSlaResolutionDue(
      boardId,
      ticketPriorityForSla,
      receivedAt ?? new Date(),
    );

    // Outside the transaction on purpose: the allocator reaches a second database over its
    // own small pool, so allocating inside holds a main-DB connection while queueing there.
    const xyneId = await TicketIdService.generateTicketId(this.prisma, projectId);

    // Create conversation + email + ticket in a single transaction.
    // Email has @@unique on externalMessageId — if a duplicate notification arrives
    // concurrently, the transaction rolls back everything (no orphaned tickets).
    let txResult: { conversation: any; ticket: any; email: any };
    try {
      txResult = await this.prisma.$transaction(async (tx) => {
      // Create conversation
      const conv = await tx.conversation.create({
        data: {
          channelId,
          createdBy: userId,
          initialMessageId: 'temp',
          workspaceId: channel.workspaceId,
          ...(receivedAt && { createdAt: receivedAt, lastActivityAt: receivedAt }),
        },
      });

      // Create email FIRST — unique constraint on externalMessageId acts as dedup lock.
      // If this fails (P2002), the entire transaction rolls back.
      const createdEmail = await tx.email.create({
        data: {
          type: emailType,
          subject: emailSubject,
          body: emailBody,
          to: emailTo,
          from: emailFrom,
          cc: emailCc || [],
          bcc: emailBcc || [],
          replyTo: emailReplyTo || [],
          workspaceId: channel.workspaceId,
          conversationId: conv.conversationId,
          channelId,
          externalThreadId,
          externalMessageId,
          ...(sentByUserId && { sentByUserId }),
          ...(normalizedRfcMessageId && { rfcMessageId: normalizedRfcMessageId }),
          ...(rating != null && { rating }),
          ...(clientVersionName && { clientVersionName }),
          ...(clientVersionCode && { clientVersionCode }),
          ...(receivedAt && { createdAt: receivedAt }),
        } as Prisma.EmailUncheckedCreateInput,
      });

      // App-desk source link shares this transaction so it can't be lost to a crash.
      if (externalSourceId) {
        await linkExternalMessageInTx(tx, { externalId: externalMessageId, externalThreadId, externalSourceId }, createdEmail.id, channel.workspaceId);
      }

      const ticketTitle = (emailSubject ?? '').replace(SUBJECT_PREFIX_REGEX, '').trim() || emailSubject;
      const ticketPriority = derivePriorityFromSubject(emailSubject);
      const createdTicket = await tx.ticket.create({
        data: {
          title: ticketTitle,
          description: emailBody,
          createdBy: userId,
          updatedBy: userId,
          conversationId: conv.conversationId,
          channelId,
          xyneId,
          projectId,
          workspaceId: channel.workspaceId,
          boardId,
          emailCount: 1,
          lastEmailAt: receivedAt ?? new Date(),
          stageName: firstStage.name,
          priority: ticketPriority,
          ticketType: BaseTicketType.DESK,
          ...(slaResolutionDue && { eta: slaResolutionDue }),
          ...(userGroup && { userGroupId: groupId }),
          ...(ticketMetadata && { metadata: ticketMetadata as Prisma.InputJsonValue }),
          ...(receivedAt && { createdAt: receivedAt }),
        },
      });

      await syncConversationTicketMdFromPrismaTicket(tx, createdTicket);

      await tx.channelUserStatus.updateMany({
        where: { channelId, isDeleted: false },
        data: { unreadCount: { increment: 1 }, updatedAt: new Date() },
      });

      return { conversation: conv, ticket: createdTicket, email: createdEmail };
    }, { maxWait: 10_000, timeout: 30_000 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        await this.emailRepository.backfillRfcMessageIdByExternalMessageId(
          channelId,
          externalMessageId,
          normalizedRfcMessageId,
        );
        logger.warn(`[EmailService] Duplicate externalMessageId skipped: ${externalMessageId}`);
        return { isDuplicate: true };
      }
      throw err;
    }
    const { conversation, ticket, email } = txResult;

    // --- Side effects (outside transaction) ---

    // Direct DB insert bypasses Zero side-effects, so dispatch the EMAIL app event ourselves.
    void dispatchEmailEventForEmailId(email.id);

    void eventRouter.emit(
      { type: TICKET_CREATED_EVENT, payload: { ticketId: ticket.id } },
      ticket.workspaceId,
    ).catch((err: unknown) => logger.error(`[EmailService] TICKET_CREATED emit failed for ticket ${ticket.id}:`, err));

    if (ticket.userGroupId) {
      void emitTicketUpdated({
        ticket,
        changes: { userGroupId: { previousValue: null, newValue: ticket.userGroupId } },
        performedById: userId,
      });
    }

    this.pushVespaJobForTicket(ticket.id, userId, channel.workspaceId).catch(error => {
      logger.error(`[EmailService] Error pushing Vespa job for ticket ${ticket.id}:`, error);
    });

    // Ticket-creating mail only: DEFAULT (inbound) and COMPOSE (outbound-new).
    // Fire-and-forget — a failure leaves the ticket with no related tickets, no retry.
    if (emailType === EmailType.DEFAULT || emailType === EmailType.COMPOSE) {
      ticketDuplicateService.persistDuplicateReferences({
        ticketId: ticket.id,
        ticketCreatedBy: ticket.createdBy,
        title: ticket.title,
        description: ticket.description,
        projectId: ticket.projectId,
        userId,
      }).catch((error: unknown) => {
        logger.error('[EmailService] Failed to persist duplicate references for ticket', {
          ticketId: ticket.id,
          error,
        });
      });
    }

    // Enqueue AI classification as a Redis worker job
    await emailClassificationQueue.getQueue().add('classify', {
      ticketId: ticket.id,
      channelId,
      emailId: email.id,
      groupId: groupId ?? null,
    }).catch((err: unknown) => {
      logger.error(`[Classification] Failed to enqueue classification job for ticket ${ticket.id}`, err);
    });

    // Enqueue tag generation for this email (fire-and-forget — must not block ingestion).
    // Priority 1 (high) so live inbound emails are always processed before bulk historical fetches.
    if (config.enableTagGenerationPipeline) {
      void tagGenerationPipeline.addGenerationJob({
        sourceId: email.id,
        sourceType: DESK_EMAIL_SOURCE_TYPE,
        workspaceId: channel.workspaceId,
        configKey: deskEmailConfigKey(channelId),
      }, 2).then((jobId) => {
        logger.info(`[TagFramework] Enqueued tag generation job ${jobId} for email ${email.id}`);
      }).catch((err: unknown) => {
        logger.error(`[TagFramework] Failed to enqueue tag generation job for email ${email.id}`, err);
      });
    }

    // Fire-and-forget: enrich the ticket description via the AI agent. Never
    // blocks ingestion; ticket keeps the raw email body if this fails or times out.
    void this.enrichTicketDescription({
      ticketId: ticket.id,
      emailBody,
      emailSubject,
      userId,
      channelId,
    });

    void this.triggerAutoDraft({
      ticketId: ticket.id,
      conversationId: conversation.conversationId,
      channelId,
      emailSubject,
      emailBody,
    });

    // Create message with ticket
    const messageData: CreateMessageInput = {
      conversationId: conversation.conversationId,
      senderId: userId,
      content: '',
      hasAttachment: true,
      metadata: {
        ticketId: ticket.id,
      },
    };

    const message = await this.messageRepository.create(messageData);

    // Update conversation with real initial message ID
    await this.conversationRepository.update(conversation.conversationId, {
      initialMessageId: message.messageId,
      ticketId: ticket.id
    });
    await messageMetadataService.syncInitialMessageMd(conversation.conversationId);


    this.pushVespaJobForMail(email.id, userId, channel.workspaceId).catch(error => {
      logger.error(`[EmailService] Error pushing Vespa job for mail ${email.id}:`, error);
    });

    // Create MessageAttachment entries for email attachments
    await this.createEmailAttachments(email.id, conversation.conversationId, userId, channel.workspaceId, uploadedFiles);

    // Process Google Meet links from email body and send to SAM 
    try {
      const zohoTicketId = ticketMetadata?.ticketId as string | undefined;
      const meetResult = await processMeetLinksFromEmail(
        emailBody,
        ticket.xyneId,
        channel.workspaceId,
        externalThreadId,
        zohoTicketId
      );
      if (meetResult.processed > 0) {
        logger.info('[EmailService] Processed Google Meet links', {
          xyneTicketId: ticket.xyneId,
          meetCodes: meetResult.meetCodes,
          hasZohoTicketId: !!zohoTicketId,
        });
      }
    } catch (error) {
      // Don't fail email processing if meet link extraction fails
      logger.error('[EmailService] Failed to process meet links', {
        error: error instanceof Error ? error.message : 'Unknown error',
        xyneTicketId: ticket.xyneId,
      });
    }

    // Update channel last activity
      await this.channelRepository.updateLastActivity(channelId);

      // Get sender info
      const senderInfo = await this.getUserInfo(userId);

      // Broadcast new conversation via WebSocket
      const conversationMessage = {
        conversationId: conversation.conversationId,
        channelId,
        messageId: message.messageId,
        senderId: senderInfo.id,
        senderName: senderInfo.name,
        senderPicture: senderInfo.picture,
        content: message.content,
        msgType: message.msgType,
        hasAttachment: message.hasAttachment,
        attachments: [],
        createdAt: message.createdAt,
      };

      // Real-time broadcast via WebSocket
      await websocketService.broadcastToSession(channelId, 'new_conversation', conversationMessage);

    // Also broadcast via Redis for horizontal scaling
    await redisService.broadcastMessageToSession(channelId, conversationMessage);

    return {
      conversation,
      message,
      ticket,
      email,
      channel,
      senderInfo,
    };
  }

  /**
   * Add email entry to existing conversation
   * Just creates an email record, nothing else
   */
  async addEmailToConversation(params: AddEmailToConversationParams) {
    try {
      const {
        conversationId,
        emailSubject,
        emailBody,
        emailTo,
        emailFrom,
        emailCc = [],
        emailBcc = [],
        emailReplyTo = [],
        externalThreadId,
        externalMessageId,
        externalSourceId,
        rfcMessageId,
        emailType = EmailType.DEFAULT,
        sentByUserId,
        rating,
        clientVersionName,
        clientVersionCode,
        uploadedFiles = [],
        receivedAt,
      } = params;

      // Validate conversation exists
      const conversation = await this.conversationRepository.findById(conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }

      // Get channel and check if type is a desk type, if not set it to EMAIL
      const channel = await this.channelRepository.findById(conversation.channelId);
      if (channel && !isDeskChannelType(channel.type)) {
        await this.channelRepository.update(conversation.channelId, {
          type: ChannelType.EMAIL,
        });
      }

      // Create email entry
      const emailData = {
        type: emailType,
        subject: emailSubject,
        body: emailBody,
        to: emailTo,
        from: emailFrom,
        cc: emailCc,
        bcc: emailBcc,
        replyTo: emailReplyTo,
        conversationId: conversationId,
        channelId: conversation.channelId,
        externalThreadId: externalThreadId,
        externalMessageId: externalMessageId,
        rfcMessageId,
        sentByUserId,
        rating,
        clientVersionName,
        clientVersionCode,
        ...(receivedAt && { createdAt: receivedAt }),
      };

      // When an app-desk source link is requested, the Email upsert and the
      // link write share one transaction so neither can be lost on its own.
      const email = externalSourceId ? await this.prisma.$transaction(async (tx) => {
        const created = await this.emailRepository.create(emailData, tx);
        await linkExternalMessageInTx(tx, { externalId: externalMessageId, externalThreadId, externalSourceId }, created.id, created.workspaceId);
        return created;
      }, { maxWait: 10_000, timeout: 30_000 }) : await this.emailRepository.create(emailData);
      void this.channelRepository.updateLastActivity(conversation.channelId);

      // Direct DB insert bypasses Zero side-effects, so dispatch the EMAIL app event ourselves.
      void dispatchEmailEventForEmailId(email.id);

      const ticketRow = await this.prisma.ticket.findFirst({
        where: { conversationId },
        select: { id: true, lastEmailAt: true },
      });

      if (ticketRow) {
        if (receivedAt && receivedAt > ticketRow.lastEmailAt) {
          await this.prisma.ticket.update({
            where: { id: ticketRow.id },
            data: { lastEmailAt: receivedAt },
          });
        }

        await syncTicketEmailCount(this.prisma, conversationId);

        const previousLatest = await this.prisma.email.findFirst({
          where: { conversationId, id: { not: email.id } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });

        if (previousLatest) {
          const caughtUpUsers = await this.prisma.emailRead.findMany({
            where: {
              ticketId: ticketRow.id,
              lastReadEmailId: previousLatest.id,
            },
            select: { userId: true },
          });
          if (caughtUpUsers.length > 0) {
                  await withWorkspaceScope(() => this.prisma.channelUserStatus.updateMany({
              where: {
                channelId: conversation.channelId,
                userId: { in: caughtUpUsers.map(r => r.userId) },
                isDeleted: false,
              },
              data: { unreadCount: { increment: 1 }, updatedAt: new Date() },
            }));
          }

          void this.notifyAssigneeOfReply({
            ticketId: ticketRow.id,
            conversationId,
            channelId: conversation.channelId,
            workspaceId: channel?.workspaceId,
            emailSubject,
            emailFrom,
            emailId: email.id,
          });
        }

        this.pushVespaJobForTicket(
          ticketRow.id,
          conversation.createdBy,
          channel?.workspaceId,
        ).catch(error => {
          logger.error(`[EmailService] Error pushing Vespa job for ticket ${ticketRow.id}:`, error);
        });
      }

      this.pushVespaJobForMail(email.id, conversation.createdBy, channel?.workspaceId).catch(error => {
        logger.error(`[EmailService] Error pushing Vespa job for mail ${email.id}:`, error);
      });

      if (config.enableTagGenerationPipeline && channel?.workspaceId) {
        void tagGenerationPipeline.addGenerationJob({
          sourceId: email.id,
          sourceType: DESK_EMAIL_SOURCE_TYPE,
          workspaceId: channel.workspaceId,
          configKey: deskEmailConfigKey(conversation.channelId),
        }, 2).then((jobId) => {
          logger.info(`[TagFramework] Enqueued tag generation job ${jobId} for email ${email.id}`);
        }).catch((err: unknown) => {
          logger.error(`[TagFramework] Failed to enqueue tag generation for email ${email.id}`, err);
        });
      }

      // Create MessageAttachment entries for email attachments
      if (!channel?.workspaceId) {
        throw new Error(`workspaceId required: channel not found for email ${email.id} attachments`);
      }
      await this.createEmailAttachments(email.id, conversation.conversationId, conversation.createdBy, channel.workspaceId, uploadedFiles);

      if (ticketRow) {
        void this.triggerAutoDraft({
          ticketId: ticketRow.id,
          conversationId,
          channelId: conversation.channelId,
          emailSubject,
          emailBody,
        });
      }

      // Process Google Meet links from reply email body and send to SAM service
      try {
        // Get ticket associated with this conversation to get xyneTicketId, workspaceId, and zohoTicketId
        const ticket = await repositories.tickets.findByConversationIdForMeet(conversationId);

        if (ticket?.xyneId && ticket?.workspaceId) {
          // Extract zohoTicketId from ticket metadata (optional)
          const ticketMetadata = ticket.metadata as Record<string, unknown> | null;
          const zohoTicketId = ticketMetadata?.ticketId as string | undefined;
          
          const meetResult = await processMeetLinksFromEmail(
            emailBody,
            ticket.xyneId,
            ticket.workspaceId,
            externalThreadId,
            zohoTicketId
          );
          if (meetResult.processed > 0) {
            logger.info('[EmailService] Processed Google Meet links from reply', {
              xyneTicketId: ticket.xyneId,
              meetCodes: meetResult.meetCodes,
              hasZohoTicketId: !!zohoTicketId,
            });
          }
        }
      } catch (error) {
        // Don't fail email processing if meet link extraction fails
        logger.error('[EmailService] Failed to process meet links from reply', {
          error: error instanceof Error ? error.message : 'Unknown error',
          conversationId,
        });
      }

      return {
        email,
        conversation,
      };
    } catch (error) {
      logger.warn('Error in addEmailToConversation:', error);
      throw error;
    }
  }

  /**
   * Create new conversation and ticket from existing email data
   * Used for demerge operation to create a new ticket from a demerged email
   */
  async createConversationFromEmail(params: CreateConversationFromEmailParams) {
    const {
      channelId,
      userId,
      emailSubject,
      emailBody,
      projectId,
      boardId,
      stageName,
      userGroupId,
      ticketMetadata,
    } = params;

    // Check if channel exists
    const channel = await this.channelRepository.findById(channelId);
    if (!channel) {
      throw new Error('Channel not found');
    }

    // If channel type is not a desk type, set it to EMAIL
    if (!isDeskChannelType(channel.type)) {
      await this.channelRepository.update(channelId, {
        type: ChannelType.EMAIL,
      });
    }

    // Step 1: Create conversation
    const conversationData: CreateConversationInput = {
      channelId,
      createdBy: userId,
      initialMessageId: 'temp',
    };

    const conversation = await this.conversationRepository.create(conversationData);

    // Step 2: Create ticket in a transaction.
    // Derive priority + SLA deadline outside the transaction so a slow policy
    // lookup never holds an open DB transaction.
    const ticketPriority = derivePriorityFromSubject(emailSubject);
    const slaResolutionDue = await this.getSlaResolutionDue(boardId, ticketPriority, new Date());
    const ticket = await this.prisma.$transaction(async (tx) => {
      // Generate xyneId using project-scoped format
      const xyneId = await TicketIdService.generateTicketId(tx, projectId);

      return await tx.ticket.create({
        data: {
          title: emailSubject,
          description: emailBody,
          createdBy: userId,
          updatedBy: userId,
          conversationId: conversation.conversationId,
          channelId: channelId,
          xyneId: xyneId,
          projectId: projectId,
          workspaceId: channel.workspaceId,
          boardId: boardId,
          stageName: stageName,
          priority: ticketPriority,
          ticketType: BaseTicketType.DESK,
          ...(slaResolutionDue && { eta: slaResolutionDue }),
          ...(userGroupId && { userGroupId }),
          ...(ticketMetadata && { metadata: ticketMetadata as Prisma.InputJsonValue }),
          lastEmailAt: new Date(),
        }
      });
    });

    this.pushVespaJobForTicket(ticket.id, userId, channel.workspaceId).catch(error => {
      logger.error(`[EmailService] Error pushing Vespa job for ticket ${ticket.id}:`, error);
    });

    void eventRouter.emit(
      { type: TICKET_CREATED_EVENT, payload: { ticketId: ticket.id } },
      ticket.workspaceId,
    ).catch((err: unknown) => logger.error(`[EmailService] TICKET_CREATED emit failed for ticket ${ticket.id}:`, err));

    if (ticket.userGroupId) {
      void emitTicketUpdated({
        ticket: ticket as TicketLike,
        changes: { userGroupId: { previousValue: null, newValue: ticket.userGroupId } },
        performedById: userId,
      });
    }

    // Fire-and-forget enrichment — same pattern as createConversationWithEmail.
    void this.enrichTicketDescription({
      ticketId: ticket.id,
      emailBody,
      emailSubject,
      userId,
      channelId,
    });

    // Auto-assign ticket if userGroupId is provided
    if (userGroupId && boardId) {
      try {
        const boardRow = await this.prisma.board.findUnique({ where: { id: boardId }, select: { metadata: true } });
        const boardMetadata = boardRow?.metadata as BoardMetadata | undefined;

        if (
          (Array.isArray(boardMetadata?.assignmentRoles) && boardMetadata!.assignmentRoles!.length > 0)
          || boardMetadata?.fullRoleAssignment === true
        ) {
          const fullRoles = await ticketAssignmentService.assignFullRolesToTicket({
            ticketId: ticket.id,
            userGroupId,
            boardId,
            createdBy: userId,
            projectId: ticket.projectId,
            channelId,
          });
          const primaryUserId = primaryUserIdOf(fullRoles);
          if (primaryUserId) {
            const updatedTicket = await this.prisma.ticket.update({
              where: { id: ticket.id },
              data: { assignedTo: primaryUserId },
            });
            await syncConversationTicketMdFromPrismaTicket(this.prisma, updatedTicket);

            try {
              await syncUserWorkload(primaryUserId, userGroupId, boardId, userId);
              logger.info(`[EmailService] Synced workload for user ${primaryUserId}`);
            } catch (workloadError) {
              logger.error('[EmailService] Error syncing workload:', workloadError);
            }
          }
        } else {
        const assignmentResult = await evaluateAssignmentRule(userGroupId, boardId, undefined, undefined, ticket.projectId, channelId);
        if (assignmentResult.assignedUserId) {
          const updatedTicket = await this.prisma.ticket.update({
            where: { id: ticket.id },
            data: { assignedTo: assignmentResult.assignedUserId }
          });

          await syncConversationTicketMdFromPrismaTicket(this.prisma, updatedTicket);

          try {
            await syncUserWorkload(assignmentResult.assignedUserId, userGroupId, boardId, userId);
            logger.info(`[EmailService] Synced workload for user ${assignmentResult.assignedUserId}`);
          } catch (workloadError) {
            logger.error('[EmailService] Error syncing workload:', workloadError);
            }
          }
        }
      } catch (error) {
        logger.error('[EmailService] Auto-assignment failed:', error);
      }
    }

    // Step 3: Create message with ticket
    const messageData: CreateMessageInput = {
      conversationId: conversation.conversationId,
      senderId: userId,
      content: '',
      hasAttachment: true,
      metadata: {
        ticketId: ticket.id,
      },
    };

    const message = await this.messageRepository.create(messageData);

    // Update conversation with real initial message ID
    await this.conversationRepository.update(conversation.conversationId, {
      initialMessageId: message.messageId,
      ticketId: ticket.id
    });
    await messageMetadataService.syncInitialMessageMd(conversation.conversationId);

    //Update channel last activity
    await this.channelRepository.updateLastActivity(channelId);

    return {
      conversation,
      message,
      ticket,
      channel,
    };
  }

  /**
   * Records the timestamp of the first outbound agent reply on a ticket.
   *
   * Sets `firstRespondedAt` on every ticket linked to `conversationId` where
   * it is not yet set. The write is idempotent — subsequent replies are no-ops.
   *
   * This method is intentionally independent of any caller transaction: an SLA
   * tracking failure must never roll back or block the reply that triggered it.
   * Errors are logged at ERROR level and swallowed.
   */
  async recordFirstResponse(conversationId: string, respondedAt: Date): Promise<void> {
    try {
      await this.prisma.ticket.updateMany({
        where: { conversationId, firstRespondedAt: null },
        data: { firstRespondedAt: respondedAt },
      });
    } catch (err) {
      logger.error('[EmailService.recordFirstResponse] Failed to record first response time', {
        conversationId,
        respondedAt,
        err,
      });
    }
  }

  /**
   * Records an EMAIL_SENT activity on every ticket linked to `conversationId`
   * for a MANUAL agent send (reply / reply-all / compose). Automation sends
   * (sendReplyOnConversation) have no acting user and must not call this —
   * desk metrics and the audit trail count manual replies only.
   *
   * Like recordFirstResponse, this is independent of any caller transaction:
   * an audit-trail failure must never roll back or block the send itself.
   * Errors are logged and swallowed.
   */
  async recordEmailSentActivity(
    conversationId: string,
    emailId: string,
    emailType: EmailType,
    userId: string,
    sentAt: Date,
  ): Promise<void> {
    try {
      const tickets = await this.prisma.ticket.findMany({
        where: { conversationId },
        select: { id: true, channelId: true, workspaceId: true },
      });
      await this.prisma.ticketActivity.createMany({
        data: tickets.map(ticket => ({
          ticketId: ticket.id,
          updatedBy: userId,
          timestamp: sentAt,
          activityType: ActivityType.EMAIL_SENT,
          channelId: ticket.channelId,
          workspaceId: ticket.workspaceId,
          value: {
            field: 'emailSent',
            emailId,
            emailType,
          } as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
    } catch (err) {
      logger.error('[EmailService.recordEmailSentActivity] Failed to record email sent activity', {
        conversationId,
        emailId,
        err,
      });
    }
  }

  /**
   * Send a mail-provider (Microsoft/Google) reply on a conversation and
   * persist the Email + ExternalMessage rows. Used by the call-invitation
   * flow; pass `tx` to roll back on provider failures. Zoho replies go
   * through the controller's own path.
   */
  async sendReplyOnConversation(
    params: {
      conversationId: string;
      body: string;
      type: 'REPLY' | 'REPLY_ALL';
      to?: string[];
      cc?: string[];
      bcc?: string[];
      fileAttachments?: Array<{ name: string; contentType: string; content: Buffer | string }>;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{
    emailId: string;
    threadId: string;
    externalMessageId: string;
    externalSourceType: string;
  }> {
    const client = tx ?? this.prisma;

    const conversation = await this.conversationRepository.findById(params.conversationId);
    if (!conversation) throw new Error(`Conversation not found: ${params.conversationId}`);

    // Check if email sending is disabled for this ticket (e.g., during Auto RCA generation)
    const ticket = await client.ticket.findFirst({
      where: { conversationId: params.conversationId },
      select: { id: true, emailReplyEnabled: true },
    });
    if (ticket && ticket.emailReplyEnabled === false) {
      logger.warn(`[emailService.sendReplyOnConversation] Email sending blocked for ticket ${ticket.id} - emailReplyEnabled is false`);
      throw new Error(`Email sending is temporarily disabled for this ticket. An automated process is in progress.`);
    }
    const externalSource = await new ChannelExternalSourceResolver().resolveForChannel(
      conversation.channelId,
    );
    if (!externalSource) throw new Error(`No external source for channel ${conversation.channelId}`);
    const emails = await this.emailRepository.findByConversationId(params.conversationId);
    if (emails.length === 0) throw new Error(`No emails in conversation ${params.conversationId}`);
    const initialEmail = emails[emails.length - 1];
    const latestEmail = emails[0];

    const preference = await this.emailChannelPreferenceRepository.findByChannelId(conversation.channelId);
    if (!preference?.ownerUserId) {
      throw new Error(`Desk owner not configured for channel ${conversation.channelId}. Set ownerUserId in EmailChannelPreference.`);
    }
    const owner = await this.userRepository.findById(preference.ownerUserId);
    if (!owner?.email) {
      throw new Error(`Desk owner user ${preference.ownerUserId} not found or has no email.`);
    }
    const fromEmailAddress = preference.sendAsEmail || owner.email;

    const to = params.to?.length
      ? params.to
      : params.type === 'REPLY'
        ? [initialEmail.replyTo?.[0] ?? initialEmail.from]
        : [...new Set([initialEmail.replyTo?.[0] ?? initialEmail.from, ...initialEmail.to])];
    const cc = params.cc ?? (params.type === 'REPLY_ALL' && !params.to ? (initialEmail.cc || []) : []);
    const bcc = params.bcc ?? [];

    const adapter = adapterRegistry.getAdapter(externalSource.name);
    if (!adapter.sendMailReply) {
      throw new Error(`Adapter "${adapter.name}" does not support mail reply`);
    }

    logger.info(
      `[emailService.sendReplyOnConversation] ${params.type} via ${externalSource.sourceType} conv=${params.conversationId}`,
    );
    const sent = await adapter.sendMailReply({
      encryptedCredentials: externalSource.credentials,
      sourceId: externalSource.id,
      body: params.body,
      subject: initialEmail.subject,
      to, cc, bcc,
      initialExternalThreadId: initialEmail.externalThreadId,
      latestExternalThreadId: latestEmail.externalThreadId,
      latestExternalMessageId: latestEmail.externalMessageId,
      fromEmailAddress,
      ...(params.fileAttachments && { fileAttachments: params.fileAttachments }),
    });

    const externalMessageId = sent.messageId || sent.threadId;
    const email = await client.email.create({
      data: {
        type: params.type === 'REPLY' ? EmailType.REPLY : EmailType.REPLY_ALL,
        subject: `Re: ${initialEmail.subject}`,
        body: params.body,
        to,
        from: fromEmailAddress,
        cc,
        bcc,
        workspaceId: conversation.workspaceId,
        conversationId: params.conversationId,
        channelId: conversation.channelId,
        externalThreadId: sent.threadId,
        externalMessageId,
      } as Prisma.EmailUncheckedCreateInput,
    });
    await syncTicketEmailCount(client, params.conversationId);

    try {
      await client.externalMessage.create({
        data: {
          externalSourceId: externalSource.id,
          externalId: externalMessageId,
          externalThreadId: initialEmail.externalThreadId,
          messageId: email.id,
          entityId: email.id,
          direction: MessageDirection.OUTGOING,
          entityType: ExternalEntityType.EMAIL,
          workspaceId: conversation.workspaceId,
        },
      });
    } catch (err) {
      // P2002 = webhook raced us with the inbound copy of this same message.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }

    // Record the first response time for SLA tracking. Uses the email's own
    // createdAt so the timestamp is consistent with what is persisted in the DB.
    // Called after the transaction so a tracking failure never rolls back the reply.
    await this.recordFirstResponse(params.conversationId, email.createdAt);

    return {
      emailId: email.id,
      threadId: sent.threadId,
      externalMessageId,
      externalSourceType: externalSource.sourceType,
    };
  }

  async ingestEmailThread(params: IngestEmailThreadParams): Promise<IngestEmailThreadResult> {
    const {
      channelId,
      externalThreadId,
      externalSourceId,
      userId,
      ticketMetadata,
    } = params;

    if (params.emails.length === 0) {
      return { conversationId: '', inserted: 0, duplicates: 0, isNew: false };
    }

    const emails = [...params.emails].sort((a, b) => {
      const at = a.receivedAt?.getTime() ?? 0;
      const bt = b.receivedAt?.getTime() ?? 0;
      return at - bt;
    });

    const firstEmail = emails[0]!;
    const channel = await this.channelRepository.findById(channelId);
    if (!channel) throw new Error(`Channel not found: ${channelId}`);
    if (channel.type !== ChannelType.EMAIL) {
      throw new Error(
        `[EmailService] refusing to ingest into non-EMAIL channel ${channelId} (type=${channel.type})`,
      );
    }

    const existingFirstEmail = await this.emailRepository.findFirstByThreadAndChannel(
      externalThreadId,
      channelId,
    );

    // Cross-mailbox thread lookup via RFC References/In-Reply-To.
    let refsMatchEmail: { conversationId: string; externalThreadId: string } | null = null;
    if (!existingFirstEmail && params.referencedMessageIds?.length) {
      refsMatchEmail = await this.emailRepository.findByRfcMessageIds(
        channelId,
        params.referencedMessageIds,
      );
      if (refsMatchEmail) {
        logger.info('[EmailService] ingestEmailThread: RFC References match found', {
          conversationId: refsMatchEmail.conversationId,
          channelId,
          refsCount: params.referencedMessageIds.length,
        });
      }
    }

    // Cross-thread duplicate check: same subject + sender in same channel.
    // Gated by per-inbox setting — only runs when auto-merge is enabled for this channel.
    let vespaMatchConversationId: string | null = null;
    let preference: Awaited<
      ReturnType<typeof this.emailChannelPreferenceRepository.findByChannelId>
    > = null;
    if (!existingFirstEmail) {
      preference = await this.emailChannelPreferenceRepository.findByChannelId(channelId);
      if (preference?.emailMergeMode === EmailMergeMode.ENABLED) {
        const duplicateCheck = await findDuplicateEmailConversation(
          channelId,
          firstEmail.from,
          firstEmail.subject,
        );
        if (duplicateCheck.isDuplicate && duplicateCheck.match) {
          vespaMatchConversationId = duplicateCheck.match.conversationId;
          logger.info('[EmailService] ingestEmailThread: Vespa duplicate found, merging into existing conversation', {
            conversationId: vespaMatchConversationId,
            subject: firstEmail.subject,
            from: firstEmail.from,
          });
        }
      }
    }

    let boardId: string | undefined;
    let groupId: string | null = null;
    let projectId: string | undefined;
    if (!existingFirstEmail) {
      const externalSource = await this.prisma.externalSource.findUnique({
        where: { id: externalSourceId },
        select: { boardId: true },
      });
      boardId =
        preference?.boardId ?? externalSource?.boardId ?? undefined;
      if (!boardId) {
        const resolved = await resolveChannelDefaultBoard(this.prisma, channelId);
        boardId = resolved?.boardId;
        projectId = resolved?.projectId ?? undefined;
      }
      if (!boardId) {
        throw new Error(
          `[EmailService] No board configured for channel ${channelId}`,
        );
      }
      if (!projectId) {
        const board = await this.boardRepository.findById(boardId);
        projectId = board?.projectId ?? undefined;
      }
      groupId = preference?.assigneeUserGroupId ?? null;
    }

    // Pre-compute SLA due dates before the transaction using the first email's
    // priority (derived from subject) and its receivedAt timestamp.
    const ingestTicketPriority = derivePriorityFromSubject(firstEmail.subject ?? '');
    const ingestSlaResolutionDue = existingFirstEmail
      ? null
      : await this.getSlaResolutionDue(
          boardId,
          ingestTicketPriority,
          firstEmail.receivedAt ?? new Date(),
        );

    const emailRowIds = emails.map(() => uuidv4());
    const emailRows = emails.map((e, i) => ({
      id: emailRowIds[i]!,
      type: e.type ?? EmailType.DEFAULT,
      subject: e.subject,
      body: e.body,
      to: e.to,
      from: e.from,
      cc: e.cc ?? [],
      bcc: e.bcc ?? [],
      replyTo: e.replyTo ?? [],
      channelId,
      externalThreadId,
      externalMessageId: e.externalMessageId,
      rfcMessageId: normalizeRfcMessageId(e.rfcMessageId),
      ...(e.receivedAt && { createdAt: e.receivedAt }),
    }));

    let txResult: ThreadTxResult;
    try {
      txResult = await this.prisma.$transaction(async tx => {
        let conversationId: string;
        let ticketId: string | undefined;
        let ticketXyneId: string | undefined;
        let isNew: boolean;
        let existingTicketLastEmailAt: Date | null = null;
        let previousLatestEmailId: string | null = null;

        const createNewConversation = async () => {
          const stages = await tx.stage.findMany({
            where: { boardId: boardId! },
            orderBy: { sequenceNumber: 'asc' },
          });
          if (stages.length === 0) {
            throw new Error(`No stages found for board ${boardId}`);
          }
          const firstStage = stages[0]!;

          const conv = await tx.conversation.create({
            data: {
              channelId,
              createdBy: userId,
              initialMessageId: 'temp',
              workspaceId: channel.workspaceId,
              ...(firstEmail.receivedAt && {
                createdAt: firstEmail.receivedAt,
                lastActivityAt: firstEmail.receivedAt,
              }),
            },
          });

          const xyneId = await TicketIdService.generateTicketId(tx, projectId!);
          const createdTicket = await tx.ticket.create({
            data: {
              title: firstEmail.subject,
              description: firstEmail.body,
              createdBy: userId,
              updatedBy: userId,
              conversationId: conv.conversationId,
              channelId,
              workspaceId: channel.workspaceId,
              xyneId,
              projectId: projectId!,
              boardId: boardId!,
              lastEmailAt: firstEmail.receivedAt ?? new Date(),
              stageName: firstStage.name,
              ticketType: BaseTicketType.DESK,
              ...(ingestSlaResolutionDue && { eta: ingestSlaResolutionDue }),
              ...(groupId && { userGroupId: groupId }),
              ...(ticketMetadata && { metadata: ticketMetadata as Prisma.InputJsonValue }),
              ...(firstEmail.receivedAt && { createdAt: firstEmail.receivedAt }),
            },
          });

          await syncConversationTicketMdFromPrismaTicket(tx, createdTicket);

          // Seed the conversation's initial message inside the same tx so we
          // never leave a `'temp'` sentinel in `Conversation.initialMessageId`
          // pointing at no real Message row. Doing this post-tx (the previous
          // shape) meant any failure between tx commit and the seeding update
          // stranded the conversation forever; the catch-and-log there was a
          // permanent data-rot vector, not a transient blip.
          const initialMessage = await tx.message.create({
            data: {
              conversationId: conv.conversationId,
              senderId: userId,
              workspaceId: channel.workspaceId,
              content: '',
              hasAttachment: true,
              metadata: { ticketId: createdTicket.id },
            },
          });
          await tx.conversation.update({
            where: { conversationId: conv.conversationId },
            data: {
              initialMessageId: initialMessage.messageId,
              ticketId: createdTicket.id,
            },
          });

          return {
            conversationId: conv.conversationId,
            ticketId: createdTicket.id,
            ticketXyneId: createdTicket.xyneId,
          };
        };

        if (existingFirstEmail) {
          conversationId = existingFirstEmail.conversationId;
          isNew = false;
          const ticketRow = await tx.ticket.findFirst({
            where: { conversationId },
            select: { id: true, xyneId: true },
          });
          ticketId = ticketRow?.id;
          ticketXyneId = ticketRow?.xyneId;
        } else if (refsMatchEmail) {
          conversationId = refsMatchEmail.conversationId;
          isNew = false;
          const existingConv = await tx.conversation.findUnique({
            where: { conversationId },
            select: { conversationId: true },
          });
          if (!existingConv) {
            logger.warn('[EmailService] ingestEmailThread: stale RFC refs match ignored, creating new conversation', {
              conversationId,
              channelId,
              externalThreadId,
            });
            const created = await createNewConversation();
            conversationId = created.conversationId;
            ticketId = created.ticketId;
            ticketXyneId = created.ticketXyneId;
            isNew = true;
          } else {
            const ticketRow = await tx.ticket.findFirst({
              where: { conversationId },
              select: { id: true, xyneId: true, lastEmailAt: true },
            });
            ticketId = ticketRow?.id;
            ticketXyneId = ticketRow?.xyneId;
            existingTicketLastEmailAt = ticketRow?.lastEmailAt ?? null;
            const previousLatest = await tx.email.findFirst({
              where: { conversationId },
              orderBy: { createdAt: 'desc' },
              select: { id: true },
            });
            previousLatestEmailId = previousLatest?.id ?? null;
          }
        } else if (vespaMatchConversationId) {
          let shouldCreateConversation = false;
          conversationId = vespaMatchConversationId;
          isNew = false;
          const existingConversation = await tx.conversation.findUnique({
            where: { conversationId },
            select: { conversationId: true },
          });
          if (!existingConversation) {
            logger.warn('[EmailService] ingestEmailThread: stale Vespa duplicate ignored, creating new conversation', {
              conversationId,
              channelId,
              externalThreadId,
              subject: firstEmail.subject,
              from: firstEmail.from,
            });
            shouldCreateConversation = true;
            vespaMatchConversationId = null;
          } else {
            const ticketRow = await tx.ticket.findFirst({
              where: { conversationId },
              select: { id: true, xyneId: true, lastEmailAt: true },
            });
            ticketId = ticketRow?.id;
            ticketXyneId = ticketRow?.xyneId;
            existingTicketLastEmailAt = ticketRow?.lastEmailAt ?? null;
            const previousLatest = await tx.email.findFirst({
              where: { conversationId },
              orderBy: { createdAt: 'desc' },
              select: { id: true },
            });
            previousLatestEmailId = previousLatest?.id ?? null;
          }

          if (shouldCreateConversation) {
            const created = await createNewConversation();
            conversationId = created.conversationId;
            ticketId = created.ticketId;
            ticketXyneId = created.ticketXyneId;
            isNew = true;
          }
        } else {
          const created = await createNewConversation();
          conversationId = created.conversationId;
          ticketId = created.ticketId;
          ticketXyneId = created.ticketXyneId;
          isNew = true;
        }

        const incomingRfcIds = [
          ...new Set(emailRows.map(row => row.rfcMessageId).filter((id): id is string => !!id)),
        ];
        const existingRfcRows = incomingRfcIds.length > 0
          ? await tx.email.findMany({
              where: { channelId, rfcMessageId: { in: incomingRfcIds } },
              select: { rfcMessageId: true },
            })
          : [];
        const existingRfcIds = new Set(
          existingRfcRows.map(row => row.rfcMessageId).filter((id): id is string => !!id),
        );
        const rowsToInsert = emailRows.filter(
          row => !row.rfcMessageId || !existingRfcIds.has(row.rfcMessageId),
        );

        const emailInsert = rowsToInsert.length > 0
          ? await tx.email.createMany({
              data: rowsToInsert.map(row => ({ ...row, conversationId, workspaceId: channel.workspaceId })),
              skipDuplicates: true,
            })
          : { count: 0 };
        const backfillPairs = emailRows
          .map(row => ({ externalMessageId: row.externalMessageId, rfcMessageId: normalizeRfcMessageId(row.rfcMessageId) }))
          .filter((p): p is { externalMessageId: string; rfcMessageId: string } => !!p.rfcMessageId);
        if (backfillPairs.length > 0) {
          const grouped = new Map<string, string[]>();
          for (const p of backfillPairs) {
            const ids = grouped.get(p.rfcMessageId) ?? [];
            ids.push(p.externalMessageId);
            grouped.set(p.rfcMessageId, ids);
          }
          await Promise.all(
            Array.from(grouped.entries()).map(([rfcId, extIds]) =>
              tx.email.updateMany({
                where: { channelId, rfcMessageId: null, externalMessageId: { in: extIds } },
                data: { rfcMessageId: rfcId },
              }),
            ),
          );
        }
        await syncTicketEmailCount(tx, conversationId);

        const persistedEmails = emailInsert.count > 0
          ? await tx.email.findMany({
              where: { id: { in: rowsToInsert.map(row => row.id) }, conversationId },
              select: { id: true, externalMessageId: true },
            })
          : [];

        await tx.externalMessage.createMany({
          data: persistedEmails.map(row => ({
            externalSourceId,
            externalId: row.externalMessageId,
            externalThreadId,
            entityType: ExternalEntityType.EMAIL,
            entityId: row.id,
            messageId: row.id,
            direction: MessageDirection.INCOMING,
            workspaceId: channel.workspaceId,
          })),
          skipDuplicates: true,
        });

        const latestReceived = emails.reduce<Date | null>((acc, e) => {
          if (!e.receivedAt) return acc;
          return acc && acc > e.receivedAt ? acc : e.receivedAt;
        }, null);
        if (ticketId && latestReceived) {
          if (!vespaMatchConversationId || !existingTicketLastEmailAt || latestReceived > existingTicketLastEmailAt) {
            await tx.ticket.update({
              where: { id: ticketId },
              data: { lastEmailAt: latestReceived },
            });
          }
        }

        if (emailInsert.count > 0 && vespaMatchConversationId && previousLatestEmailId && ticketId) {
          const caughtUpUsers = await tx.emailRead.findMany({
            where: { ticketId, lastReadEmailId: previousLatestEmailId },
            select: { userId: true },
          });
          if (caughtUpUsers.length > 0) {
            await tx.channelUserStatus.updateMany({
              where: { channelId, userId: { in: caughtUpUsers.map(r => r.userId) }, isDeleted: false },
              data: { unreadCount: { increment: 1 }, updatedAt: new Date() },
            });
          }
        }

        return {
          conversationId,
          ticketId,
          ticketXyneId,
          inserted: emailInsert.count,
          duplicates: emails.length - emailInsert.count,
          isNew,
          wasVespaMerge: !!(vespaMatchConversationId && previousLatestEmailId && ticketId),
          insertedEmailIds: persistedEmails.map(row => row.id),
        };
      }, { maxWait: 10_000, timeout: 30_000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        logger.warn('[EmailService] ingestEmailThread hit unique conflict, treating as duplicate', {
          channelId,
          externalThreadId,
        });
        return {
          conversationId: existingFirstEmail?.conversationId ?? '',
          inserted: 0,
          duplicates: emails.length,
          isNew: false,
        };
      }
      throw error;
    }

    const insertedIdSet = new Set(txResult.insertedEmailIds);
    const insertedEmails = emailRows
      .map((row, i) => ({
        id: row.id,
        body: emails[i]!.body,
        externalMessageId: row.externalMessageId,
        uploadedFiles: emails[i]!.uploadedFiles ?? [],
      }))
      .filter(row => insertedIdSet.has(row.id));

    // Initial message + conversation pointer are now seeded inside the
    // transaction above. Only the metadata md sync (which reads committed
    // rows for its query) runs here; if it fails the data is still
    // consistent — only the cached md field is stale, recoverable on next
    // write to the conversation.
    if (txResult.isNew && txResult.ticketId) {
      try {
        await messageMetadataService.syncInitialMessageMd(txResult.conversationId);
      } catch (error) {
        logger.warn('[EmailService] failed to sync initial message md', error);
      }

      void eventRouter.emit(
        { type: TICKET_CREATED_EVENT, payload: { ticketId: txResult.ticketId } },
        channel.workspaceId,
      ).catch((err: unknown) => logger.error(`[EmailService] TICKET_CREATED emit failed for ticket ${txResult.ticketId}:`, err));

      if (groupId) {
        const ticketForEmit = { id: txResult.ticketId, workspaceId: channel.workspaceId, channelId, boardId: boardId!, projectId: projectId!, createdBy: userId };
        void emitTicketUpdated({
          ticket: ticketForEmit as Parameters<typeof emitTicketUpdated>[0]['ticket'],
          changes: { userGroupId: { previousValue: null, newValue: groupId } },
          performedById: userId,
        });
      }
    }

    for (const e of insertedEmails) {
      void dispatchEmailEventForEmailId(e.id);
    }

    // Bulk-enqueue tag generation for every inserted email (fire-and-forget — must not block ingestion).
    // Priority 10 (low) so real-time inbound emails (priority 1) always jump ahead in the queue.
    if (config.enableTagGenerationPipeline && insertedEmails.length > 0) {
      void tagGenerationPipeline.addGenerationJobs(
        insertedEmails.map(e => ({
          sourceId: e.id,
          sourceType: DESK_EMAIL_SOURCE_TYPE,
          workspaceId: channel.workspaceId,
          configKey: deskEmailConfigKey(channelId),
        })),
        10,
      ).then((count) => {
        logger.info(`[TagFramework] Enqueued ${count} tag generation jobs for thread in channel ${channelId}`);
      }).catch((err: unknown) => {
        logger.error(`[TagFramework] Failed to enqueue tag generation jobs for channel ${channelId}`, err);
      });
    }

    for (const e of insertedEmails) {
      this.pushVespaJobForMail(e.id, userId, channel.workspaceId).catch(error => {
        logger.error(`[EmailService] Vespa job push failed for mail ${e.id}:`, error);
      });
    }
    if (txResult.isNew && txResult.ticketId) {
      this.pushVespaJobForTicket(txResult.ticketId, userId, channel.workspaceId).catch(error => {
        logger.error(
          `[EmailService] Vespa job push failed for ticket ${txResult.ticketId}:`,
          error,
        );
      });

      // isNew implies !existingFirstEmail, where projectId is resolved — so this is always
      // truthy here; the guard is what narrows string | undefined for TS.
      if (projectId) {
        ticketDuplicateService.persistDuplicateReferences({
          ticketId: txResult.ticketId,
          ticketCreatedBy: userId,
          title: firstEmail.subject,
          description: firstEmail.body,
          projectId,
          userId,
        }).catch((error: unknown) => {
          logger.error('[EmailService] Failed to persist duplicate references for ingested ticket', {
            ticketId: txResult.ticketId,
            error,
          });
        });
      }

      // Enqueue AI classification as a Redis worker job
      await emailClassificationQueue.getQueue().add('classify', {
        ticketId: txResult.ticketId,
        channelId,
        emailId: insertedEmails[0]!.id,
        groupId: groupId ?? null,
      }).catch((err: unknown) => {
        logger.error(`[Classification] Failed to enqueue classification job for ticket ${txResult.ticketId}`, err);
      });
    }

    for (const e of insertedEmails) {
      if (e.uploadedFiles.length > 0) {
        try {
          await this.createEmailAttachments(
            e.id,
            txResult.conversationId,
            userId,
            channel.workspaceId,
            e.uploadedFiles,
          );
        } catch (error) {
          logger.warn(
            `[EmailService] createEmailAttachments failed for email ${e.id}`,
            error,
          );
        }
      }
    }

    // Process Google Meet links from email bodies and send to SAM
    if (txResult.ticketXyneId && channel.workspaceId) {
      const zohoTicketId = ticketMetadata?.ticketId as string | undefined;
      for (const e of insertedEmails) {
        try {
          const meetResult = await processMeetLinksFromEmail(
            e.body,
            txResult.ticketXyneId,
            channel.workspaceId,
            externalThreadId,
            zohoTicketId
          );
          if (meetResult.processed > 0) {
            logger.info('[EmailService] Processed Google Meet links from ingestEmailThread', {
              xyneTicketId: txResult.ticketXyneId,
              meetCodes: meetResult.meetCodes,
              emailId: e.id,
              hasZohoTicketId: !!zohoTicketId,
            });
          }
        } catch (error) {
          // Don't fail email processing if meet link extraction fails
          logger.error('[EmailService] Failed to process meet links from ingestEmailThread', {
            error: error instanceof Error ? error.message : 'Unknown error',
            emailId: e.id,
            xyneTicketId: txResult.ticketXyneId,
          });
        }
      }
    }

    return {
      conversationId: txResult.conversationId,
      ticketId: txResult.ticketId,
      ticketXyneId: txResult.ticketXyneId,
      inserted: txResult.inserted,
      duplicates: txResult.duplicates,
      isNew: txResult.isNew,
      wasVespaMerge: txResult.wasVespaMerge,
    };
  }
}

// Export singleton instance
export const emailService = new EmailService();
