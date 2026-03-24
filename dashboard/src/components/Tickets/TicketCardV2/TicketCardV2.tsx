import React from 'react';
import { Ticket, TicketPriority, TicketStatus, TicketStatusV2, TicketTag } from '@xyne/shared';
import { TicketCard } from '../TicketCard/TicketCard';

type TicketCardSummary = {
  id: string;
  title?: string | null;
  description?: string | null;
  statusV2?: TicketStatusV2 | null;
  priority?: TicketPriority | null;
  assignedTo?: string | null;
  createdBy?: string | null;
  createdAt?: number | null;
  eta?: number | null;
  xyneId?: string | null;
  stageName?: string | null;
  ticketType?: string | null;
  channelId?: string | null;
  conversationId?: string | null;
};

interface TicketCardV2Props {
  ticket: TicketCardSummary;
  tags?: TicketTag[];
  availableTags?: string[];
  onClick?: (e: React.MouseEvent | KeyboardEvent) => void;
  width?: string;
  isCompact?: boolean;
  visibleColumns?: Set<string> | undefined;
  isConversation?: boolean;
}

const buildTicketFromSummary = (summary: TicketCardSummary): Ticket => {
  const now = Date.now();
  return {
    id: summary.id,
    title: summary.title ?? '',
    description: summary.description ?? '',
    status: TicketStatus.NEW,
    statusV2: summary.statusV2 ?? TicketStatusV2.TODO,
    createdBy: summary.createdBy ?? '',
    updatedBy: summary.createdBy ?? '',
    assignedTo: summary.assignedTo ?? null,
    createdAt: summary.createdAt ?? now,
    updatedAt: summary.createdAt ?? now,
    statusUpdatedAt: summary.createdAt ?? now,
    merchantId: null,
    conversationId: summary.conversationId ?? '',
    channelId: summary.channelId ?? '',
    eta: summary.eta ?? null,
    priority: summary.priority ?? TicketPriority.LOW,
    metadata: null,
    closedAt: null,
    closedBy: null,
    xyneId: summary.xyneId ?? summary.id,
    projectId: '',
    userGroupId: '',
    boardId: '',
    stageName: summary.stageName ?? '',
    ticketType: summary.ticketType ?? null,
    isArchived: false,
  };
};

export const TicketCardV2: React.FC<TicketCardV2Props> = props => {
  const ticket = buildTicketFromSummary(props.ticket);
  return <TicketCard {...props} ticket={ticket} />;
};
