import type { TicketCardSummary, ParentMessageSummary } from './activityMetadataParser';
import {
  serializeTicketMd,
  serializeSubTicketsMd,
  serializeParentMessageMd,
  parseParentMessageMd,
  resolveConversationAnchorType,
  SUB_TICKETS_MD_LIMIT,
} from './activityMetadataParser';

export type TicketMdSource = {
  id: string;
  title: string;
  description: string | null;
  statusV2: TicketCardSummary['statusV2'];
  priority: TicketCardSummary['priority'];
  assignedTo: string | null;
  createdBy: string;
  createdAt: number | Date;
  eta: number | Date | null;
  xyneId: string;
  stageName: string | null;
  ticketType: string | null;
  channelId: string | null;
  conversationId: string;
};

const toEpochMs = (value: number | Date | null): number | null => {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.getTime() : value;
};

export const buildTicketCardSummary = (ticket: TicketMdSource): TicketCardSummary => ({
  id: ticket.id,
  title: ticket.title,
  description: ticket.description,
  statusV2: ticket.statusV2,
  priority: ticket.priority,
  assignedTo: ticket.assignedTo ?? null,
  createdBy: ticket.createdBy,
  createdAt: toEpochMs(ticket.createdAt) ?? 0,
  eta: toEpochMs(ticket.eta),
  xyneId: ticket.xyneId,
  stageName: ticket.stageName,
  ticketType: ticket.ticketType ?? null,
  channelId: ticket.channelId ?? '',
  conversationId: ticket.conversationId,
});

export const serializeTicketMdFromTicket = (ticket: TicketMdSource): string | null =>
  serializeTicketMd(buildTicketCardSummary(ticket));

type ZqlLike = any;

type ZeroTicketLike = TicketMdSource;

type ZeroConversationLike = {
  conversationId: string;
  ticket_md: string | null;
};

export async function updateTicketMdFromZero(
  tx: any,
  zql: ZqlLike,
  ticketId: string,
): Promise<void> {
  const ticket = (await tx.run(zql.tickets.where('id', ticketId).one())) as ZeroTicketLike | null;
  if (!ticket?.conversationId) {
    return;
  }

  const ticketMd = serializeTicketMdFromTicket(ticket);
  if (!ticketMd) {
    return;
  }

  const conversation = (await tx.run(
    zql.conversations.where('conversationId', ticket.conversationId).one(),
  )) as ZeroConversationLike | null;
  if (!conversation) {
    return;
  }

  if (conversation.ticket_md === ticketMd) {
    return;
  }

  await tx.mutate.conversations.update({
    conversationId: ticket.conversationId,
    ticket_md: ticketMd,
  });

  await syncTicketRelativesFromZero(tx, zql, ticketId);
}

export async function syncTicketRelativesFromZero(
  tx: any,
  zql: ZqlLike,
  ticketId: string,
): Promise<void> {
  await updateParentSubTicketsMdFromZero(tx, zql, ticketId);

  const childMappings = (await tx.run(
    zql.ticket_sub_ticket_mappings.where('ticketId', ticketId),
  )) as Array<{ subTicketId: string }>;
  for (const mapping of childMappings) {
    const subTicket = (await tx.run(
      zql.sub_tickets.where('id', mapping.subTicketId).one(),
    )) as { mappedTicketId: string | null } | null;
    if (subTicket?.mappedTicketId && subTicket.mappedTicketId !== ticketId) {
      await linkSubTicketConversationToParentFromZero(tx, zql, subTicket.mappedTicketId, ticketId);
    }
  }
}

