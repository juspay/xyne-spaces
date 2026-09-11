/**
 * External Source Core
 * Main orchestrator: runs adapter flow + syncs to database
 */

import {
  ExternalSourceAdapter,
  NormalizedData,
  IngestionResult,
  type IngestionOptions,
} from './types';
import { SourceNotFoundError } from './errors';
import { ExternalSourceRepository } from '../../database/repositories/externalSourceRepository';
import { ExternalMessageRepository } from '../../database/repositories/externalMessageRepository';
import { ConversationRepository } from '../../database/repositories/conversationRepository';
import { MessageRepository } from '../../database/repositories/messageRepository';
import { ChannelRepository } from '../../database/repositories/channelRepository';
import { EmailChannelPreferenceRepository } from '../../database/repositories/emailChannelPreferenceRepository';
import { ExternalSource, ExternalMessage } from '@prisma/client';
import { isDeskChannelType, ExternalEntityType, EmailType, EmailMergeMode, ChannelType, MessageDirection, MessageType } from '@xyne/shared';
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
import { collectDlCandidates } from '@/services/dlResolver';
import { db } from '@/database/client';
import { ChannelEmailAliasService } from '@/services/channelEmailAliasService';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import {
  buildChannelEmailMessageMetadata,
} from './channelEmailMessageFormatter';

const XYNE_MAIL_BOT_ID = 'xyne-mail';

export class ExternalSourceCore {
  private externalSourceRepo: ExternalSourceRepository;
  private externalMessageRepo: ExternalMessageRepository;
  private conversationRepo: ConversationRepository;
  private messageRepo: MessageRepository;
  private channelRepo: ChannelRepository;
  private emailRepo: EmailRepository;
  private emailChannelPreferenceRepo: EmailChannelPreferenceRepository;
  private channelEmailAliasService: ChannelEmailAliasService;

  constructor() {
    this.externalSourceRepo = new ExternalSourceRepository();
    this.externalMessageRepo = new ExternalMessageRepository();
    this.conversationRepo = new ConversationRepository();
    this.messageRepo = new MessageRepository();
    this.channelRepo = new ChannelRepository();
    this.emailRepo = new EmailRepository();
    this.emailChannelPreferenceRepo = new EmailChannelPreferenceRepository();
    this.channelEmailAliasService = new ChannelEmailAliasService();
  }

  private async resolveChannelMessageSenderId(source: ExternalSource): Promise<string> {
    if (this.channelEmailAliasService.isChannelEmailSourceType(source.sourceType)) {
      let botUser = await unifiedBotUserService.getBotByBotId(XYNE_MAIL_BOT_ID, source.workspaceId);
      if (!botUser) {
        await unifiedBotUserService.syncAllBotUsers(source.workspaceId);
        botUser = await unifiedBotUserService.getBotByBotId(XYNE_MAIL_BOT_ID, source.workspaceId);
      }

      if (!botUser) {
        throw new Error(`Failed to resolve ${XYNE_MAIL_BOT_ID} bot user for workspace ${source.workspaceId}`);
      }

      return botUser.id;
    }

    return source.displayName;
  }


