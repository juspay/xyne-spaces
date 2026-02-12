import type { Ticket, TicketTag, TicketStatusV2 } from '@xyne/shared';

export interface Stage {
  id: string;
  name: string;
  color?: string;
  defaultTicketStatusV2?: TicketStatusV2;
  sequenceNumber?: number;
  formId?: string | null;
  approvers?: readonly { userId: string; stageId: string }[];
  formContextMappings?: readonly {
    id: string;
    contextId: string;
    contextType: string;
    entityType: string;
    formId: string;
  }[];
}

export interface SortableTicketCardProps {
  ticket: Ticket;
  tags: TicketTag[];
  availableTags?: string[];
  onClick: () => void;
  visibleColumns?: Set<string> | undefined;
}

export interface DroppableStageProps {
  id: string;
  children: React.ReactNode;
}
