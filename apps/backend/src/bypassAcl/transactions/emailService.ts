import { EmailType, BaseTicketType, ExternalEntityType, MessageDirection, TicketPriority } from '@xyne/shared';
import { UploadedFileResult } from '@/services/fileUploadService';
import { Prisma } from '@prisma/client';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { logger } from '@/utils/logger';
import { normalizeRfcMessageId } from '@/utils/emailRfcMessageId';
import { syncTicketEmailCount } from '@/database/syncTicketEmailCount';
import { advanceLastEmailAt } from '@/database/ticketLastEmailAt';
import { EmailService, derivePriorityFromSubject, SUBJECT_PREFIX_REGEX, UpdateExternalInteractionParams } from '@/services/emailService';
import { transaction } from '../base';
import type { Conversation } from '@prisma/client';
import type { ExternalSourceLink } from '@/services/emailService';
import { generateTicketId } from '@/bypassAcl/transactions/ticketIdService';
export function updateExternalInteractionTx(self: EmailService, emailChanged: boolean, params: UpdateExternalInteractionParams, currentEmail: any, currentTicket: any, ticketChanged: boolean) {
  return transaction(['Conversation', 'Email', 'Ticket'], 'updateExternalInteraction: email update plus ticket update and conversation md sync must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
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
}
export function createConversationWithEmailTx(self: EmailService, channelId: string, userId: string, channel: any, receivedAt: Date | undefined, emailType: EmailType, emailSubject: string, emailBody: string, emailTo: string[], emailFrom: string, emailCc: string[], emailBcc: string[], emailReplyTo: string[], externalThreadId: string, externalMessageId: string, sentByUserId: string | undefined, normalizedRfcMessageId: string | undefined, rating: number | undefined, clientVersionName: string | undefined, clientVersionCode: string | undefined, externalSourceId: string | undefined, projectId: any, boardId: any, firstStage: any, slaResolutionDue: Date | null, userGroup: any, groupId: any, ticketMetadata: Record<string, unknown> | undefined) {
  return transaction(['ChannelUserStatus', 'Conversation', 'Email', 'ExternalMessage', 'Project', 'Ticket'], 'createConversationWithEmail: conversation, email, ticket and unread-count writes must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
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

    // Generate xyneId and create ticket
    const xyneId = await generateTicketId(tx, projectId);
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
  });
}
export function addEmailToConversationTx(self: EmailService, emailData: { createdAt?: Date | undefined; type: EmailType; subject: string; body: string; to: string[]; from: string; cc: string[]; bcc: string[]; replyTo: string[]; conversationId: string; channelId: any; externalThreadId: string; externalMessageId: string; rfcMessageId: string | null | undefined; sentByUserId: string | undefined; rating: number | undefined; clientVersionName: string | undefined; clientVersionCode: string | undefined; }, externalMessageId: string, externalThreadId: string, externalSourceId: string) {
  return transaction(['Channel', 'Email', 'ExternalMessage', 'Ticket'], 'addEmailToConversation: email insert plus external-message link must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    const created = await self.emailRepository.create(emailData, tx);
    await linkExternalMessageInTx(tx, { externalId: externalMessageId, externalThreadId, externalSourceId }, created.id, created.workspaceId);
    return created;
  });
}
export function createConversationFromEmailTx(self: EmailService, projectId: string, emailSubject: string, emailBody: string, userId: string, conversation: Conversation, channelId: string, channel: any, boardId: string, stageName: string, ticketPriority: TicketPriority, slaResolutionDue: Date | null, userGroupId: string | undefined, ticketMetadata: Record<string, unknown> | undefined) {
  return transaction(['Project', 'Ticket'], 'createConversationFromEmail: ticket id sequence plus ticket insert must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    // Generate xyneId using project-scoped format
    const xyneId = await generateTicketId(tx, projectId);

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
}

export async function ingestEmailThreadTx(boardId: string | undefined, channelId: string, userId: string, channel: any, firstEmail: { externalMessageId: string; rfcMessageId?: string | null; subject: string; body: string; from: string; to: string[]; cc?: string[]; bcc?: string[]; replyTo?: string[]; receivedAt: Date; type?: EmailType; uploadedFiles?: UploadedFileResult[]; }, projectId: string | undefined, ingestSlaResolutionDue: Date | null, groupId: string | null, ticketMetadata: Record<string, unknown> | undefined, existingFirstEmail: any, refsMatchEmail: { conversationId: string; externalThreadId: string; } | null, externalThreadId: string, vespaMatchConversationId: string | null, emailRows: { createdAt: Date; id: string; type: EmailType; subject: string; body: string; to: string[]; from: string; cc: string[]; bcc: string[]; replyTo: string[]; channelId: string; externalThreadId: string; externalMessageId: string; rfcMessageId: string | undefined; }[], externalSourceId: string, emails: { externalMessageId: string; rfcMessageId?: string | null; subject: string; body: string; from: string; to: string[]; cc?: string[]; bcc?: string[]; replyTo?: string[]; receivedAt: Date; type?: EmailType; uploadedFiles?: UploadedFileResult[]; }[], self: EmailService) {
  const result = await transaction(['Board', 'ChannelUserStatus', 'Conversation', 'Email', 'EmailRead', 'ExternalMessage', 'Message', 'Project', 'Stage', 'StageTransition', 'Ticket', 'TicketStageEta'], 'ingestEmailThread: conversation, ticket, email and external-message writes must commit atomically; tx is not ACL-wrapped', self.prisma, async tx => {
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

      const xyneId = await generateTicketId(tx, projectId!);
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
        await advanceLastEmailAt(tx, { ticketId }, latestReceived);
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
  });
  return { result, vespaMatchConversationId };
}

/**
 * Write the ExternalMessage link row inside an existing transaction.
 *
 * The (externalSourceId, externalId) pair being already linked means the same
 * app re-posted an id it already linked — that is a no-op, not an error.
 * `createMany` + `skipDuplicates` covers the concurrent-repost race without
 * raising P2002, which would poison the surrounding interactive transaction.
 */
export async function linkExternalMessageInTx(
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
