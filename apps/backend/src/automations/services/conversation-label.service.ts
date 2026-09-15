import { Prisma } from '@prisma/client';
import { MailboxState } from '@xyne/shared';
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

type LabelDatabaseClient = typeof db | Prisma.TransactionClient;

/**
 * Failures that mean "this thread is no longer labelable" rather than "the apply
 * broke". Callers skip the row and keep going. Shared by the automation step and
 * the backfill so a rule replayed over history behaves like the live rule did.
 */
export const SKIPPABLE_LABEL_ERROR_CODES = new Set([
  'channel_not_found',
  'label_not_found',
  'label_id_mismatch',
  'conversation_not_found',
  'conversation_channel_mismatch',
  'conversation_workspace_mismatch',
  'ticket_not_found',
  'ticket_channel_mismatch',
  'ticket_workspace_mismatch',
]);

export async function archiveConversationMailbox(
  input: ArchiveConversationMailboxInput,
  client: LabelDatabaseClient = db,
): Promise<void> {
  const ticket = await client.ticket.findFirst({
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

  const existing = await client.ticketUserMailbox.findUnique({
    where: { ticketId_userId: { ticketId: ticket.id, userId: input.userId } },
    select: { state: true },
  });
  if (existing?.state === MailboxState.ARCHIVED) return;

  const now = new Date();
  await client.ticketUserMailbox.upsert({
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
  client: LabelDatabaseClient = db,
): Promise<ApplyConversationLabelResult> {
  const labelName = input.labelName.trim();
  const conversationId = input.conversationId.trim();
  const channelId = input.channelId.trim();
  const createdById = input.createdById;

  const channel = await client.channel.findUnique({
    where: { id: channelId },
    select: { id: true, projectId: true, workspaceId: true },
  });
  if (!channel) {
    throw Object.assign(new Error('Channel not found'), { code: 'channel_not_found' as const });
  }

  const conversation = await client.conversation.findUnique({
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
  const requestedLabelId = input.labelId?.trim();
  const requestedLabel = requestedLabelId
    ? await client.conversationLabel.findUnique({
        where: { id: requestedLabelId },
        select: {
          id: true,
          name: true,
          channelId: true,
          workspaceId: true,
          createdBy: true,
        },
      })
    : null;

  if (
    requestedLabel &&
    (requestedLabel.name !== labelName ||
      requestedLabel.channelId !== channelId ||
      requestedLabel.workspaceId !== channel.workspaceId ||
      requestedLabel.createdBy !== createdById)
  ) {
    throw Object.assign(new Error('Label does not belong to the requested owner and desk'), {
      code: 'label_id_mismatch' as const,
    });
  }

  // Only reuse a caller-provided ID after validating the existing catalog row.
  // Stale/nonexistent IDs get a server-generated ID instead of controlling a PK.
  const catalogLabelId = requestedLabel?.id ?? uuidv4();

  const label = await client.conversationLabel.upsert({
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

  const existingMapping = await client.conversationLabelMapping.findUnique({
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
    await client.conversationLabelMapping.create({
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
