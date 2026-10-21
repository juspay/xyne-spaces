import { transaction } from '../base';
import { conversationService } from '@/services/conversationService';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { BitbotTicket } from '@/migration/slack/slackJiraffeService';
import { syncConversationTicketMdFromPrismaTicket } from '@/utils/ticketMd';
import { MessageDirection, ExternalEntityType } from '@xyne/shared';
import { PrismaClient } from '@prisma/client';
import { generateTicketId } from '@/bypassAcl/transactions/ticketIdService';


export function ingestTicketTx(db: PrismaClient, boardProjectId: any, channelRepo: ChannelRepository, channelId: string, titleText: string, description: string, userId: string, conversation: Awaited<ReturnType<typeof conversationService.createConversationWithMessage>>, boardId: string, resolvedUserGroupId: string | undefined, resolvedStageName: string, resolvedStatusV2: any, assignedToUserId: string | undefined, ticket: BitbotTicket, externalSource: any) {
  return transaction(['Conversation', 'ExternalMessage', 'Message', 'Ticket'], 'ingestTicket: allocates the ticket id and creates the ticket, its conversation link and the external message together so a failure leaves no half-ingested Jira ticket; tx is not ACL-wrapped', db, async (tx) => {
    const xyneId = await generateTicketId(tx, boardProjectId);
    const channel = await channelRepo.findById(channelId);

    const newTicket = await tx.ticket.create({
      data: {
        title: titleText,
        description: description,
        createdBy: userId,
        updatedBy: userId,
        conversationId: conversation.conversation.conversationId,
        channelId: channelId,
        projectId: boardProjectId,
        workspaceId: channel?.workspaceId ?? '',
        boardId: boardId,
        ...(resolvedUserGroupId && { userGroupId: resolvedUserGroupId }),
        stageName: resolvedStageName,
        statusV2: resolvedStatusV2,
        xyneId: xyneId,
        ...(assignedToUserId && { assignedTo: assignedToUserId }),
        ...(ticket.eta && { eta: new Date(ticket.eta) }),
        createdAt: new Date(ticket.created_at),
        lastEmailAt: new Date(ticket.created_at),
      },
    });

    await syncConversationTicketMdFromPrismaTicket(tx, newTicket);

    // Update conversation to link it to the ticket
    await tx.conversation.update({
      where: { conversationId: conversation.conversation.conversationId },
      data: { ticketId: newTicket.id },
    });

    await tx.message.update({
      where: { messageId: conversation.message.messageId },
      data: {
        metadata: {
          ticketId: newTicket.id,
        },
      },
    });

    // Create external message tracking record
    await tx.externalMessage.createMany({
      data: [
        {
          externalSourceId: externalSource.id,
          workspaceId: newTicket.workspaceId,
          externalId: ticket.id,
          externalThreadId: ticket.slack_thread_ts,
          messageId: '',
          entityId: newTicket.id,
          direction: MessageDirection.INCOMING,
          entityType: ExternalEntityType.TICKET,
        },
        {
          externalSourceId: externalSource.id,
          workspaceId: newTicket.workspaceId,
          externalId: ticket.slack_thread_ts,
          externalThreadId: ticket.slack_thread_ts,
          messageId: '',
          entityId: conversation.message.messageId,
          direction: MessageDirection.INCOMING,
          entityType: ExternalEntityType.MESSAGE,
        },
      ],
    });

    return newTicket;
  });
}
