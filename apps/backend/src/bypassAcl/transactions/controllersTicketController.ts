import { transaction } from '../base';
import { MessageAttachment } from '@prisma/client';
import { Ticket } from '@prisma/client';
import { prismaClient } from '@/apps/controllers/ticketController';
import { resolveInheritedOwner, linkCreatedEntities } from '@/sdlc/entityLinkService';
import { TicketController, prisma } from '@/controllers/ticketController';
import { resolveStepEstimate, evaluateEta, isTerminalStatus, buildEtaActivityIntents, writeEtaActivitiesPrisma } from '@/services/etaManagement';
import { loadBoardEtaContext } from '@/bypassAcl/transactions/prismaContext';
import { syncStageOverdueFlag } from '@/services/tickets/syncStageOverdueFlag';
import { calculateETADeadline } from '@/utils/etaCalculation';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { Prisma } from '@prisma/client';
import { TicketStatusV2, parseTicketEtaManagement, mergeTicketEtaManagement, TicketPriority, MessageType, ConversationParticipation, type TicketCardSummary, serializeTicketMd, BoardType, AttachmentEntityType, TicketReferenceRelation, ActivityType } from '@xyne/shared';
import { randomUUID } from 'crypto';
import { generateKeyBetween } from 'fractional-indexing';
import type { FormFieldChanges } from '@/automations/triggers/ticket-updated.trigger';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { CreateMessageAttachmentInput } from '@/database/repositories/messageAttachmentRepository';
import { messageClassificationQueue } from '@/queues/messageClassificationQueue';
import { UploadedFileResult } from '@/services/fileUploadService';
import { messageMetadataService } from '@/services/messageMetadataService';
import { logger } from '@/utils/logger';
import { generateTicketId } from '@/bypassAcl/transactions/ticketIdService';
import { lockTicketMetadataAndEta } from '@/bypassAcl/rowLockServices';


