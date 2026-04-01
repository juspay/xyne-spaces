/**
 * External Source Core
 * Main orchestrator: runs adapter flow + syncs to database
 */

import { ExternalSourceAdapter, NormalizedData, IngestionResult } from './types';
import { SourceNotFoundError } from './errors';
import { ExternalSourceRepository } from '../../database/repositories/externalSourceRepository';
import { ExternalMessageRepository } from '../../database/repositories/externalMessageRepository';
import { ConversationRepository } from '../../database/repositories/conversationRepository';
import { MessageRepository } from '../../database/repositories/messageRepository';
import { ChannelRepository } from '../../database/repositories/channelRepository';
import { ExternalSource, ExternalMessage, ChannelType, ExternalEntityType, EmailType } from '@prisma/client';
import { logger } from '../../utils/logger';
import { conversationService } from '../../services/conversationService';
import { emailService } from '../../services/emailService';
import {
  AttachmentConversionService,
  ExternalAttachmentService,
  DownloadedAttachment,
} from '@/services/externalAttachmentService';
import { EmailRepository } from '@/database/repositories';
import { findDuplicateEmailConversation } from '../../utils/vespaDuplicateDetector';

export class ExternalSourceCore {
  private externalSourceRepo: ExternalSourceRepository;
  private externalMessageRepo: ExternalMessageRepository;
  private conversationRepo: ConversationRepository;
  private messageRepo: MessageRepository;
  private channelRepo: ChannelRepository;
  private emailRepo: EmailRepository

  constructor() {
    this.externalSourceRepo = new ExternalSourceRepository();
    this.externalMessageRepo = new ExternalMessageRepository();
    this.conversationRepo = new ConversationRepository();
    this.messageRepo = new MessageRepository();
    this.channelRepo = new ChannelRepository();
    this.emailRepo = new EmailRepository();
  }


  /**
   * Main ingestion orchestrator
   * Runs: preprocess → transform → sync
   */
  async ingest(
    adapter: ExternalSourceAdapter,
    sourceName: string,
    rawPayload: any,
    source?: ExternalSource
  ): Promise<IngestionResult> {
    logger.info(`Ingesting data from ${sourceName} using ${adapter.name} adapter`);

    // 1. Preprocess (optional - fetch extra data if needed)
    const enrichedPayload = adapter.preprocess ? await adapter.preprocess(rawPayload, source) : rawPayload;

    // 2. Transform to normalized format
    const parseResult = await adapter.transform(enrichedPayload);

    if (!parseResult.success || !parseResult.data) {
      throw new Error(`Transform failed: ${parseResult.error}`);
    }

    const normalizedData = parseResult.data;

    // 3. Sync to database (sourceName already resolved in authenticate.ts)
    return await this.sync(adapter, sourceName, normalizedData);
  }

