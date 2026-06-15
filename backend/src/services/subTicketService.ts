import { ActivityType, MessageType, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

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

    await tx.ticketActivity.create({
      data: {
        id: uuidv4(),
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
    });

    if (parent.conversationId) {
      const displayId = input.subTicketXyneId ?? subTicketId.slice(0, 8).toUpperCase();
      await tx.message.create({
        data: {
          messageId: uuidv4(),
          conversationId: parent.conversationId,
          ...(parent.workspaceId ? { workspaceId: parent.workspaceId } : {}),
          senderId: input.createdBy,
          content: `Subticket ${displayId} created: ${input.title}`,
          msgType: MessageType.SYSTEM,
          hasAttachment: false,
          edited: false,
          isDeleted: false,
          isSent: true,
          showInChannel: false,
          createdAt: now,
          metadata: {
            activityType: ActivityType.SUBTICKET_CREATED,
            isTicketActivity: true,
          },
        },
      });
    }
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
