import type { Ticket, TicketTag, TicketStatusV2 } from '@xyne/shared';
import type { BoardSlaPolicy } from '../../hooks/useChannelSlaPolicy';

export interface Stage {
  id: string;
  name: string;
  color?: string;
  defaultTicketStatusV2?: TicketStatusV2;
  sequenceNumber?: number;
  formId?: string | null;
  approvers?: readonly {
    userId: string | null;
    roleId: string | null | undefined;
    approverType: string | null | undefined;
    stageId: string | null;
  }[];
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
  onClick: (e: React.MouseEvent | KeyboardEvent) => void;
  visibleColumns?: Set<string> | undefined;
  activeTicketId?: string;
  showEmailReads?: boolean;
  /** SLA policies pre-fetched by the parent; forwarded to TicketCard to avoid per-card fetches. */
  slaPolicies?: BoardSlaPolicy[];
}

export interface DroppableStageProps {
  id: string;
  children: React.ReactNode;
}
