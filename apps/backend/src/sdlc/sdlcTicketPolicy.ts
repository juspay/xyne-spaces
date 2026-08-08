export type SdlcTicketStartPolicyInput = {
  repoId: string;
  boardId: string;
  channelId: string;
  ticket: {
    boardId: string;
    channelId: string;
    stageName: string;
    metadata: unknown;
  };
  hasActiveExecution: boolean;
  hasPullRequest: boolean;
};

export type SdlcTicketStartBlock = 'NOT_TICKET' | 'ACTIVE_EXECUTION' | 'IMPLEMENTATION_FINISHED';

export function sdlcTicketStartBlock(
  input: SdlcTicketStartPolicyInput
): SdlcTicketStartBlock | null {
  const metadata =
    input.ticket.metadata && typeof input.ticket.metadata === 'object'
      ? (input.ticket.metadata as Record<string, unknown>)
      : {};
  if (
    input.ticket.boardId !== input.boardId ||
    input.ticket.channelId !== input.channelId ||
    (metadata.surface === 'SDLC' &&
      typeof metadata.repoId === 'string' &&
      metadata.repoId !== input.repoId)
  ) {
    return 'NOT_TICKET';
  }
  if (input.hasActiveExecution) return 'ACTIVE_EXECUTION';
  if (
    input.hasPullRequest ||
    input.ticket.stageName === 'In Review' ||
    input.ticket.stageName === 'Done'
  ) {
    return 'IMPLEMENTATION_FINISHED';
  }
  return null;
}
