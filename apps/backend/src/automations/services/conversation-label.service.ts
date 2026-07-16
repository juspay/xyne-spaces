import { MailboxState } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';

export interface ApplyConversationLabelInput {
  conversationId: string;
  channelId: string;
  labelName: string;
  createdById: string;
  color?: string | undefined;
  labelId?: string | undefined;
}

export interface ApplyConversationLabelResult {
  conversationId: string;
  channelId: string;
  labelId: string;
  labelName: string;
  applied: boolean;
  alreadyPresent: boolean;
}

interface ArchiveConversationMailboxInput {
  conversationId: string;
  channelId: string;
  workspaceId: string;
  userId: string;
}

export async function archiveConversationMailbox(
  input: ArchiveConversationMailboxInput,
): Promise<void> {
  const ticket = await db.ticket.findFirst({
    where: { conversationId: input.conversationId },
    select: { id: true, channelId: true, workspaceId: true },
  });
  if (!ticket) {
    throw Object.assign(new Error('Ticket not found'), { code: 'ticket_not_found' as const });
  }
  if (ticket.channelId !== input.channelId) {
    throw Object.assign(new Error('Ticket does not belong to the requested desk channel'), {
      code: 'ticket_channel_mismatch' as const,
    });
  }
  if (ticket.workspaceId !== input.workspaceId) {
    throw Object.assign(new Error('Ticket workspace does not match the automation workspace'), {
      code: 'ticket_workspace_mismatch' as const,
    });
  }

  const existing = await db.ticketUserMailbox.findUnique({
    where: { ticketId_userId: { ticketId: ticket.id, userId: input.userId } },
    select: { state: true },
  });
  if (existing?.state === MailboxState.ARCHIVED) return;

  const now = new Date();
  await db.ticketUserMailbox.upsert({
    where: { ticketId_userId: { ticketId: ticket.id, userId: input.userId } },
    create: {
      id: uuidv4(),
      ticketId: ticket.id,
      userId: input.userId,
      channelId: input.channelId,
      workspaceId: input.workspaceId,
      state: MailboxState.ARCHIVED,
      starred: false,
      createdAt: now,
      updatedAt: now,
    },
    update: { state: MailboxState.ARCHIVED, updatedAt: now },
  });
}

/**
 * Idempotent apply of a private conversation label (catalog + mapping).
 * Safe under concurrent automation / mutator races via Prisma upserts.
 */
export async function applyConversationLabel(
  input: ApplyConversationLabelInput,
): Promise<ApplyConversationLabelResult> {
  const labelName = input.labelName.trim();
  const conversationId = input.conversationId.trim();
  const channelId = input.channelId.trim();
  const createdById = input.createdById;

  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { id: true, projectId: true, workspaceId: true },
  });
  if (!channel) {
    throw Object.assign(new Error('Channel not found'), { code: 'channel_not_found' as const });
  }

  const conversation = await db.conversation.findUnique({
    where: { conversationId },
    select: { conversationId: true, channelId: true, workspaceId: true },
  });
  if (!conversation) {
    throw Object.assign(new Error('Conversation not found'), {
      code: 'conversation_not_found' as const,
    });
  }
  if (conversation.channelId !== channelId) {
    throw Object.assign(
      new Error('Conversation does not belong to the requested desk channel'),
      { code: 'conversation_channel_mismatch' as const },
    );
  }
  if (
    conversation.workspaceId != null &&
    conversation.workspaceId !== channel.workspaceId
  ) {
    throw Object.assign(new Error('Conversation workspace does not match channel'), {
      code: 'conversation_workspace_mismatch' as const,
    });
  }

  const now = new Date();
  const catalogLabelId = input.labelId?.trim() || uuidv4();

  const label = await db.conversationLabel.upsert({
    where: {
      channelId_createdBy_name: {
        channelId,
        createdBy: createdById,
        name: labelName,
      },
    },
    create: {
      id: catalogLabelId,
      name: labelName,
      ...(input.color ? { color: input.color } : {}),
      channelId,
      projectId: channel.projectId,
      workspaceId: channel.workspaceId,
      createdBy: createdById,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      // Keep existing catalog row; only refresh updatedAt so concurrent creates stay unique.
      updatedAt: now,
    },
    select: { id: true },
  });

  const existingMapping = await db.conversationLabelMapping.findUnique({
    where: {
      conversationId_labelId: {
        conversationId,
        labelId: label.id,
      },
    },
    select: { id: true },
  });

  if (existingMapping) {
    return {
      conversationId,
      channelId,
      labelId: label.id,
      labelName,
      applied: false,
      alreadyPresent: true,
    };
  }

  try {
    await db.conversationLabelMapping.create({
      data: {
        id: uuidv4(),
        labelId: label.id,
        labelName,
        conversationId,
        channelId,
        workspaceId: channel.workspaceId,
        createdBy: createdById,
        createdAt: now,
      },
    });
  } catch (err) {
    // Concurrent insert on the unique (conversationId, labelId) — treat as already present.
    const code = (err as { code?: string } | null)?.code;
    if (code === 'P2002') {
      logger.info(
        `[conversation-label] concurrent apply race conversationId=${conversationId} label=${labelName}`,
      );
      return {
        conversationId,
        channelId,
        labelId: label.id,
        labelName,
        applied: false,
        alreadyPresent: true,
      };
    }
    throw err;
  }

  return {
    conversationId,
    channelId,
    labelId: label.id,
    labelName,
    applied: true,
    alreadyPresent: false,
  };
}
