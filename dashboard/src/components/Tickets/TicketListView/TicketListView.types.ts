import { TicketStatus, TicketPriority } from '@xyne/shared';

export interface TicketListItem {
  id: string;
  xyneId?: string | null;
  title: string;
  status: TicketStatus | string;
  stageName?: string | null;
  createdAt: number;
  lastEmailAt?: number | null;
  priority?: TicketPriority | string | null;
  assignedTo?: string | null;
  boardId?: string | null;
  aiCategory?: string | null;
  metadata?: unknown;
  emailCount?: number | null;
  emailDrafts?: readonly { userId: string | null; autoDraftStatus?: string | null }[] | null;
  emailReads?: readonly unknown[] | null;
  conversation?: unknown;
  _raw?: Record<string, unknown>;
}
