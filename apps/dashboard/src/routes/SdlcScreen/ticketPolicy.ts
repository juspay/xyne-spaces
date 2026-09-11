import type { Ticket } from '@xyne/shared';

export type TicketPullRequest = {
  id: string;
  prId?: number | null;
  prUrl?: string | null;
  status?: string | null;
  date?: number | null;
  updatedAt?: number | null;
};

export type SdlcTicket = Ticket & {
  pullRequests?: readonly TicketPullRequest[];
};