  /**
   * Sync normalized data to database
   * EXACT SAME LOGIC as ExternalSourceSyncService.ingest()
   */
  private async sync(
    adapter: ExternalSourceAdapter,
    sourceName: string,
    normalizedData: NormalizedData
  ): Promise<IngestionResult> {
    logger.info(`Syncing ${sourceName}`, {
      externalId: normalizedData.externalId,
      eventType: normalizedData.metadata.eventType,
    });

    // 1. Get external source from database
    const source = await this.externalSourceRepo.findByName(sourceName);
    if (!source) {
      throw new SourceNotFoundError(sourceName);
    }

    const sourceChannelId = source.channelId;
    if (!sourceChannelId) {
      throw new Error(`External source ${sourceName} does not have a channel binding`);
    }

    // Check channel type to determine which service to use
    const channel = await this.channelRepo.findById(sourceChannelId);
    if (!channel) {
      throw new Error(`Channel ${sourceChannelId} not found`);
    }
    const isEmailChannel = channel.type === ChannelType.EMAIL;
    const allowOrphanReplyBootstrap =
      isEmailChannel &&
      source.sourceType === 'google' &&
      normalizedData.metadata.allowOrphanThreadBootstrap === true;
    if (normalizedData.metadata.isReply) {
      const existingThread = await this.externalMessageRepo.findByThreadId(
        source.id,
        normalizedData.externalThreadId
      );
      
      if (!existingThread) {
        if (allowOrphanReplyBootstrap) {
          logger.info(`Allowing orphan reply bootstrap for ${sourceName}`, {
            externalId: normalizedData.externalId,
            externalThreadId: normalizedData.externalThreadId,
            eventType: normalizedData.metadata.eventType,
            sourceType: source.sourceType,
          });
        } else {
          logger.warn(`Blocking orphan reply for thread ${normalizedData.externalThreadId} - no parent conversation found`, {
            externalId: normalizedData.externalId,
            externalThreadId: normalizedData.externalThreadId,
            eventType: normalizedData.metadata.eventType,
          });
          throw new Error(`Orphan reply blocked: No parent conversation found for thread ${normalizedData.externalThreadId}`);
        }
      }
    }

    // 2. Download attachments if present
    let downloadedAttachments: DownloadedAttachment[] = normalizedData.downloadedAttachments || [];
    if (
      downloadedAttachments.length === 0 &&
      normalizedData.attachments &&
      normalizedData.attachments.length > 0
    ) {
      try {
        logger.info(
          `Downloading ${normalizedData.attachments.length} attachments for ${sourceName}`
        );

        downloadedAttachments = await ExternalAttachmentService.downloadForSource(
          sourceName,
          normalizedData.attachments,
          {
            maxFileSize: 50 * 1024 * 1024, // 50MB
            timeout: 30000, // 30 seconds
            scopeType: 'EXTERNAL_MESSAGE',
            scopeId: sourceName,
          }
        );

        logger.info(
          `Successfully downloaded ${downloadedAttachments.length}/${normalizedData.attachments.length} attachments`
        );
      } catch (error) {
        logger.error(`Failed to download attachments for ${sourceName}:`, error);
        // Continue processing even if attachment download fails
        // This ensures messages are still created even if attachments fail
      }
    }

    // 3. Check for duplicate (deduplication)
    const existingExtMsg = await this.externalMessageRepo.findByExternalId(
      source.id,
      normalizedData.externalId
    );

    if (existingExtMsg && isEmailChannel) {
      // in case of duplicate entry, for email flow, donot add any updates
      return {
        success: true,
        conversationId: "",
        entityId: existingExtMsg.entityId || "",
        action: "duplicate"
      }
    }

    if (existingExtMsg && !isEmailChannel) {
      logger.info(`Duplicate message detected for ${normalizedData.externalId}`);
      return await this.handleUpdate(source, normalizedData, existingExtMsg, downloadedAttachments);
    }

    // 4. Find or create conversation
    const { conversation, message, email, isNew, blocked } = await this.findOrCreateConversation(
      source,
      normalizedData,
      downloadedAttachments,
      isEmailChannel
    );

    if (blocked) {
      logger.warn(`Ingestion blocked by Superposition for source ${sourceName}`, {
        externalThreadId: normalizedData.externalThreadId,
        externalId: normalizedData.externalId,
      });
      return {
        success: true,
        conversationId: '',
        entityId: '',
        action: 'created',
      };
    }

    const resolvedEntityId = isEmailChannel ? email?.id : message?.messageId ;

    if (!conversation || (!isEmailChannel && !message) || (isEmailChannel && !email) || !resolvedEntityId) {
      throw new Error('Failed to create or find conversation');
    }

    logger.info(`Using conversation ${conversation.conversationId}, isNew: ${isNew}`);

    // 5. Create ExternalMessage tracking record
    await this.externalMessageRepo.create({
      externalSourceId: source.id,
      externalId: normalizedData.externalId,
      externalThreadId: normalizedData.externalThreadId,
      entityId: resolvedEntityId,
      direction: 'INCOMING',
      entityType: isEmailChannel ? ExternalEntityType.EMAIL : ExternalEntityType.MESSAGE,
    });

    // Call adapter's postprocess hook if available (adapter decides when to process)
    if (adapter.postprocess) {
      await adapter.postprocess({
        conversationId: conversation.conversationId,
        entityId: resolvedEntityId,
        sourceId: source.id,
        normalizedData,
      });
    }

    logger.info(`Successfully ingested data from ${sourceName}`);

    return {
      success: true,
      conversationId: conversation.conversationId,
      entityId: resolvedEntityId,
      action: 'created',
    };
  }

