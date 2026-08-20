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

export function latestTicketPullRequest(
  ticket: Pick<SdlcTicket, 'pullRequests'>,
): TicketPullRequest | null {
  let latest: TicketPullRequest | null = null;
  for (const pullRequest of ticket.pullRequests ?? []) {
    const pullRequestTime = pullRequest.updatedAt ?? pullRequest.date ?? 0;
    const latestTime = latest ? (latest.updatedAt ?? latest.date ?? 0) : -1;
    if (!latest || pullRequestTime > latestTime) latest = pullRequest;
  }
  return latest;
}

export function ticketTraceValue(
  ticket: Pick<SdlcTicket, 'xyneId' | 'stageName'> | null | undefined,
  totalTickets: number,
): string | undefined {
  if (ticket) return `${ticket.xyneId} · ${ticket.stageName}`;
  if (totalTickets <= 0) return undefined;
  return `${totalTickets} ticket${totalTickets === 1 ? '' : 's'}`;
}
