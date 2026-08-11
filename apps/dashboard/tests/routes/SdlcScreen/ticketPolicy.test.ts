import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterTickets,
  latestTicketExecution,
  latestTicketPullRequest,
  linkedTicketForCanvasChain,
  ticketDebugContext,
  ticketAction,
  ticketTraceValue,
  type SdlcTicket,
} from '../../../src/routes/SdlcScreen/ticketPolicy.ts';

function makeTicket(overrides: Partial<SdlcTicket> = {}): SdlcTicket {
  return {
    id: 'ticket-1',
    title: 'Implement pet search',
    description: 'Add indexed search',
    xyneId: 'PETS-1',
    boardId: 'board-1',
    channelId: 'channel-1',
    stageName: 'Backlog',
    metadata: { surface: 'SDLC', repoId: 'repo-1' },
    ...overrides,
  } as SdlcTicket;
}

void test('filters Tickets by board, channel, repository metadata, and search', () => {
  const tickets = [
    makeTicket(),
    makeTicket({ id: 'legacy', metadata: null }),
    makeTicket({ id: 'wrong-repo', metadata: { surface: 'SDLC', repoId: 'repo-2' } }),
    makeTicket({ id: 'wrong-board', boardId: 'board-2' }),
  ];

  assert.deepEqual(
    filterTickets(tickets, {
      repoId: 'repo-1',
      boardId: 'board-1',
      channelId: 'channel-1',
      search: 'PETS-1',
    }).map(item => item.id),
    ['ticket-1', 'legacy'],
  );
  assert.equal(
    filterTickets(tickets, {
      repoId: 'repo-1',
      boardId: 'board-1',
      channelId: 'channel-1',
      search: 'missing',
    }).length,
    0,
  );
});

void test('selects the newest SDLC execution and pull request defensively', () => {
  const ticket = makeTicket({
    workflows: [
      {
        workflowType: 'SDLC_WORK',
        workflowExecutions: [
          { id: 'old', status: 'FAILURE', updatedAt: 1 },
          { id: 'new', status: 'RUNNING', updatedAt: 2 },
        ],
      },
      {
        workflowType: 'OTHER',
        workflowExecutions: [{ id: 'ignored', status: 'SUCCESS', updatedAt: 3 }],
      },
    ],
    pullRequests: [
      { id: 'old-pr', updatedAt: 4 },
      { id: 'new-pr', updatedAt: 5 },
    ],
  });

  assert.equal(latestTicketExecution(ticket)?.id, 'new');
  assert.equal(latestTicketPullRequest(ticket)?.id, 'new-pr');
});

void test('derives workflow-controlled actions', () => {
  assert.equal(ticketAction(makeTicket()), 'START');
  assert.equal(
    ticketAction(
      makeTicket({
        workflows: [
          { workflowType: 'SDLC_WORK', workflowExecutions: [{ id: 'e1', status: 'RUNNING' }] },
        ],
      }),
    ),
    'RUNNING',
  );
  assert.equal(
    ticketAction(
      makeTicket({
        workflows: [
          { workflowType: 'SDLC_WORK', workflowExecutions: [{ id: 'e1', status: 'FAILURE' }] },
        ],
      }),
    ),
    'RETRY',
  );
  assert.equal(ticketAction(makeTicket({ pullRequests: [{ id: 'pr-1' }] })), 'OPEN_PR');
  assert.equal(ticketAction(makeTicket({ stageName: 'Done' })), 'LOCKED');
});

void test('shows repository ticket count when a PRD has no explicit Ticket link', () => {
  assert.equal(ticketTraceValue(undefined, 3), '3 tickets');
  assert.equal(ticketTraceValue(undefined, 1), '1 ticket');
  assert.equal(ticketTraceValue(makeTicket(), 3), 'PETS-1 · Backlog');
  assert.equal(ticketTraceValue(undefined, 0), undefined);
});

void test('extracts Claw debugger identity from a Ticket execution', () => {
  assert.deepEqual(
    ticketDebugContext({
      id: 'execution-1',
      status: 'RUNNING',
      context: JSON.stringify({
        conversationId: 'chat-sdlc-work-execution-1',
        sessionId: 'session-1',
      }),
    }),
    {
      conversationId: 'chat-sdlc-work-execution-1',
      sessionId: 'session-1',
    },
  );
  assert.deepEqual(
    ticketDebugContext({
      id: 'execution-2',
      status: 'PENDING',
      context: JSON.stringify({ conversationId: 'chat-sdlc-work-execution-2' }),
    }),
    {
      conversationId: 'chat-sdlc-work-execution-2',
      sessionId: null,
    },
  );
  assert.equal(
    ticketDebugContext({ id: 'execution-3', status: 'RUNNING', context: '{invalid' }),
    null,
  );
});

void test('resolves lifecycle Ticket from a link then metadata fallback', () => {
  const linked = makeTicket({ id: 'linked' });
  const fallback = makeTicket({
    id: 'fallback',
    metadata: { surface: 'SDLC', repoId: 'repo-1', sourceId: 'tech-doc-1' },
  });
  assert.equal(
    linkedTicketForCanvasChain(
      [linked, fallback],
      [{ sourceId: 'prd-1', targetId: 'linked', relationType: 'TICKET' }],
      ['prd-1', 'tech-doc-1'],
    )?.id,
    'linked',
  );
  assert.equal(linkedTicketForCanvasChain([fallback], [], ['prd-1', 'tech-doc-1'])?.id, 'fallback');
});
