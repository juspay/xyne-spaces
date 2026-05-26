import { ReactNode } from 'react';
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
  aiCategory?: string | null;
  metadata?: unknown;
  emailCount?: number | null;
  emailDrafts?: readonly { userId: string | null }[] | null;
  emailReads?: readonly unknown[] | null;
  conversation?: unknown;
  _raw?: Record<string, unknown>;
}

export interface TicketListViewProps<T extends TicketListItem> {
  /** Array of tickets to display */
  tickets: T[];
  /** Callback when a ticket row is clicked */
  onTicketClick: (ticket: T) => void;
  /** Custom row renderer. Receives the ticket, isActive flag, and index.
   *  When provided, replaces the default TicketListRow entirely. */
  renderRow?: (ticket: T, isActive: boolean, index: number) => ReactNode;
  /** Show extra fields (created by, company) in the default row. Default: false */
  showExtraFields?: boolean;
  /** Currently active ticket ID (for highlight) */
  activeTicketId?: string | null | undefined;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Number of skeleton rows while loading. Default: 8 */
  skeletonRowCount?: number;
  /** Custom empty state content */
  emptyState?: ReactNode;
  /** Additional CSS class for the outer container */
  className?: string;
}
