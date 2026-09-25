import { transaction } from '../base';
import { db } from '@/database/client';
import { CreateSubTicketInput, FLOW_MAPPING_NAMESPACE } from '@/services/subTicketService';
import { recordTicketTimelineEvent } from '@/services/ticketTimelineEventService';
import { syncConversationSubTicketsMd, linkSubTicketConversationToParent } from '@/utils/ticketMd';
import { Prisma } from '@prisma/client';
import { ActivityType, MessageType } from '@xyne/shared';
import { v5 as uuidv5 } from 'uuid';


export function createSubTicketTx(subTicketId: string, input: CreateSubTicketInput, parent: any, now: Date, mappingId: string) {
  return transaction(['SubTicket', 'TicketSubTicketMapping'], 'createSubTicket: the sub-ticket row and its parent mapping must commit together; tx is not ACL-wrapped', db, async (tx: Prisma.TransactionClient) => {
    await tx.subTicket.create({
      data: {
        id: subTicketId,
        title: input.title,
        description: input.description ?? null,
        mappedTicketId: input.mappedTicketId ?? null,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
        conversationId: parent.conversationId,
        workspaceId: parent.workspaceId,
        assignedTo: input.assignedTo ?? null,
        createdAt: now,
        updatedAt: now,
      },
    });

    await tx.ticketSubTicketMapping.create({
      data: { id: mappingId, ticketId: parent.id, subTicketId, workspaceId: parent.workspaceId },
    });

    if (input.mappedTicketId) {
      await syncConversationSubTicketsMd(tx, parent.id);
      await linkSubTicketConversationToParent(tx, input.mappedTicketId, parent.id);
    }

    const displayId = input.subTicketXyneId ?? subTicketId.slice(0, 8).toUpperCase();
    await recordTicketTimelineEvent(
      {
        activity: {
          ticketId: parent.id,
          updatedBy: input.createdBy,
          activityType: ActivityType.SUBTICKET_CREATED,
          workspaceId: parent.workspaceId,
          value: {
            subTicketId,
            subTicketTitle: input.title,
            subTicketXyneId: input.subTicketXyneId ?? null,
          },
          timestamp: now,
        },
        message: parent.conversationId
          ? {
              conversationId: parent.conversationId,
              senderId: input.createdBy,
              content: `Subticket ${displayId} created: ${input.title}`,
              activityType: ActivityType.SUBTICKET_CREATED,
              workspaceId: parent.workspaceId,
              createdAt: now,
            }
          : undefined,
      },
      tx,
    );
  });
}
export function createFlowSubTicketMappingsTx(subTicketId: string, input: { parentTicketIds: string[]; mappedTicketId: string; rootTicketId: string; title: string; description?: string | null; createdBy: string; assignedTo?: string | null; subTicketXyneId?: string | null; timestamp?: Date; }, primaryParent: any, now: Date, parents: any) {
  return transaction(['Message', 'SubTicket', 'TicketActivity', 'TicketSubTicketMapping'], 'createFlowSubTicketMappings: upserts the flow sub-ticket and a mapping, activity and message per parent ticket atomically; tx is not ACL-wrapped', db, async tx => {
    await tx.subTicket.upsert({
      where: { id: subTicketId },
      create: {
        id: subTicketId,
        title: input.title,
        description: input.description ?? null,
        mappedTicketId: input.mappedTicketId,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
        conversationId: primaryParent.conversationId,
        workspaceId: primaryParent.workspaceId,
        assignedTo: input.assignedTo ?? null,
        createdAt: now,
        updatedAt: now,
      },
      update: {},
    });

    for (const parent of parents) {
      const mappingId = uuidv5(`flow-mapping:${parent.id}:${subTicketId}`, FLOW_MAPPING_NAMESPACE);
      const activityId = uuidv5(`flow-mapping-activity:${mappingId}`, FLOW_MAPPING_NAMESPACE);
      const messageId = uuidv5(`flow-mapping-message:${mappingId}`, FLOW_MAPPING_NAMESPACE);
      // Upserts avoid concurrent find/create P2002 failures and make retries idempotent.
      await tx.ticketSubTicketMapping.upsert({
        where: { id: mappingId },
        create: {
          id: mappingId,
          workspaceId: parent.workspaceId,
          ticketId: parent.id,
          subTicketId,
        },
        update: {},
      });
      await tx.ticketActivity.upsert({
        where: { id: activityId },
        create: {
          id: activityId,
          workspaceId: parent.workspaceId,
          ticketId: parent.id,
          activityType: ActivityType.SUBTICKET_CREATED,
          updatedBy: input.createdBy,
          timestamp: now,
          value: {
            subTicketId,
            subTicketTitle: input.title,
            subTicketXyneId: input.subTicketXyneId ?? null,
          },
        },
        update: {},
      });
      if (parent.conversationId) {
        const displayId = input.subTicketXyneId ?? subTicketId.slice(0, 8).toUpperCase();
        await tx.message.upsert({
          where: { messageId },
          create: {
            messageId,
            conversationId: parent.conversationId,
            workspaceId: parent.workspaceId,
            senderId: input.createdBy,
            content: `Subticket ${displayId} created: ${input.title}`,
            msgType: MessageType.SYSTEM,
            hasAttachment: false,
            edited: false,
            isDeleted: false,
            isSent: true,
            showInChannel: false,
            createdAt: now,
            metadata: { activityType: ActivityType.SUBTICKET_CREATED, isTicketActivity: true },
          },
          update: {},
        });
      }
    }

    for (const parent of parents) {
      await syncConversationSubTicketsMd(tx, parent.id);
    }
    await linkSubTicketConversationToParent(tx, input.mappedTicketId, primaryParent.id);
  });
}