  /**
   * Find existing conversation or create new one with initial message
   */
  private async findOrCreateConversation(
    source: ExternalSource,
    normalizedData: NormalizedData,
    downloadedAttachments: DownloadedAttachment[],
    isEmailChannel: boolean
  ) {
    const sourceChannelId = source.channelId;
    if (!sourceChannelId) {
      throw new Error(`External source ${source.name} does not have a channel binding`);
    }

    // Check if conversation exists for this external thread
    const existingExtMsg = await this.externalMessageRepo.findByThreadId(
      source.id,
      normalizedData.externalThreadId
    );

    if (existingExtMsg) {
      let conversationid: string = "";
      if (isEmailChannel) {
        if (existingExtMsg.entityId) {
          const emailMessage = await this.emailRepo.findById(existingExtMsg.entityId);
          conversationid = emailMessage?.conversationId || "";
        }
      } else {
        const messageRepo = await this.messageRepo.findById(existingExtMsg.messageId);
        conversationid = messageRepo?.conversationId || "";
      }

      const conversation = await this.conversationRepo.findById(conversationid);

      if (!conversation) {
        throw new Error(`Conversation ${conversationid} not found`);
      }

      // Create reply message

      logger.info(`Converting ${downloadedAttachments.length} downloaded attachments to uploaded format`);
      const uploadedFiles = AttachmentConversionService.convertDownloadedToUploaded(downloadedAttachments);
      logger.info(`Converted to ${uploadedFiles.length} uploaded files`);

      if (isEmailChannel) {
        if (!normalizedData.emailData?.to || !normalizedData?.emailData.from ) {
          throw new Error(
            'Missing required email fields in normalizedData. Required: subject, body, to, from'
          );
        }
        const { email } = await emailService.addEmailToConversation({
          conversationId: conversation.conversationId,
          emailSubject: normalizedData.emailData.subject || "",
          emailBody: normalizedData.content,
          emailTo: normalizedData.emailData.to,
          emailFrom: normalizedData.emailData.from,
          emailCc: normalizedData?.emailData?.cc,
          emailBcc: normalizedData?.emailData?.bcc,
          externalThreadId: normalizedData.externalThreadId,
          externalMessageId: normalizedData.externalId,
          entityTags: normalizedData.metadata.entityTags,
          uploadedFiles: uploadedFiles,
        });
        return { conversation, message: undefined, email, isNew: false };
      } else {
        const { message } = await conversationService.addMessageToConversation({
          conversationId: conversation.conversationId,
          userId: source.displayName,
          content: normalizedData.content,
          msgType: 'BOT',
          uploadedFiles: uploadedFiles,
          metadata: {
            externalSource: source.name,
            externalAuthor: normalizedData.author,
            eventType: normalizedData.metadata.eventType,
            ticketNumber: normalizedData.metadata.ticketNumber,
            webUrl: normalizedData.metadata.webUrl,
          },
          isBot: true,
        });
        return { conversation, message, email: undefined, isNew: false };
      }
    }

    // For email channels, check Vespa for duplicate conversation
    // This handles cases where tickets were created manually (not via Zoho)
    if (isEmailChannel && !existingExtMsg && normalizedData.emailData) {
      logger.info(`[EMAIL_DUPLICATE_CHECK] Checking Vespa for duplicate email`, {
        channelId: sourceChannelId,
        emailFrom: normalizedData.emailData.from,
        emailSubject: normalizedData.emailData.subject,
      });

      const duplicateCheck = await findDuplicateEmailConversation(
        sourceChannelId,
        normalizedData.emailData.from || "",
        normalizedData.emailData.subject || ""
      );

      if (duplicateCheck.isDuplicate && duplicateCheck.match) {
        logger.info(`[EMAIL_DUPLICATE_FOUND] Duplicate email found via Vespa - adding to existing conversation`, {
          existingConversationId: duplicateCheck.match.conversationId,
          existingTicketId: duplicateCheck.match.ticketId,
          existingSubject: duplicateCheck.match.subject,
          newSubject: normalizedData.emailData.subject,
          from: normalizedData.emailData.from,
        });

        const conversation = await this.conversationRepo.findById(duplicateCheck.match.conversationId);

        // Conversation must exist since duplicateCheck.match comes from Vespa search results
        if (!conversation) {
          throw new Error(`Conversation ${duplicateCheck.match.conversationId} not found`);
        }

        logger.info(`[EMAIL_DUPLICATE_FOUND] Found existing conversation, adding email to it`, {
          conversationId: conversation.conversationId,
          channelId: conversation.channelId,
        });

        // Convert attachments
        logger.info(`[EMAIL_DUPLICATE_FOUND] Converting ${downloadedAttachments.length} downloaded attachments to uploaded format`);
        const uploadedFiles = AttachmentConversionService.convertDownloadedToUploaded(downloadedAttachments);
        logger.info(`[EMAIL_DUPLICATE_FOUND] Converted to ${uploadedFiles.length} uploaded files`);

        // Add email to existing conversation
        const { email } = await emailService.addEmailToConversation({
          conversationId: conversation.conversationId,
          emailSubject: normalizedData.emailData.subject || "",
          emailBody: normalizedData.content,
          emailTo: normalizedData.emailData.to || [],
          emailFrom: normalizedData.emailData.from || "",
          emailCc: normalizedData.emailData.cc || [],
          emailBcc: normalizedData.emailData.bcc || [],
          externalThreadId: normalizedData.externalThreadId,
          externalMessageId: normalizedData.externalId,
          emailType: EmailType.DEFAULT,
          entityTags: normalizedData.metadata.entityTags,
          uploadedFiles: uploadedFiles,
        });

        logger.info(`[EMAIL_DUPLICATE_SUCCESS] Successfully added email to existing conversation`, {
          conversationId: conversation.conversationId,
          emailId: email.id,
          externalMessageId: normalizedData.externalId,
        });

        return { conversation, email, isNew: false };
      } else {
        logger.info(`[EMAIL_DUPLICATE_NOT_FOUND] No duplicate found in Vespa, will create new conversation`, {
          reason: duplicateCheck.reason,
        });
      }
    }

    // Create new conversation with initial message
    logger.info(`Creating new conversation in channel ${sourceChannelId}`);
    logger.info(`Converting ${downloadedAttachments.length} downloaded attachments to uploaded format for new conversation`);
    const uploadedFiles = AttachmentConversionService.convertDownloadedToUploaded(downloadedAttachments);
    logger.info(`Converted to ${uploadedFiles.length} uploaded files for new conversation`);

    if (isEmailChannel) {
      if (!normalizedData.emailData || !normalizedData.emailData.to || !normalizedData.emailData.from ) {
        throw new Error(
          'Missing required email fields in normalizedData. Required: subject, body, to, from'
        );
      }
      const createResult = await emailService.createConversationWithEmail({
        channelId: sourceChannelId,
        boardId: source.boardId || undefined, // Pass boardId from ExternalSource for ticket creation
        userId: source.displayName,
        emailSubject: normalizedData.emailData.subject || "",
        emailBody: normalizedData.content,
        emailTo: normalizedData.emailData.to,
        emailFrom: normalizedData.emailData.from,
        emailCc: normalizedData.emailData.cc,
        emailBcc: normalizedData.emailData.bcc,
        externalThreadId: normalizedData.externalThreadId,
        externalMessageId: normalizedData.externalId,
        ticketMetadata: normalizedData.metadata,
        uploadedFiles: uploadedFiles,
        sourceName: source.name, // Pass sourceName for Superposition context
      });
      if ((createResult as any)?.blocked) {
        return { conversation: undefined, message: undefined, email: undefined, isNew: false, blocked: true };
      }
      const { conversation, email } = createResult as any;
      return { conversation, email, isNew: true };
    } else {
      const { conversation, message } = await conversationService.createConversationWithMessage({
        channelId: sourceChannelId,
        userId: source.displayName,
        content: normalizedData.content,
        msgType: 'BOT',
        uploadedFiles: uploadedFiles,
        metadata: {
          externalSource: source.name,
          externalThreadId: normalizedData.externalThreadId,
          ticketNumber: normalizedData.metadata.ticketNumber,
          webUrl: normalizedData.metadata.webUrl,
        },
        messageMetadata: {
          externalSource: source.name,
          externalAuthor: normalizedData.author,
          eventType: normalizedData.metadata.eventType,
          ticketNumber: normalizedData.metadata.ticketNumber,
          webUrl: normalizedData.metadata.webUrl,
        },
        isBot: true,
      });
      return { conversation, message, isNew: true };
    }
  }

