import { ActivityType, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { recordTicketTimelineEvent } from '@/services/ticketTimelineEventService';

export interface CreateSubTicketInput {
  parentTicketId: string;
  title: string;
  description?: string | null;
  createdBy: string;
  assignedTo?: string | null;
  subTicketId?: string;
  mappingId?: string;
  mappedTicketId?: string | null;
  subTicketXyneId?: string | null;
  timestamp?: Date;
}

export interface CreateSubTicketResult {
  subTicketId: string;
  mappingId: string;
  parentTicketId: string;
  conversationId: string | null;
}

export async function createSubTicket(
  input: CreateSubTicketInput,
): Promise<CreateSubTicketResult> {
  const subTicketId = input.subTicketId ?? uuidv4();
  const mappingId = input.mappingId ?? uuidv4();
  const now = input.timestamp ?? new Date();

  const parent = await db.ticket.findUnique({
    where: { id: input.parentTicketId },
    select: { id: true, conversationId: true, workspaceId: true },
  });
  if (!parent) {
    throw new Error(`Parent ticket "${input.parentTicketId}" not found`);
  }

  // A ticket that is itself mapped as a subticket cannot have its own subtickets
  const parentAsSubTicket = await db.subTicket.findFirst({
    where: { mappedTicketId: parent.id },
    select: { id: true },
  });
  if (parentAsSubTicket) {
    throw new Error(
      `Cannot create a sub-ticket under a sub-ticket. Parent ticket ${parent.id} is already a sub-ticket.`,
    );
  }

  await db.$transaction(async (tx: Prisma.TransactionClient) => {
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
      data: { id: mappingId, ticketId: parent.id, subTicketId },
    });

    const displayId = input.subTicketXyneId ?? subTicketId.slice(0, 8).toUpperCase();
    await recordTicketTimelineEvent(
      {
        activity: {
          ticketId: parent.id,
          updatedBy: input.createdBy,
          activityType: ActivityType.SUBTICKET_CREATED,
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

  logger.info(
    `[subTicketService] created subTicket=${subTicketId} parent=${parent.id} mapping=${mappingId}`,
  );

  return {
    subTicketId,
    mappingId,
    parentTicketId: parent.id,
    conversationId: parent.conversationId,
  };
}