  /**
   * Main ingestion orchestrator
   * Runs: preprocess → transform → sync
   */
  async ingest(
    adapter: ExternalSourceAdapter,
    sourceName: string,
    rawPayload: any,
    source?: ExternalSource,
    options?: IngestionOptions,
  ): Promise<IngestionResult[]> {
    logger.info(`Ingesting data from ${sourceName} using ${adapter.name} adapter`);

    // 1. Preprocess (optional - fetch extra data if needed)
    const enrichedPayload = adapter.preprocess
      ? await adapter.preprocess(rawPayload, source, options)
      : rawPayload;

    // preprocess may split one webhook into several messages (e.g. Gmail history batch); each runs through transform -> sync on its own.
    const payloads = Array.isArray(enrichedPayload) ? enrichedPayload : [enrichedPayload];

    const allResults: IngestionResult[] = [];
    const failedExternalIds: string[] = [];
    for (const payload of payloads) {
      if (payload && typeof payload === 'object' && (payload as any).__skipIngestion) {
        const reason = (payload as any).__skipReason || 'unspecified';
        logger.info(`Skipping ingestion for ${sourceName}: ${reason}`);
        allResults.push({ success: true, conversationId: '', entityId: '', action: 'skipped' });
        continue;
      }

      // 2. Transform to normalized format
      const parseResult = await adapter.transform(payload, source);

      if (!parseResult.success || !parseResult.data) {
        throw new Error(`Transform failed: ${parseResult.error}`);
      }

      // 3. Sync to database (sourceName already resolved in authenticate.ts).
      // A single provider payload may contain multiple interactions.
      const normalizedItems = Array.isArray(parseResult.data)
        ? parseResult.data
        : [parseResult.data];
      for (const normalizedData of normalizedItems) {
        try {
          const results = await this.sync(adapter, sourceName, normalizedData, source);
          allResults.push(...results);
        } catch (error) {
          failedExternalIds.push(normalizedData.externalId);
          logger.error(`Failed to sync interaction from ${sourceName}`, {
            externalId: normalizedData.externalId,
            eventType: normalizedData.metadata.eventType,
            errorMessage: error instanceof Error ? error.message : String(error),
            error,
          });
        }
      }
    }

    if (failedExternalIds.length > 0) {
      logger.error(
        `[INGEST_INCOMPLETE] ${failedExternalIds.length} message(s) not ingested from ${sourceName}`,
        { sourceName, externalIds: failedExternalIds },
      );
      throw new Error(
        `Failed to sync ${failedExternalIds.length} interaction${failedExternalIds.length === 1 ? '' : 's'} from ${sourceName}`,
      );
    }

    return allResults;
  }

  /**
   * Sync normalized data to database.
   * Public so the refetch handlers can reuse this exact pipeline
   * without re-implementing dedup / conversation / attachment logic.
   */
  async sync(
    adapter: ExternalSourceAdapter,
    sourceName: string,
    normalizedData: NormalizedData,
    resolvedSource?: ExternalSource,
  ): Promise<IngestionResult[]> {
    logger.info(`Syncing ${sourceName}`, {
      externalId: normalizedData.externalId,
      eventType: normalizedData.metadata.eventType,
    });

    // 1. Get external source from database
    const source = resolvedSource ?? (await this.externalSourceRepo.findByName(sourceName));
    if (!source) {
      throw new SourceNotFoundError(sourceName);
    }

    if (!source.channelId) {
      const resolvedChannelIds = await this.resolveDlChannels(source, normalizedData);
      if (resolvedChannelIds.length === 0) {
        return [{ success: true, conversationId: '', entityId: '', action: 'skipped' }];
      }

      const results: IngestionResult[] = [];
      for (const channelId of resolvedChannelIds) {
        const channelSource = { ...source, channelId };
        const result = await this.processChannel(adapter, sourceName, normalizedData, channelSource);
        results.push(result);
      }
      return results;
    }

    return [await this.processChannel(adapter, sourceName, normalizedData, source)];
  }