export function transferTicketToBoardTx(targetBoardId: string, ticketId: string, now: Date, updatedBy: string, currentTicket: any, systemActorId: string) {
  return transaction(['Board', 'Conversation', 'Stage', 'StageTransition', 'Ticket', 'TicketActivity', 'TicketStageEta', 'TicketSubTicketMapping'], 'transferTicketToBoard: board transfer, ETA ledger reset, ETA evaluation and markdown sync must commit atomically; tx is not ACL-wrapped', prismaClient, async tx => {
    const newBoardStages = await tx.stage.findMany({
      where: { boardId: targetBoardId },
      orderBy: { sequenceNumber: 'asc' },
    });

    if (newBoardStages.length === 0) {
      throw new Error(`No stages found for board ${targetBoardId}`);
    }

    const firstStage = newBoardStages[0];

    const firstTicketInStage = await tx.ticket.findFirst({
      where: {
        boardId: targetBoardId,
        stageName: firstStage.name,
        kanbanPosition: { not: null },
      },
      orderBy: { kanbanPosition: 'asc' },
      select: { kanbanPosition: true },
    });

    let kanbanPosition: string;
    try {
      kanbanPosition = generateKeyBetween(null, firstTicketInStage?.kanbanPosition ?? null);
    } catch {
      kanbanPosition = generateKeyBetween(null, null);
    }

    // `eta` is deliberately left out of this base update - an automatic due date is only
    // ever set by the domain-service evaluation below, and only when the target board has
    // opted into automatic ETA management (never a blind stage-eta sum, and never a write
    // that can shorten the ticket's existing due date).
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        boardId: targetBoardId,
        stageName: firstStage.name,
        statusV2: firstStage.defaultTicketStatusV2 ?? undefined,
        kanbanPosition,
        updatedAt: now,
        updatedBy,
      },
    });

    await tx.ticketStageEta.deleteMany({ where: { ticketId } });

    let newStageEtaEntryId: string | null = null;
    let stageEtaDeadline: Date | null = null;
    if (firstStage.eta !== null && firstStage.eta > 0) {
      stageEtaDeadline = calculateETADeadline(now, firstStage.eta);
      const newStageEtaEntry = await tx.ticketStageEta.create({
        data: {
          ticketId,
          stageId: firstStage.id,
          stageEnteredAt: now,
          stageLeftAt: null,
          stageEta: stageEtaDeadline,
          updatedBy,
          workspaceId: currentTicket.workspaceId,
        },
        select: { id: true },
      });
      newStageEtaEntryId = newStageEtaEntry.id;
    }

    await syncStageOverdueFlag(tx, ticketId, now);
    // ETA domain-service evaluation: forecast (extend-only) + planning-risk state, mirroring
    // the pattern already used by TicketRepository.updateTicketStage and the Zero
    // ticket.update board-transfer branch.
    const effectiveStatusV2 = (firstStage.defaultTicketStatusV2 ?? currentTicket.statusV2) as TicketStatusV2;
    // metadata AND eta were both read before this transaction opened, so a concurrent write
    // (e.g. acknowledgeEtaRisk, or a manual due-date edit) landing before ours would be lost.
    // FOR UPDATE locks the row so that can't happen. Both locked values feed evaluateEta:
    // eta is the extend-only baseline and a fingerprint input, so a stale one could decide
    // against - and then overwrite - a due date someone else just moved.
    const lockedTicket = await lockTicketMetadataAndEta(tx, ticketId);
    const lockedEta = lockedTicket?.eta ?? null;
    const boardEtaCtx = await loadBoardEtaContext(tx, targetBoardId);
    const currentTicketEtaManagement = parseTicketEtaManagement(lockedTicket?.metadata);
    const stepEstimate = resolveStepEstimate(
      { id: firstStage.id, eta: firstStage.eta },
      null,
      { requireExplicitTransition: false },
    );

    const etaResult = evaluateEta({
      ticketId,
      ticketStatus: effectiveStatusV2,
      isTerminal: isTerminalStatus(effectiveStatusV2),
      currentTicketEta: lockedEta,
      currentTicketEtaManagement,
      boardType: boardEtaCtx.boardType,
      boardEtaManagement: boardEtaCtx.boardEtaManagement,
      currentStageId: firstStage.id,
      stages: boardEtaCtx.stages,
      transitions: boardEtaCtx.transitions,
      activeVisit: {
        stageVisitId: newStageEtaEntryId,
        transitionId: null,
        deadline: stageEtaDeadline,
        deadlineTracked: newStageEtaEntryId !== null,
        estimateSource: stepEstimate.source,
        estimateHours: stepEstimate.incomplete ? null : stepEstimate.hours,
      },
      trigger: 'STAGE_TRANSITION',
      now,
    });

    const mergedMetadata = mergeTicketEtaManagement(
      lockedTicket?.metadata,
      etaResult.ticketEtaManagementPatch,
    );

    const updatedTicket = await tx.ticket.update({
      where: { id: ticketId },
      data: {
        ...(etaResult.etaDecision.changed && etaResult.etaDecision.newEta
          ? { eta: etaResult.etaDecision.newEta }
          : {}),
        metadata: mergedMetadata as Prisma.InputJsonValue,
      },
    });

    const activityIntents = buildEtaActivityIntents(etaResult, {
      currentStageId: firstStage.id,
      oldEta: lockedEta ? lockedEta.getTime() : null,
      trigger: 'STAGE_TRANSITION',
      systemReason: `Automatic recalculation after moving ticket to board "${targetBoardId}"`,
      previousRiskFingerprint: currentTicketEtaManagement.planningRisk.fingerprint,
    });
    await writeEtaActivitiesPrisma(tx, activityIntents, {
      ticketId,
      workspaceId: currentTicket.workspaceId,
      channelId: currentTicket.channelId,
      timestamp: now.getTime(),
      systemActorId,
    });

    await syncConversationTicketMdFromPrismaTicket(tx, updatedTicket);

    return { updatedTicket, etaResult };
  });
}
export function createTicketWithConversationTx(self: TicketController, conversationId: string, projectId: string, title: string, description: string, createdBy: string, updatedBy: string, assignedTo: string | undefined, boardId: string, statusV2: string, priority: string, messageContent: string | undefined, messageSubtype: string, metadata: Record<string, any>, entityLinkContext: { sourceId: string; sourceType: "CANVAS" | "ATTACHMENT" | "TRACK" | "FOLDER" | "LINK"; } | undefined) {
  return transaction(['Board', 'Conversation', 'ConversationParticipant', 'Message', 'Project', 'SdlcEntityLink', 'Stage', 'StageTransition', 'Ticket', 'TicketActivity', 'TicketStageEta'], 'createTicketWithConversation: ticket, system message, conversation link and entity links must commit atomically; tx is not ACL-wrapped', prisma, async (tx) => {
    // Get channelId from conversation
    const conversation = await self.conversationRepository.findById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }
    const channelId = conversation.channelId;

    // Get workspaceId from channel
    const channelWorkspaceId = await self.channelRepository.getWorkspaceId(channelId);

    // Generate xyneId using project-scoped format
    const xyneId = await generateTicketId(tx, projectId);

    const creationMessageId = randomUUID();

    // Create ticket
    const ticket = await self.ticketRepository.createTicket({
      title,
      description,
      sourceMessageId: creationMessageId,
      createdBy,
      updatedBy,
      assignedTo: assignedTo || undefined,
      conversationId,
      channelId,
      projectId,
      workspaceId: channelWorkspaceId,
      boardId,
      statusV2: statusV2 as TicketStatusV2,
      priority: priority.toUpperCase() as TicketPriority,
      xyneId,
    }, tx);

    // Post ticket notification as SYSTEM message in conversation
    const now = new Date();
    await tx.message.create({
      data: {
        messageId: creationMessageId,
        conversationId,
        senderId: createdBy,
        workspaceId: channelWorkspaceId,
        content: messageContent || `Ticket created: ${title}`,
        msgType: MessageType.SYSTEM,
        showInChannel: false,
        metadata: {
          messageSubtype,
          ticketId: ticket.id,
          xyneId: ticket.xyneId,
          isAiGenerated: true,
          ...metadata,
        },
      },
    });

    // Update conversation reply count and set ticketId
    await tx.conversation.update({
      where: { conversationId },
      data: {
        replyCount: { increment: 1 },
        lastActivityAt: now,
        ticketId: ticket.id,
      },
    });

    // Update lastReplyAt on all participants (denormalized for userConversationsPaginatedV2)
    await tx.conversationParticipant.updateMany({
      where: { conversationId },
      data: { lastReplyAt: now },
    });

    // Add/update ticket creator as MENTIONED participant (subscribed by default)
    await tx.conversationParticipant.upsert({
      where: {
        conversationId_userId: {
          conversationId,
          userId: createdBy,
        },
      },
      create: {
        id: randomUUID(),
        conversationId,
        userId: createdBy,
        workspaceId: channelWorkspaceId,
        participationType: ConversationParticipation.MENTIONED,
        isSubscribed: true,
        joinedAt: now,
        channelId,
      },
      update: {
        participationType: ConversationParticipation.MENTIONED,
        isSubscribed: true,
      },
    });

    const linkOwner = entityLinkContext ?? (await resolveInheritedOwner(tx, conversationId));
    if (linkOwner) {
      await linkCreatedEntities(
        tx,
        { owner: linkOwner, channelId, conversationId, ticketId: ticket.id },
        { workspaceId: channelWorkspaceId, userId: createdBy },
      );
    }

    await self.channelRepository.updateLastActivity(channelId);

    return ticket;
  });
}
export function createTicketTx(projectId: string, sourceConversationId: string | undefined, validatedConversation: any, self: TicketController, requestedTicketId: string | undefined, title: string, description: string, userId: string, finalAssignedTo: string | undefined, userGroupId: string | undefined, boardId: string, effectiveStatusV2: TicketStatusV2, priority: TicketPriority | undefined, eta: Date | undefined, metadata: Record<string, unknown> | undefined, closedAt: Date | undefined, closedBy: string | undefined, merchantId: string | undefined, sourceMessageId: string | undefined, effectiveTicketType: string | undefined, effectiveStageName: string | undefined, dynamicFields: Record<string, string | string[]>, formFieldChangesForEmit: FormFieldChanges | undefined, channelId: string | undefined, excludedChatAttachmentIds: string[] | undefined, entityLinkOwner: { sourceId: string; sourceType: "CANVAS" | "ATTACHMENT" | "TRACK" | "FOLDER" | "LINK"; } | undefined, fromTicketsTab: boolean, initialMessageId: `${string}-${string}-${string}-${string}-${string}`, board: { name: string; boardType: BoardType; projectId: string; } | null, uploadedFiles: UploadedFileResult[], draftAttachmentIds: string[] | undefined) {
  return transaction(['Board', 'Channel', 'Conversation', 'ConversationParticipant', 'MessageAttachment', 'Project', 'SdlcEntityLink', 'Stage', 'StageTransition', 'Ticket', 'TicketActivity', 'TicketStageEta'], 'createTicket: ticket, conversation, participant, attachment and entity-link writes must commit atomically; tx is not ACL-wrapped', prisma, async (tx) => {
    // Generate xyneId using project-scoped format
    const xyneId = await generateTicketId(tx, projectId);

    let conversationId: string;
    let ticket: Ticket;

    if (sourceConversationId) {
      const existingConversation = validatedConversation;
      // Conversation existence already validated before transaction

      conversationId = existingConversation.conversationId;
      const channelIdFromConversation = existingConversation.channelId;
      const existingConversationWorkspaceId = await self.channelRepository.getWorkspaceId(channelIdFromConversation);

      ticket = await self.ticketRepository.createTicket({
        ...(requestedTicketId && { id: requestedTicketId }),
        title,
        description,
        createdBy: userId,
        updatedBy: userId,
        assignedTo: finalAssignedTo,
        conversationId,
        channelId: channelIdFromConversation,
        projectId,
        workspaceId: existingConversationWorkspaceId,
        userGroupId,
        boardId,
        statusV2: effectiveStatusV2,
        priority,
        eta,
        metadata,
        closedAt,
        closedBy,
        merchantId,
        xyneId,
        sourceMessageId: sourceMessageId ?? existingConversation.initialMessageId ?? undefined,
        ticketType: effectiveTicketType,
        stageName: effectiveStageName,
        dynamicFields: dynamicFields as Record<string, string>,
        formFieldChanges: formFieldChangesForEmit,
      }, tx);

      const ticketMd = serializeTicketMd({
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        statusV2: ticket.statusV2 as TicketCardSummary['statusV2'],
        priority: ticket.priority as TicketCardSummary['priority'],
        assignedTo: ticket.assignedTo ?? null,
        createdBy: ticket.createdBy,
        createdAt: ticket.createdAt.getTime(),
        eta: ticket.eta ? ticket.eta.getTime() : null,
        xyneId: ticket.xyneId,
        stageName: ticket.stageName,
        ticketType: ticket.ticketType ?? null,
        channelId: ticket.channelId,
        conversationId: ticket.conversationId,
      });

      // Update conversation with ticketId and ticket_md
      await tx.conversation.update({
        where: { conversationId: existingConversation.conversationId },
        data: { ticketId: ticket.id, ticket_md: ticketMd },
      });


      // Add/update ticket creator as MENTIONED participant (subscribed by default)
      await db.conversationParticipant.upsert({
        where: {
          conversationId_userId: {
            conversationId,
            userId,
          },
        },
        create: {
          id: randomUUID(),
          conversationId,
          userId,
          workspaceId: existingConversationWorkspaceId,
          participationType: ConversationParticipation.MENTIONED,
          isSubscribed: true,
          joinedAt: new Date(),
          channelId,
        },
        update: {
          participationType: ConversationParticipation.MENTIONED,
          isSubscribed: true,
        },
      });

      if (existingConversation.initialMessageId) {
        const initialMessage = await self.messageRepository.findById(existingConversation.initialMessageId);

        if (initialMessage) {
          const existingMetadata = (initialMessage.metadata as Record<string, unknown>) || {};
          await self.messageRepository.update(existingConversation.initialMessageId, {
            metadata: {
              ...existingMetadata,
              ticketId: ticket.id,
            },
          });
        }
      }

      // Get existing CHAT attachments from the FIRST MESSAGE ONLY and convert them to TICKET attachments (excluding any that user chose to exclude)
      let existingChatAttachments: MessageAttachment[] = [];

      if (existingConversation.initialMessageId) {
        // Only get attachments from the initial/first message of the conversation
        existingChatAttachments = await self.messageAttachmentRepository.findByMessageId(
          existingConversation.initialMessageId
        );
      }

      // Filter out excluded attachments
      const attachmentsToConvert = existingChatAttachments.filter(attachment =>
        !(excludedChatAttachmentIds || []).includes(attachment.id)
      );

      // Update existing CHAT attachments to TICKET attachments (atomic operation)
      if (attachmentsToConvert.length > 0) {
        const attachmentIdsToConvert = attachmentsToConvert.map(attachment => attachment.id);
        await self.messageAttachmentRepository.updateManyEntityTypeAndId(
          attachmentIdsToConvert,
          AttachmentEntityType.TICKET,
          ticket.id
        );
      }

      // If there were any excluded attachments, they remain as CHAT attachments
      // (they won't be deleted since the conversation still exists)

      const linkOwner =
        entityLinkOwner ?? (await resolveInheritedOwner(tx, conversationId));
      if (linkOwner) {
        await linkCreatedEntities(
          tx,
          {
            owner: linkOwner,
            channelId: channelIdFromConversation,
            conversationId,
            ticketId: ticket.id,
          },
          { workspaceId: existingConversationWorkspaceId, userId },
        );
      }
    } else {
      let doNotPostToChannel = false;
      if (fromTicketsTab) {
        const channelSetting = await tx.channel.findUnique({
          where: { id: channelId! },
          select: { showTicketsTabTicketsInChat: true },
        });
        doNotPostToChannel = channelSetting?.showTicketsTabTicketsInChat === false;
      }
      const conversation = await self.conversationRepository.create({
        channelId: channelId!,
        createdBy: userId,
        initialMessageId,
        doNotPostToChannel,
      });

      conversationId = conversation.conversationId;

      const newConversationWorkspaceId = await self.channelRepository.getWorkspaceId(channelId!);

      ticket = await self.ticketRepository.createTicket({
        ...(requestedTicketId && { id: requestedTicketId }),
        title,
        description,
        createdBy: userId,
        updatedBy: userId,
        assignedTo: finalAssignedTo,
        conversationId,
        channelId: channelId!,
        projectId,
        workspaceId: newConversationWorkspaceId,
        userGroupId,
        boardId,
        statusV2: effectiveStatusV2,
        priority,
        eta,
        metadata,
        closedAt,
        closedBy,
        merchantId,
        xyneId,
        sourceMessageId: sourceMessageId ?? initialMessageId,
        ticketType: effectiveTicketType,
        stageName: effectiveStageName,
        dynamicFields: dynamicFields as Record<string, string>,
        formFieldChanges: formFieldChangesForEmit,
      }, tx);

      await self.messageRepository.createWithExecutionId({
        conversationId,
        senderId: userId,
        content: `Ticket created in ${board?.name || 'Unknown Board'}: ${title}`,
        msgType: MessageType.SYSTEM,
        metadata: { ticketId: ticket.id },
      }, initialMessageId);
      await messageMetadataService.syncInitialMessageMd(conversationId);

      // Ticket creation writes its message through Prisma, not a Zero mutator, so the
      // vespa-injection handler that normally triggers classification never fires here.
      // The thread has no user messages yet — the classifier reads the ticket instead.
      void messageClassificationQueue.enqueueForMessage(conversationId);

      const ticketMd = serializeTicketMd({
        id: ticket.id,
        title: ticket.title,
        description: ticket.description,
        statusV2: ticket.statusV2 as TicketCardSummary['statusV2'],
        priority: ticket.priority as TicketCardSummary['priority'],
        assignedTo: ticket.assignedTo ?? null,
        createdBy: ticket.createdBy,
        createdAt: ticket.createdAt.getTime(),
        eta: ticket.eta ? ticket.eta.getTime() : null,
        xyneId: ticket.xyneId,
        stageName: ticket.stageName,
        ticketType: ticket.ticketType ?? null,
        channelId: ticket.channelId,
        conversationId: ticket.conversationId,
      });

      // Update conversation with ticketId and ticket_md
      await tx.conversation.update({
        where: { conversationId },
        data: { ticketId: ticket.id, ticket_md: ticketMd },
      });

      // Add ticket creator as MENTIONED participant (subscribed by default)
      await tx.conversationParticipant.upsert({
        where: {
          conversationId_userId: {
            conversationId,
            userId: userId,
          },
        },
        create: {
          id: randomUUID(),
          conversationId,
          userId: userId,
          workspaceId: newConversationWorkspaceId,
          participationType: ConversationParticipation.MENTIONED,
          isSubscribed: true,
          joinedAt: new Date(),
          channelId: ticket.channelId,
        },
        update: {
          participationType: ConversationParticipation.MENTIONED,
          isSubscribed: true,
        },
      });

      let newConversationLinkOwner = entityLinkOwner;
      if (!newConversationLinkOwner && sourceMessageId) {
        const stampSourceMessage = await self.messageRepository.findById(sourceMessageId);
        if (stampSourceMessage?.conversationId) {
          newConversationLinkOwner = (await resolveInheritedOwner(
            tx,
            stampSourceMessage.conversationId,
          )) ?? undefined;
        }
      }
      if (newConversationLinkOwner) {
        await linkCreatedEntities(
          tx,
          {
            owner: newConversationLinkOwner,
            channelId: channelId!,
            conversationId,
            ticketId: ticket.id,
          },
          { workspaceId: newConversationWorkspaceId, userId },
        );
      }
    }

    // Get workspaceId from channel for attachments
    const ticketChannelWorkspaceId = channelId
      ? await self.channelRepository.getWorkspaceId(channelId)
      : '';

    // Create attachment records for uploaded files (inside transaction)
    if (uploadedFiles.length > 0) {
      const attachmentData: CreateMessageAttachmentInput[] = uploadedFiles.map(file => ({
        entityId: ticket.id,
        entityType: AttachmentEntityType.TICKET,
        originalFilename: file.originalName,
        size: file.fileSize,
        mimetype: file.mimeType,
        url: file.fileUrl,
        thumbnailUrl: file.thumbnailUrl ?? undefined,
        width: file.width,
        height: file.height,
        uploadedByUserId: userId,
        createdBy: userId,
        storageProvider: config.fileStorage.provider,
        conversationId: conversationId,
        workspaceId: ticketChannelWorkspaceId,
        metadata: file.metadata || {},
      }));

      await self.messageAttachmentRepository.createMany(attachmentData);

      // Fetch back to get real IDs for manual Vespa trigger
      const savedAttachments = await self.messageAttachmentRepository.findByEntityIdAndType(ticket.id, AttachmentEntityType.TICKET);
      if (savedAttachments.length > 0) {
        const attachments = savedAttachments.map(a => ({ id: a.id, mimetype: a.mimetype }));
        self.pushVespaJobForAttachments(attachments, userId, ticketChannelWorkspaceId).catch((error: any) => {
          logger.error(`[TicketController] Error pushing Vespa job for ticket attachments ${ticket.id}:`, error);
        });
      }
    }

    // Trigger Vespa job for converted chat attachments
    if (sourceConversationId) {
      // chat attachments were updated to TICKET type, we should re-index them
      const convertedAttachments = await self.messageAttachmentRepository.findByEntityIdAndType(ticket.id, AttachmentEntityType.TICKET);
      if (convertedAttachments.length > 0) {
        const attachments = convertedAttachments.map(a => ({ id: a.id, mimetype: a.mimetype }));
        self.pushVespaJobForAttachments(attachments, userId, ticketChannelWorkspaceId).catch((error: any) => {
          logger.error(`[TicketController] Error pushing Vespa job for converted attachments in ticket ${ticket.id}:`, error);
        });
      }
    }

    // Transfer draft attachments to ticket (if provided)
    if (draftAttachmentIds && draftAttachmentIds.length > 0) {
      // Validate draft attachments exist and belong to the user
      const draftAttachments = await self.messageAttachmentRepository.findByIds(draftAttachmentIds);

      if (draftAttachments.length !== draftAttachmentIds.length) {
        logger.warn(`[Ticket Creation] Some draft attachments not found: requested ${draftAttachmentIds.length}, found ${draftAttachments.length}`);
      }

      // Validate all are DRAFT attachments owned by the user
      const validDraftAttachments = draftAttachments
        .filter((attachment: MessageAttachment) =>
          attachment.entityType === AttachmentEntityType.DRAFT &&
          attachment.uploadedByUserId === userId
        );

      const validDraftAttachmentIds = validDraftAttachments.map(a => a.id);

      // Update draft attachments to ticket attachments
      if (validDraftAttachmentIds.length > 0) {
        await self.messageAttachmentRepository.updateManyEntityTypeAndId(
          validDraftAttachmentIds,
          AttachmentEntityType.TICKET,
          ticket.id
        );

        // Also update conversationId to associate with the new conversation
        await tx.messageAttachment.updateMany({
          where: {
            id: { in: validDraftAttachmentIds },
          },
          data: {
            conversationId: conversationId,
          },
        });

        const draftMessage = await db.draftMessage.findUnique({
          where: {
            id: draftAttachments[0].entityId, // All attachments belong to the same draft message
          },
        });

        if (draftMessage) {
          await db.draftMessage.delete({
            where: {
              id: draftMessage.id,
            },
          });
        }

        logger.info(`[Ticket Creation] Transferred ${validDraftAttachmentIds.length} draft attachments to ticket ${ticket.id}`);

        // Trigger Vespa re-indexing for transferred draft attachments
        const attachments = validDraftAttachments.map(a => ({ id: a.id, mimetype: a.mimetype }));
        self.pushVespaJobForAttachments(attachments, userId!, ticketChannelWorkspaceId).catch((error: any) => {
          logger.error(`[TicketController] Error pushing Vespa job for transferred draft attachments in ticket ${ticket.id}:`, error);
        });
      }
    }

    return { ticket, conversationId };
  });
}
export function mergeTicketTx(ticketId: string, targetTicketId: any, userId: string, source: any, target: any) {
  return transaction(['Ticket', 'TicketActivity', 'TicketReferenceMapping'], 'mergeTicket: merge mapping, source archive and both timeline entries must commit atomically; tx is not ACL-wrapped', prisma, async (tx) => {
    const created = await tx.ticketReferenceMapping.create({
      data: { sourceTicketId: ticketId, targetTicketId, relationType: TicketReferenceRelation.MERGED_INTO, createdBy: userId, workspaceId: source.workspaceId },
    });
    await tx.ticket.update({ where: { id: ticketId }, data: { isArchived: true, updatedBy: userId } });

    await tx.ticketActivity.create({
      data: { ticketId, updatedBy: userId, workspaceId: source.workspaceId, activityType: ActivityType.MERGED, value: { targetTicketId: target.id, targetTicketXyneId: target.xyneId, targetTicketTitle: target.title } },
    });
    await tx.ticketActivity.create({
      data: { ticketId: targetTicketId, updatedBy: userId, workspaceId: target.workspaceId, activityType: ActivityType.MERGED, value: { sourceTicketId: ticketId, sourceTicketXyneId: source.xyneId, sourceTicketTitle: source.title } },
    });

    return created;
  });
}
export function unmergeTicketTx(mapping: any, ticketId: string, userId: string, ticket: any) {
  return transaction(['Ticket', 'TicketActivity', 'TicketReferenceMapping'], 'unmergeTicket: merge-mapping delete, source unarchive and both timeline entries must commit atomically; tx is not ACL-wrapped', prisma, async (tx) => {
    await tx.ticketReferenceMapping.delete({ where: { id: mapping.id } });
    await tx.ticket.update({ where: { id: ticketId }, data: { isArchived: false, updatedBy: userId } });

    await tx.ticketActivity.create({
      data: { ticketId, updatedBy: userId, workspaceId: ticket.workspaceId, activityType: ActivityType.UNMERGED, value: { targetTicketId: mapping.targetTicketId, targetTicketXyneId: mapping.targetTicket.xyneId, targetTicketTitle: mapping.targetTicket.title } },
    });
    await tx.ticketActivity.create({
      data: { ticketId: mapping.targetTicketId, updatedBy: userId, workspaceId: mapping.targetTicket.workspaceId, activityType: ActivityType.UNMERGED, value: { sourceTicketId: ticketId, sourceTicketXyneId: ticket.xyneId, sourceTicketTitle: ticket.title } },
    });
  });
}