export async function updateSubTicketsMdFromZero(
  tx: any,
  zql: ZqlLike,
  parentTicketId: string,
): Promise<void> {
  const parent = (await tx.run(
    zql.tickets.where('id', parentTicketId).one(),
  )) as { conversationId: string | null } | null;
  if (!parent?.conversationId) return;

  const mappings = (await tx.run(
    zql.ticket_sub_ticket_mappings.where('ticketId', parentTicketId),
  )) as Array<{ subTicketId: string }>;

  const mappedTicketIds: string[] = [];
  for (const mapping of mappings) {
    const subTicket = (await tx.run(
      zql.sub_tickets.where('id', mapping.subTicketId).one(),
    )) as { mappedTicketId: string | null } | null;
    if (subTicket?.mappedTicketId && subTicket.mappedTicketId !== parentTicketId) {
      mappedTicketIds.push(subTicket.mappedTicketId);
    }
  }

  const children: ZeroTicketLike[] = [];
  for (const childTicketId of mappedTicketIds) {
    const child = (await tx.run(
      zql.tickets.where('id', childTicketId).one(),
    )) as ZeroTicketLike | null;
    if (child?.conversationId) children.push(child);
  }
  children.sort((left, right) => {
    const leftAt = left.createdAt instanceof Date ? left.createdAt.getTime() : left.createdAt;
    const rightAt = right.createdAt instanceof Date ? right.createdAt.getTime() : right.createdAt;
    return leftAt - rightAt;
  });

  const summaries: TicketCardSummary[] = children
    .slice(0, SUB_TICKETS_MD_LIMIT)
    .map((child) => buildTicketCardSummary({ ...child, description: null }));

  const subTicketsMd = serializeSubTicketsMd(children.length, summaries);

  const conversation = (await tx.run(
    zql.conversations.where('conversationId', parent.conversationId).one(),
  )) as { sub_tickets_md?: string | null } | null;
  if (!conversation) return;
  if ((conversation.sub_tickets_md ?? null) === subTicketsMd) return;

  await tx.mutate.conversations.update({
    conversationId: parent.conversationId,
    sub_tickets_md: subTicketsMd,
  });
}

export async function writeConversationAnchorFromZero(
  tx: any,
  zql: ZqlLike,
  conversationId: string,
  summary: ParentMessageSummary,
): Promise<void> {
  const conversation = (await tx.run(
    zql.conversations.where('conversationId', conversationId).one(),
  )) as { parent_message_md?: string | null } | null;
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

  await tx.mutate.conversations.update({
    conversationId,
    parentMessageId: summary.messageId,
    parent_message_md: anchorMd,
  });
}

export async function linkSubTicketConversationToParentFromZero(
  tx: any,
  zql: ZqlLike,
  childTicketId: string,
  parentTicketId: string,
): Promise<void> {
  const child = (await tx.run(
    zql.tickets.where('id', childTicketId).one(),
  )) as { conversationId: string | null } | null;
  if (!child?.conversationId) return;

  const parent = (await tx.run(
    zql.tickets.where('id', parentTicketId).one(),
  )) as ZeroTicketLike | null;
  if (!parent?.conversationId) return;

  const parentConversation = (await tx.run(
    zql.conversations.where('conversationId', parent.conversationId).one(),
  )) as { initialMessageId: string } | null;
  if (!parentConversation) return;

  await writeConversationAnchorFromZero(tx, zql, child.conversationId, {
    messageId: parentConversation.initialMessageId,
    conversationId: parent.conversationId,
    channelId: parent.channelId ?? null,
    senderId: parent.createdBy,
    content: `${parent.xyneId} · ${parent.title}`,
    msgType: 'SYSTEM' as ParentMessageSummary['msgType'],
    createdAt: parent.createdAt instanceof Date ? parent.createdAt.getTime() : parent.createdAt,
    anchorType: 'SUBTICKET',
  });
}

export async function updateParentSubTicketsMdFromZero(
  tx: any,
  zql: ZqlLike,
  childTicketId: string,
): Promise<void> {
  const subTicketRows = (await tx.run(
    zql.sub_tickets.where('mappedTicketId', childTicketId),
  )) as Array<{ id: string }>;

  const parentTicketIds = new Set<string>();
  for (const row of subTicketRows) {
    const mappings = (await tx.run(
      zql.ticket_sub_ticket_mappings.where('subTicketId', row.id),
    )) as Array<{ ticketId: string }>;
    for (const mapping of mappings) {
      if (mapping.ticketId !== childTicketId) parentTicketIds.add(mapping.ticketId);
    }
  }

  for (const parentTicketId of parentTicketIds) {
    await updateSubTicketsMdFromZero(tx, zql, parentTicketId);
  }

  const [firstParentTicketId] = parentTicketIds;
  if (firstParentTicketId) {
    await linkSubTicketConversationToParentFromZero(tx, zql, childTicketId, firstParentTicketId);
  }
}