  private async processChannel(
    adapter: ExternalSourceAdapter,
    sourceName: string,
    normalizedData: NormalizedData,
    source: ExternalSource,
  ): Promise<IngestionResult> {
    if (!source.channelId) {
       throw new Error(`External source ${sourceName} does not have a channel binding`);
    }

    

    // Check channel type to determine which service to use
    const channel = await this.channelRepo.findById(source.channelId);
    if (!channel) {
      throw new Error(`Channel ${source.channelId} not found`);
    }
    const isDeskChannel = isDeskChannelType(channel.type);

    if (normalizedData.metadata.isReply) {
      const existingThread = await this.externalMessageRepo.findByThreadId(
        source.id,
        normalizedData.externalThreadId,
        isDeskChannel ? ExternalEntityType.EMAIL : ExternalEntityType.MESSAGE
      );

      const existingDeskEmail =
        !existingThread && isDeskChannel && source.channelId
          ? await this.emailRepo.findFirstByThreadAndChannel(
              normalizedData.externalThreadId,
              source.channelId,
            )
          : null;

      if (!existingThread && !existingDeskEmail) {
        logger.warn(`Blocking orphan reply for thread ${normalizedData.externalThreadId} - no parent conversation found`, {
          externalId: normalizedData.externalId,
          externalThreadId: normalizedData.externalThreadId,
          eventType: normalizedData.metadata.eventType,
        });
        throw new Error(`Orphan reply blocked: No parent conversation found for thread ${normalizedData.externalThreadId}`);
      }
    }

    // 2. Resolve attachments. Gmail/Graph flows pre-stage bytes via the
    //    unified attachment service, so `preDownloadedAttachments` is set and
    //    we use it directly. Slack/Zoho fall through to the URL-fetch path.
    let downloadedAttachments: DownloadedAttachment[] = [];
    if (normalizedData.preDownloadedAttachments && normalizedData.preDownloadedAttachments.length > 0) {
      downloadedAttachments = normalizedData.preDownloadedAttachments;
      logger.info(
        `Using ${downloadedAttachments.length} pre-downloaded attachments for ${sourceName}`,
      );
    } else if (normalizedData.attachments && normalizedData.attachments.length > 0) {
      try {
        logger.info(
          `Downloading ${normalizedData.attachments.length} attachments for ${sourceName}`
        );

        downloadedAttachments = await new ExternalAttachmentService().downloadAttachmentsForSource(
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

    if (existingExtMsg && !isDeskChannel) {
      logger.info(`Duplicate message detected for ${normalizedData.externalId}`);
      return await this.handleUpdate(source, normalizedData, existingExtMsg, downloadedAttachments);
    }

    if (existingExtMsg && isDeskChannel) {
      const existingEmail =
        source.sourceType === 'ozonetel' &&
        existingExtMsg.entityType === ExternalEntityType.EMAIL &&
        existingExtMsg.entityId
          ? await this.emailRepo.findById(existingExtMsg.entityId)
          : await this.emailRepo.findByExternalMessageIdAndChannel(
              normalizedData.externalId,
              source.channelId,
            );
      if (existingEmail) {
        if (normalizedData.emailData?.updateExisting) {
          await emailService.updateExternalInteraction({
            emailId: existingEmail.id,
            subject: normalizedData.emailData.subject ?? existingEmail.subject,
            body: normalizedData.content,
            from: normalizedData.emailData.from ?? existingEmail.from,
            externalThreadId: normalizedData.externalThreadId,
            externalMessageId: normalizedData.externalId,
            sentByUserId:
              normalizedData.emailData.sentByUserId ?? existingEmail.sentByUserId,
            type: (normalizedData.emailData.type ?? existingEmail.type) as EmailType,
            rating: normalizedData.emailData.rating ?? existingEmail.rating,
            clientVersionName:
              normalizedData.emailData.clientVersionName ?? existingEmail.clientVersionName,
            clientVersionCode:
              normalizedData.emailData.clientVersionCode ?? existingEmail.clientVersionCode,
            syncTicket: normalizedData.emailData.syncTicketOnUpdate,
            updatedBy: source.ownerUserId,
          });
        }
        if (adapter.postprocess) {
          await adapter.postprocess({
            conversationId: existingEmail.conversationId,
            entityId: existingEmail.id,
            sourceId: source.id,
            normalizedData,
          });
        }
        return {
          success: true,
          conversationId: existingEmail.conversationId,
          entityId: existingEmail.id,
          action: "duplicate",
          isNew: false,
        };
      }
    }

    // 4. Find or create conversation
    const { conversation, message, email, isNew, blocked, blockedReason } =
      await this.findOrCreateConversation(
        source,
        normalizedData,
        downloadedAttachments,
        isDeskChannel
      );

    if (blocked) {
      logger.warn(`Ingestion skipped (${blockedReason ?? 'unknown'}) for source ${sourceName}`, {
        externalThreadId: normalizedData.externalThreadId,
        externalId: normalizedData.externalId,
        blockedReason,
      });
      return {
        success: true,
        conversationId: '',
        entityId: '',
        action: 'created',
        isNew: false,
      };
    }

    const resolvedEntityId = isDeskChannel ? email?.id : message?.messageId ;

    if (!conversation || (!isDeskChannel && !message) || (isDeskChannel && !email) || !resolvedEntityId) {
      throw new Error('Failed to create or find conversation');
    }

    logger.info(`Using conversation ${conversation.conversationId}, isNew: ${isNew}`);

    // 5. Create ExternalMessage tracking record
    if (!existingExtMsg) {
      await this.externalMessageRepo.create({
        externalSourceId: source.id,
        externalId: normalizedData.externalId,
        externalThreadId: normalizedData.externalThreadId,
        entityId: resolvedEntityId,
        direction: MessageDirection.INCOMING,
        entityType: isDeskChannel ? ExternalEntityType.EMAIL : ExternalEntityType.MESSAGE,
      });
    }

    // Call adapter's postprocess hook if available (adapter decides when to process)
    if (adapter.postprocess) {
      await adapter.postprocess({
        conversationId: conversation.conversationId,
        entityId: resolvedEntityId,
        sourceId: source.id,
        normalizedData,
      });
    }

    logger.info(`Successfully ingested data from ${sourceName}`, {
      externalId: normalizedData.externalId,
      channelId: source.channelId,
      isNew,
    });

    return {
      success: true,
      conversationId: conversation.conversationId,
      entityId: resolvedEntityId,
      action: 'created',
      isNew,
    };
  }

  private async resolveDlChannels(
    source: ExternalSource,
    normalizedData: NormalizedData,
  ): Promise<string[]> {
    const workspaceId = source.workspaceId;
    if (source.sourceType === 'ozonetel') {
      const channelId =
        typeof normalizedData.metadata.ozonetelChannelId === 'string'
          ? normalizedData.metadata.ozonetelChannelId.trim()
          : '';
      if (!channelId) return [];

      const channel = await this.channelRepo.findById(channelId);
      return channel?.workspaceId === workspaceId && channel.type === ChannelType.CALL
        ? [channelId]
        : [];
    }

    if (this.channelEmailAliasService.isChannelEmailSourceType(source.sourceType)) {
      const inboundRecipients = normalizedData.emailData?.to ?? [];
      const taggedChannelId = this.channelEmailAliasService.extractChannelIdFromRecipients(
        inboundRecipients,
        source.displayName,
      );
      if (!taggedChannelId) {
        logger.info('[CHANNEL_EMAIL_ROUTE] Dropping inbound: missing +ch_ recipient tag', {
          sourceName: source.name,
          workspaceId,
          inboundRecipients,
        });
        return [];
      }

      const channel = await this.channelRepo.findById(taggedChannelId);
      if (channel && channel.workspaceId === workspaceId) {
        logger.info('[CHANNEL_EMAIL_ROUTE] Routed inbound alias to channel', {
          sourceName: source.name,
          workspaceId,
          taggedChannelId,
          inboundRecipients,
        });
        return [taggedChannelId];
      }

      logger.warn('[CHANNEL_EMAIL_ROUTE] Ignoring invalid or missing channel alias target', {
        sourceName: source.name,
        workspaceId,
        taggedChannelId,
        inboundRecipients,
      });
      return [];
    }

    const addrs = collectDlCandidates(normalizedData.emailData ?? {});
    if (addrs.length === 0) {
      logger.info(`[DL_ROUTE] Dropping inbound: no from/to/cc addresses`, {
        sourceName: source.name,
        workspaceId,
      });
      return [];
    }

    const matches = await db.emailChannelPreference.findMany({
      where: { workspaceId, dlEmail: { in: addrs, mode: 'insensitive' } },
      select: { channelId: true, dlEmail: true },
    });
    if (matches.length === 0) {
      logger.info(`[DL_ROUTE] Dropping inbound: no desk for from/to/cc`, {
        sourceName: source.name,
        workspaceId,
        addrs,
        externalId: normalizedData.externalId,
        externalThreadId: normalizedData.externalThreadId,
      });
      return [];
    }

    logger.info(`[DL_ROUTE] Matched DL to ${matches.length} desk(s) via from/to/cc`, {
      sourceName: source.name,
      dlEmails: matches.map(m => m.dlEmail),
      channelIds: matches.map(m => m.channelId),
    });
    return matches.map(m => m.channelId);
  }

  /**
   * Find existing conversation or create new one with initial message
   */
  private async findOrCreateConversation(
    source: ExternalSource,
    normalizedData: NormalizedData,
    downloadedAttachments: DownloadedAttachment[],
    isDeskChannel: boolean
  ) {

    if (!source.channelId) {
      throw new Error(`External source ${source.name} does not have a channel binding`);
    }

    const channel = await this.channelRepo.findById(source.channelId);
    const channelDisplayName = channel?.name;

    // For desk channels, check exact duplicate for this channel first
    // before any cross-desk ExternalMessage lookups.
    if (isDeskChannel && normalizedData.emailData) {
      const existingEmail = await this.emailRepo.findByExternalMessageIdAndChannel(
        normalizedData.externalId,
        source.channelId,
      );
      if (existingEmail) {
        const conversation = await this.conversationRepo.findById(existingEmail.conversationId);
        if (conversation) {
          return { conversation, message: undefined, email: existingEmail, isNew: false };
        }
      }
    }

    // Keep merge scoped to the configured external source. All providers share
    // this logic, but one source must not merge into another source's tickets.

    const isChannelEmail = this.channelEmailAliasService.isChannelEmailSourceType(source.sourceType);
    // Channel emails always create a new conversation — no thread merging even
    // for replies.
    const existingExtMsg = isChannelEmail
      ? null
      : await this.externalMessageRepo.findByThreadId(
          source.id,
          normalizedData.externalThreadId,
          isDeskChannel ? ExternalEntityType.EMAIL : ExternalEntityType.MESSAGE
        );

    if (existingExtMsg && !isDeskChannel) {
      const messageRepo = await this.messageRepo.findById(existingExtMsg.messageId);
      const conversationid = messageRepo?.conversationId || "";

      const conversation = await this.conversationRepo.findById(conversationid);

      if (!conversation) {
        throw new Error(`Conversation ${conversationid} not found`);
      }


      // Create reply message

      logger.info(`Converting ${downloadedAttachments.length} downloaded attachments to uploaded format`);
      const uploadedFiles = AttachmentConversionService.convertDownloadedToUploaded(downloadedAttachments);
      logger.info(`Converted to ${uploadedFiles.length} uploaded files`);
        const messageContent = normalizedData.content;
        const senderId = await this.resolveChannelMessageSenderId(source);
        const channelEmailMetadata = buildChannelEmailMessageMetadata(
          normalizedData,
          channelDisplayName,
        );

      if (isDeskChannel) {
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
          emailReplyTo: normalizedData.emailData.replyTo || [],
          externalThreadId: normalizedData.externalThreadId,
          externalMessageId: normalizedData.externalId,
          rfcMessageId: normalizedData.rfcMessageId,
          uploadedFiles: uploadedFiles,
          receivedAt: normalizedData.metadata.timestamp,
          ...this.getEmailIntegrationFields(normalizedData),
        });
        return { conversation, message: undefined, email, isNew: false };
      } else {
        const { message } = await conversationService.addMessageToConversation({
          conversationId: conversation.conversationId,
          userId: senderId,
          content: messageContent,
          msgType: MessageType.BOT,
          uploadedFiles: uploadedFiles,
          metadata: {
            externalSource: source.name,
            externalAuthor: normalizedData.author,
            eventType: normalizedData.metadata.eventType,
            ticketNumber: normalizedData.metadata.ticketNumber,
            webUrl: normalizedData.metadata.webUrl,
            ...(channelEmailMetadata ?? {}),
        },
          isBot: true,
        });
        return { conversation, message, email: undefined, isNew: false };
      }
    }

    if (isDeskChannel && normalizedData.emailData) {
      const threadEmail = await this.emailRepo.findFirstByThreadAndChannel(
        normalizedData.externalThreadId,
        source.channelId,
      );
      if (threadEmail) {
        const conversation = await this.conversationRepo.findById(threadEmail.conversationId);
        if (conversation) {
          logger.info('[EMAIL_THREAD_FOUND] Existing thread matched by externalThreadId', {
            conversationId: conversation.conversationId,
            externalThreadId: normalizedData.externalThreadId,
            channelId: source.channelId,
          });

          const uploadedFilesForThread =
            AttachmentConversionService.convertDownloadedToUploaded(downloadedAttachments);

          const { email } = await emailService.addEmailToConversation({
            conversationId: conversation.conversationId,
            emailSubject: normalizedData.emailData.subject || '',
            emailBody: normalizedData.content,
            emailTo: normalizedData.emailData.to || [],
            emailFrom: normalizedData.emailData.from || '',
            emailCc: normalizedData.emailData.cc || [],
            emailBcc: normalizedData.emailData.bcc || [],
            emailReplyTo: normalizedData.emailData.replyTo || [],
            externalThreadId: normalizedData.externalThreadId,
            externalMessageId: normalizedData.externalId,
            rfcMessageId: normalizedData.rfcMessageId,
            uploadedFiles: uploadedFilesForThread,
            receivedAt: normalizedData.metadata.timestamp,
            ...this.getEmailIntegrationFields(normalizedData),
          });

          return { conversation, email, isNew: false };
        }
      }
    }

    // Cross-mailbox thread lookup via RFC References/In-Reply-To.
    // When externalThreadId differs across mailboxes (e.g. DL member sync),
    // match by RFC Message-ID because it is stable across mailboxes.
    if (isDeskChannel && !existingExtMsg && normalizedData.referencedMessageIds?.length && normalizedData.emailData) {
      const refMatch = await this.emailRepo.findByRfcMessageIds(
        source.channelId!,
        normalizedData.referencedMessageIds,
      );
      if (refMatch) {
        const parentThreadEmail = await this.emailRepo.findFirstByThreadAndChannel(
          refMatch.externalThreadId,
          source.channelId!,
        );
        if (parentThreadEmail?.subject !== normalizedData.emailData.subject) {
          logger.info('[RFC_REFS_SUBJECT_MISMATCH] Skipping RFC merge, parent thread subject does not match', {
            externalThreadId: refMatch.externalThreadId,
            parentSubject: parentThreadEmail?.subject,
            newSubject: normalizedData.emailData.subject,
            channelId: source.channelId,
          });
        }
        const conversation = parentThreadEmail?.subject === normalizedData.emailData.subject
          ? await this.conversationRepo.findById(refMatch.conversationId)
          : null;
        if (conversation) {
          logger.info('[RFC_REFS_THREAD_FOUND] Cross-mailbox thread matched via References header', {
            conversationId: conversation.conversationId,
            matchedRefs: normalizedData.referencedMessageIds.length,
            channelId: source.channelId,
          });

          const uploadedFilesForRefs =
            AttachmentConversionService.convertDownloadedToUploaded(downloadedAttachments);

          const { email } = await emailService.addEmailToConversation({
            conversationId: conversation.conversationId,
            emailSubject: normalizedData.emailData.subject || '',
            emailBody: normalizedData.content,
            emailTo: normalizedData.emailData.to || [],
            emailFrom: normalizedData.emailData.from || '',
            emailCc: normalizedData.emailData.cc || [],
            emailBcc: normalizedData.emailData.bcc || [],
            emailReplyTo: normalizedData.emailData.replyTo || [],
            externalThreadId: normalizedData.externalThreadId,
            externalMessageId: normalizedData.externalId,
            rfcMessageId: normalizedData.rfcMessageId,
            uploadedFiles: uploadedFilesForRefs,
            receivedAt: normalizedData.metadata.timestamp,
            ...this.getEmailIntegrationFields(normalizedData),
          });

          return { conversation, email, isNew: false };
        }
      }
    }

    // For email channels, check Vespa for duplicate conversation
    // This handles cases where tickets were created manually (not via Zoho)
    // Vespa duplicate detection only for email channels (not Slack — no subject-based merging)
    // Gated by per-inbox setting — only runs when auto-merge is enabled for this channel.
    const isSlackSource = normalizedData.metadata.source === 'slack';
    const isEmailMergeEnabled = (isDeskChannel && !isSlackSource)
      ? ((await this.emailChannelPreferenceRepo.findByChannelId(source.channelId))?.emailMergeMode === EmailMergeMode.ENABLED)
      : false;
    if (isDeskChannel && !isSlackSource && normalizedData.emailData && isEmailMergeEnabled) {
      logger.info(`[EMAIL_DUPLICATE_CHECK] Checking Vespa for duplicate email`, {
        channelId: source.channelId,
        emailFrom: normalizedData.emailData.from,
        emailSubject: normalizedData.emailData.subject,
      });

      const duplicateCheckEmailFrom = normalizedData.emailData.replyTo?.[0] || normalizedData.emailData.from || "";
      const duplicateCheck = await findDuplicateEmailConversation(
        source.channelId,
        duplicateCheckEmailFrom,
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
          emailReplyTo: normalizedData.emailData.replyTo || [],
          externalThreadId: normalizedData.externalThreadId,
          externalMessageId: normalizedData.externalId,
          rfcMessageId: normalizedData.rfcMessageId,
          uploadedFiles: uploadedFiles,
          receivedAt: normalizedData.metadata.timestamp,
          ...this.getEmailIntegrationFields(normalizedData),
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
    logger.info(`Creating new conversation in channel ${source.channelId}`);
    logger.info(`Converting ${downloadedAttachments.length} downloaded attachments to uploaded format for new conversation`);
    const uploadedFiles = AttachmentConversionService.convertDownloadedToUploaded(downloadedAttachments);
    logger.info(`Converted to ${uploadedFiles.length} uploaded files for new conversation`);

    if (isDeskChannel) {
      if (!normalizedData.emailData || !normalizedData.emailData.from ) {
        throw new Error(
          'Missing required email fields in normalizedData. Required: subject, body, to, from'
        );
      }

      // Fetch ownerUserId from EmailChannelPreference instead of deprecated ExternalSource.ownerUserId
      let userId = source.displayName; // Fallback to displayName
      if (source.channelId) {
        const preference = await this.emailChannelPreferenceRepo.findByChannelId(source.channelId);
        if (preference?.ownerUserId) {
          userId = preference.ownerUserId;
        }
      }

      const creatorUserId = normalizedData.creatorUserId?.trim();
      if (channel?.type === ChannelType.CALL && creatorUserId && channel.workspaceId) {
        const creator = await db.user.findFirst({
          where: { id: creatorUserId, workspaceId: channel.workspaceId },
          select: { id: true },
        });
        if (creator) {
          userId = creator.id;
        } else {
          logger.warn('Ignoring invalid external creator user', {
            sourceName: source.name,
            channelId: source.channelId,
            creatorUserId,
          });
        }
      }

      const createResult = await emailService.createConversationWithEmail({
        channelId: source.channelId,
        boardId: source.boardId || undefined, // @deprecated - boardId now fetched from EmailChannelPreference table. Kept for backward compatibility.
        userId,
        emailSubject: normalizedData.emailData.subject || "",
        emailBody: normalizedData.content,
        emailTo: normalizedData.emailData.to || [],
        emailFrom: normalizedData.emailData.from,
        emailCc: normalizedData.emailData.cc,
        emailBcc: normalizedData.emailData.bcc,
        emailReplyTo: normalizedData.emailData.replyTo,
        externalThreadId: normalizedData.externalThreadId,
        externalMessageId: normalizedData.externalId,
        rfcMessageId: normalizedData.rfcMessageId,
        ticketMetadata: normalizedData.metadata,
        uploadedFiles: uploadedFiles,
        receivedAt: normalizedData.metadata.timestamp,
        ...this.getEmailIntegrationFields(normalizedData),
      });
      if ((createResult as any)?.isDuplicate) {
        return {
          conversation: undefined,
          message: undefined,
          email: undefined,
          isNew: false,
          blocked: true,
          blockedReason: 'duplicate',
        };
      }
      const { conversation, email } = createResult as any;
      return { conversation, email, isNew: true };
    } else {
      const messageContent = normalizedData.content;
      const senderId = await this.resolveChannelMessageSenderId(source);
      const channelEmailMetadata = buildChannelEmailMessageMetadata(
        normalizedData,
        channelDisplayName,
      );
      const { conversation, message } = await conversationService.createConversationWithMessage({
        channelId: source.channelId,
        userId: senderId,
        content: messageContent,
        msgType: MessageType.BOT,
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
          ...(channelEmailMetadata ?? {}),
        },
        isBot: true,
      });
      return { conversation, message, isNew: true };
    }
  }

  private getEmailIntegrationFields(normalizedData: NormalizedData) {
    const emailData = normalizedData.emailData;
    return {
      emailType: emailData?.type ?? EmailType.DEFAULT,
      sentByUserId: emailData?.sentByUserId,
      rating: emailData?.rating,
      clientVersionName: emailData?.clientVersionName,
      clientVersionCode: emailData?.clientVersionCode,
    };
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
