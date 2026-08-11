import {
  sdlcTicketStartBlock,
  type SdlcTicketStartPolicyInput,
} from '../../src/sdlc/sdlcTicketPolicy';

function input(overrides: Partial<SdlcTicketStartPolicyInput> = {}): SdlcTicketStartPolicyInput {
  return {
    repoId: 'repo-1',
    boardId: 'board-1',
    channelId: 'channel-1',
    ticket: {
      boardId: 'board-1',
      channelId: 'channel-1',
      stageName: 'Backlog',
      metadata: { surface: 'SDLC', repoId: 'repo-1' },
    },
    hasActiveExecution: false,
    hasPullRequest: false,
    ...overrides,
  };
}

void test('accepts a repository Ticket before a pull request exists', () => {
  expect(sdlcTicketStartBlock(input())).toBeNull();
  expect(sdlcTicketStartBlock(input({ ticket: { ...input().ticket, metadata: null } }))).toBeNull();
});

void test('rejects tickets outside the repository SDLC scope', () => {
  expect(
    sdlcTicketStartBlock(
      input({
        ticket: {
          boardId: 'board-1',
          channelId: 'channel-1',
          stageName: 'Backlog',
          metadata: { surface: 'SDLC', repoId: 'repo-2' },
        },
      })
    )
  ).toBe('NOT_TICKET');
  expect(sdlcTicketStartBlock(input({ ticket: { ...input().ticket, boardId: 'board-2' } }))).toBe(
    'NOT_TICKET'
  );
  expect(
    sdlcTicketStartBlock(input({ ticket: { ...input().ticket, channelId: 'channel-2' } }))
  ).toBe('NOT_TICKET');
});

void test('rejects active and post-PR implementations', () => {
  expect(sdlcTicketStartBlock(input({ hasActiveExecution: true }))).toBe('ACTIVE_EXECUTION');
  expect(sdlcTicketStartBlock(input({ hasPullRequest: true }))).toBe('IMPLEMENTATION_FINISHED');
  expect(sdlcTicketStartBlock(input({ ticket: { ...input().ticket, stageName: 'Done' } }))).toBe(
    'IMPLEMENTATION_FINISHED'
  );
});
