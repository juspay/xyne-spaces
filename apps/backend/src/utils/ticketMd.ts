import type { PrismaClient, Ticket as PrismaTicket } from '@prisma/client';
import {
  serializeTicketMd,
  serializeSubTicketsMd,
  serializeParentMessageMd,
  parseParentMessageMd,
  resolveConversationAnchorType,
  buildTicketCardSummary,
  SUB_TICKETS_MD_LIMIT,
} from '@xyne/shared';
import type { TicketCardSummary, ParentMessageSummary } from '@xyne/shared';

type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export const syncConversationTicketMdFromPrismaTicket = async (
  tx: PrismaTransaction,
  ticket: PrismaTicket,
  overrides: Partial<TicketCardSummary> = {},
): Promise<void> => {
  if (!ticket.conversationId) return;

  const summary: TicketCardSummary = {
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
    ...overrides,
  };

  const ticketMd = serializeTicketMd(summary);
  if (!ticketMd) return;

  const conversation = await tx.conversation.findUnique({
    where: { conversationId: ticket.conversationId },
    select: { ticket_md: true },
  });

  if (!conversation) return;
  if (conversation.ticket_md === ticketMd) return;

  await tx.conversation.update({
    where: { conversationId: ticket.conversationId },
    data: { ticket_md: ticketMd },
  });

  await syncParentConversationsSubTicketsMd(tx, ticket.id);

  const childMappings = await tx.ticketSubTicketMapping.findMany({
    where: { ticketId: ticket.id },
    select: { subTicket: { select: { mappedTicketId: true } } },
  });
  for (const mapping of childMappings) {
    const childTicketId = mapping.subTicket?.mappedTicketId;
    if (childTicketId && childTicketId !== ticket.id) {
      await linkSubTicketConversationToParent(tx, childTicketId, ticket.id);
    }
  }
};

export const syncConversationSubTicketsMd = async (
  tx: PrismaTransaction,
  parentTicketId: string,
): Promise<void> => {
  const parent = await tx.ticket.findUnique({
    where: { id: parentTicketId },
    select: { conversationId: true },
  });
  if (!parent?.conversationId) return;

  const mappings = await tx.ticketSubTicketMapping.findMany({
    where: { ticketId: parentTicketId },
    select: { subTicket: { select: { mappedTicketId: true } } },
  });
  const mappedTicketIds = mappings
    .map((mapping) => mapping.subTicket?.mappedTicketId)
    .filter((id): id is string => Boolean(id) && id !== parentTicketId);

  const [children, totalChildren] = await Promise.all([
    tx.ticket.findMany({
      where: { id: { in: mappedTicketIds } },
      orderBy: { createdAt: 'asc' },
      take: SUB_TICKETS_MD_LIMIT,
    }),
    tx.ticket.count({ where: { id: { in: mappedTicketIds } } }),
  ]);
  const summaries = children.map((child) =>
    buildTicketCardSummary({
      id: child.id,
      title: child.title,
      description: null,
      statusV2: child.statusV2 as TicketCardSummary['statusV2'],
      priority: child.priority as TicketCardSummary['priority'],
      assignedTo: child.assignedTo ?? null,
      createdBy: child.createdBy,
      createdAt: child.createdAt,
      eta: child.eta,
      xyneId: child.xyneId,
      stageName: child.stageName,
      ticketType: child.ticketType ?? null,
      channelId: child.channelId,
      conversationId: child.conversationId,
    })
  );

  const subTicketsMd = serializeSubTicketsMd(totalChildren, summaries);

  const conversation = await tx.conversation.findUnique({
    where: { conversationId: parent.conversationId },
    select: { sub_tickets_md: true },
  });
  if (!conversation) return;
  if ((conversation.sub_tickets_md ?? null) === subTicketsMd) return;

  await tx.conversation.update({
    where: { conversationId: parent.conversationId },
    data: { sub_tickets_md: subTicketsMd },
  });
};

export const writeConversationAnchor = async (
  tx: PrismaTransaction,
  conversationId: string,
  summary: ParentMessageSummary,
): Promise<void> => {
  const conversation = await tx.conversation.findUnique({
    where: { conversationId },
    select: { parent_message_md: true },
  });
  if (!conversation) return;

  const existing = parseParentMessageMd(conversation.parent_message_md);
  if (
    existing &&
    resolveConversationAnchorType(existing) !== resolveConversationAnchorType(summary)
  ) {
    return;
  }

  const anchorMd = serializeParentMessageMd(summary);
  if (!anchorMd) return;
  if (conversation.parent_message_md === anchorMd) return;

  await tx.conversation.update({
    where: { conversationId },
    data: {
      parentMessageId: summary.messageId,
      parent_message_md: anchorMd,
    },
  });
};

export const linkSubTicketConversationToParent = async (
  tx: PrismaTransaction,
  childTicketId: string,
  parentTicketId: string,
): Promise<void> => {
  const child = await tx.ticket.findUnique({
    where: { id: childTicketId },
    select: { conversationId: true },
  });
  if (!child?.conversationId) return;

  const parent = await tx.ticket.findUnique({
    where: { id: parentTicketId },
    select: {
      conversationId: true,
      channelId: true,
      xyneId: true,
      title: true,
      createdBy: true,
      createdAt: true,
    },
  });
  if (!parent?.conversationId) return;

  const parentConversation = await tx.conversation.findUnique({
    where: { conversationId: parent.conversationId },
    select: { initialMessageId: true },
  });
  if (!parentConversation) return;

  await writeConversationAnchor(tx, child.conversationId, {
    messageId: parentConversation.initialMessageId,
    conversationId: parent.conversationId,
    channelId: parent.channelId,
    senderId: parent.createdBy,
    content: `${parent.xyneId} · ${parent.title}`,
    msgType: 'SYSTEM' as ParentMessageSummary['msgType'],
    createdAt: parent.createdAt.getTime(),
    anchorType: 'SUBTICKET',
  });
};

export const syncParentConversationsSubTicketsMd = async (
  tx: PrismaTransaction,
  childTicketId: string,
): Promise<void> => {
  const subTicketRows = await tx.subTicket.findMany({
    where: { mappedTicketId: childTicketId },
    select: { ticketMappings: { select: { ticketId: true } } },
  });

  const parentTicketIds = new Set<string>();
  for (const row of subTicketRows) {
    for (const mapping of row.ticketMappings) {
      if (mapping.ticketId !== childTicketId) parentTicketIds.add(mapping.ticketId);
    }
  }

  for (const parentTicketId of parentTicketIds) {
    await syncConversationSubTicketsMd(tx, parentTicketId);
  }

  const [firstParentTicketId] = parentTicketIds;
  if (firstParentTicketId) {
    await linkSubTicketConversationToParent(tx, childTicketId, firstParentTicketId);
  }
};