  /**
   * Handle update for existing message
   */
  private async handleUpdate(
    source: ExternalSource,
    normalizedData: NormalizedData,
    existingExtMsg: ExternalMessage,
    downloadedAttachments: DownloadedAttachment[]
  ) {
    logger.info(`Handling update for existing message ${existingExtMsg.messageId}`);

    const existingMessage = await this.messageRepo.findById(existingExtMsg.messageId);
    if (!existingMessage) {
      throw new Error(`Message ${existingExtMsg.messageId} not found`);
    }

    const conversation = await this.conversationRepo.findById(existingMessage.conversationId);

    if (!conversation) {
      throw new Error(`Conversation ${existingMessage.conversationId} not found`);
    }

    // Convert downloaded attachments to uploaded format
    logger.info(`Converting ${downloadedAttachments.length} downloaded attachments for update`);
    const uploadedFiles = AttachmentConversionService.convertDownloadedToUploaded(downloadedAttachments);
    logger.info(`Converted to ${uploadedFiles.length} uploaded files for update`);

    // Update existing message instead of creating a new one
    const { message } = await conversationService.updateMessageContent({
      messageId: existingExtMsg.messageId,
      content: normalizedData.content,
      uploadedFiles: uploadedFiles,
      metadata: {
        updatedAt: normalizedData.metadata.timestamp,
        externalSource: source.name,
      },
    });

    return {
      success: true,
      conversationId: conversation.conversationId,
      entityId: message.messageId,
      action: 'updated' as const,
    };
  }

}

// Export singleton
export const externalSourceCore = new ExternalSourceCore();
