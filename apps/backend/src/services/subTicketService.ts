import { Prisma } from '@prisma/client';
import { ActivityType, BoardType, MessageType } from '@xyne/shared';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { recordTicketTimelineEvent } from '@/services/ticketTimelineEventService';
import {
  syncConversationSubTicketsMd,
  linkSubTicketConversationToParent,
} from '@/utils/ticketMd';

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
    select: { id: true, conversationId: true, workspaceId: true, board: { select: { boardType: true } } },
  });
  if (!parent) {
    throw new Error(`Parent ticket "${input.parentTicketId}" not found`);
  }

  // Normal boards retain the historical one-level sub-ticket limit. FLOW is
  // the sole override because its materialized run graph can be arbitrarily deep.
  if (parent.board.boardType !== BoardType.FLOW) {
    const parentAsSubTicket = await db.subTicket.findFirst({
      where: { mappedTicketId: parent.id },
      select: { id: true },
    });
    if (parentAsSubTicket) {
      throw new Error(
        `Cannot create a sub-ticket under a sub-ticket. Parent ticket ${parent.id} is already a sub-ticket.`,
      );
    }
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

const FLOW_MAPPING_NAMESPACE = 'f34ae343-9aa8-5bcb-8f52-6ea8304435d1';

/**
 * Materialize one FLOW child under every effective parent. One SubTicket row
 * represents the mapped child; TicketSubTicketMapping carries the many-parent
 * relationship. Deterministic ids make cascade retries idempotent.
 */
export async function createFlowSubTicketMappings(input: {
  parentTicketIds: string[];
  mappedTicketId: string;
  rootTicketId: string;
  title: string;
  description?: string | null;
  createdBy: string;
  assignedTo?: string | null;
  subTicketXyneId?: string | null;
  timestamp?: Date;
}): Promise<CreateSubTicketResult> {
  const parentTicketIds = [...new Set(input.parentTicketIds)];
  if (parentTicketIds.length === 0) {
    throw new Error('A Flow sub-ticket requires at least one parent');
  }
  const [parents, child] = await Promise.all([
    db.ticket.findMany({
      where: { id: { in: parentTicketIds } },
      select: {
        id: true,
        boardId: true,
        workspaceId: true,
        conversationId: true,
        metadata: true,
        board: { select: { boardType: true } },
      },
    }),
    db.ticket.findUnique({
      where: { id: input.mappedTicketId },
      select: { id: true, boardId: true, metadata: true },
    }),
  ]);
  if (!child || parents.length !== parentTicketIds.length) {
    throw new Error('Flow child or one of its parents was not found');
  }
  const childFlow = (child.metadata as { flow?: { rootTicketId?: string } } | null)?.flow;
  if (childFlow?.rootTicketId !== input.rootTicketId) {
    throw new Error('Flow child does not belong to the requested run');
  }
  for (const parent of parents) {
    const parentFlow = (parent.metadata as { flow?: { rootTicketId?: string } } | null)?.flow;
    const parentRootTicketId = parentFlow?.rootTicketId ?? parent.id;
    if (
      parent.board.boardType !== BoardType.FLOW ||
      parent.boardId !== child.boardId ||
      parentRootTicketId !== input.rootTicketId
    ) {
      throw new Error('Flow multi-parent mappings must stay within one board run');
    }
  }

  const now = input.timestamp ?? new Date();
  const subTicketId = uuidv5(
    `flow-subticket:${input.rootTicketId}:${input.mappedTicketId}`,
    FLOW_MAPPING_NAMESPACE,
  );
  const primaryParent = parents[0]!;

  await db.$transaction(async tx => {
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

  return {
    subTicketId,
    mappingId: uuidv5(`flow-mapping:${primaryParent.id}:${subTicketId}`, FLOW_MAPPING_NAMESPACE),
    parentTicketId: primaryParent.id,
    conversationId: primaryParent.conversationId,
  };
}
