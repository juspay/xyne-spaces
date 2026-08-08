import type { Ticket } from '@xyne/shared';

const ACTIVE_EXECUTION_STATUSES = new Set(['NEW', 'PENDING', 'SCHEDULED', 'RUNNING']);
const RETRYABLE_EXECUTION_STATUSES = new Set(['FAILURE', 'CANCELLED']);

export type TicketExecution = {
  id: string;
  status: string;
  context?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
};

export type TicketDebugContext = {
  conversationId: string;
  sessionId: string | null;
};

export type TicketWorkflow = {
  workflowType?: string | null;
  workflowExecutions?: readonly TicketExecution[];
};

export type TicketPullRequest = {
  id: string;
  prId?: number | null;
  prUrl?: string | null;
  status?: string | null;
  date?: number | null;
  updatedAt?: number | null;
};

export type SdlcTicket = Ticket & {
  workflows?: readonly TicketWorkflow[];
  pullRequests?: readonly TicketPullRequest[];
};

export type TicketAction = 'START' | 'RUNNING' | 'RETRY' | 'OPEN_PR' | 'LOCKED';

function timestampOf(value: { updatedAt?: number | null; createdAt?: number | null }): number {
  return value.updatedAt ?? value.createdAt ?? 0;
}

export function isRepositoryTicket(
  ticket: Pick<Ticket, 'boardId' | 'channelId' | 'metadata'>,
  input: { repoId: string; boardId: string; channelId: string },
): boolean {
  const metadata =
    ticket.metadata && typeof ticket.metadata === 'object'
      ? (ticket.metadata as Record<string, unknown>)
      : {};
  if (ticket.boardId !== input.boardId || ticket.channelId !== input.channelId) return false;
  if (metadata['surface'] === 'SDLC' && typeof metadata['repoId'] === 'string') {
    return metadata['repoId'] === input.repoId;
  }
  return true;
}

export function latestTicketExecution(
  ticket: Pick<SdlcTicket, 'workflows'>,
): TicketExecution | null {
  let latest: TicketExecution | null = null;
  for (const workflow of ticket.workflows ?? []) {
    if (workflow.workflowType !== 'SDLC_WORK') continue;
    for (const execution of workflow.workflowExecutions ?? []) {
      if (!latest || timestampOf(execution) > timestampOf(latest)) latest = execution;
    }
  }
  return latest;
}

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

export function linkedTicketForCanvasChain(
  tickets: readonly SdlcTicket[],
  links: readonly { sourceId: string; targetId: string; relationType: string }[],
  canvasIds: readonly string[],
): SdlcTicket | null {
  const canvasIdSet = new Set(canvasIds.filter(Boolean));
  const ticketLink = links.find(
    link => link.relationType === 'TICKET' && canvasIdSet.has(link.sourceId),
  );
  if (ticketLink) {
    const linked = tickets.find(ticket => ticket.id === ticketLink.targetId);
    if (linked) return linked;
  }
  return (
    tickets.find(ticket => {
      const metadata =
        ticket.metadata && typeof ticket.metadata === 'object'
          ? (ticket.metadata as Record<string, unknown>)
          : {};
      return typeof metadata['sourceId'] === 'string' && canvasIdSet.has(metadata['sourceId']);
    }) ?? null
  );
}

export function ticketDebugContext(
  execution: TicketExecution | null | undefined,
): TicketDebugContext | null {
  if (!execution?.context) return null;
  try {
    const context = JSON.parse(execution.context) as Record<string, unknown>;
    if (typeof context['conversationId'] !== 'string' || !context['conversationId']) return null;
    return {
      conversationId: context['conversationId'],
      sessionId: typeof context['sessionId'] === 'string' ? context['sessionId'] : null,
    };
  } catch {
    return null;
  }
}

export function ticketAction(ticket: SdlcTicket): TicketAction {
  if (latestTicketPullRequest(ticket)) return 'OPEN_PR';
  if (ticket.stageName === 'In Review' || ticket.stageName === 'Done') return 'LOCKED';

  const execution = latestTicketExecution(ticket);
  if (execution && ACTIVE_EXECUTION_STATUSES.has(execution.status)) return 'RUNNING';
  if (execution && RETRYABLE_EXECUTION_STATUSES.has(execution.status)) return 'RETRY';
  return 'START';
}

export function ticketTraceValue(
  ticket: Pick<SdlcTicket, 'xyneId' | 'stageName'> | null | undefined,
  totalTickets: number,
): string | undefined {
  if (ticket) return `${ticket.xyneId} · ${ticket.stageName}`;
  if (totalTickets <= 0) return undefined;
  return `${totalTickets} ticket${totalTickets === 1 ? '' : 's'}`;
}

export function filterTickets(
  tickets: readonly SdlcTicket[],
  input: { repoId: string; boardId: string; channelId: string; search?: string },
): SdlcTicket[] {
  const search = input.search?.trim().toLocaleLowerCase() ?? '';
  return tickets.filter(ticket => {
    if (!isRepositoryTicket(ticket, input)) return false;
    if (!search) return true;
    return [ticket.xyneId, ticket.title, ticket.description].some(value =>
      value?.toLocaleLowerCase().includes(search),
    );
  });
}
