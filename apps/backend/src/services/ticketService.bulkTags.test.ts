/**
 * Unit tests for TicketService.bulkUpdateTicketTags — the bulk add/remove tag
 * path behind POST /api/tickets/bulk-tags and the spaces-bulk-relabel-tickets
 * MCP tool. Focus: workspace scoping (no cross-workspace writes), additive
 * diff semantics, and add-wins conflict handling.
 *
 * The heavy module graph ticketService.ts pulls in is stubbed so the test is
 * hermetic and does not touch a real DB, Vespa, or websockets.
 */

// ---- mocks for every side-effecting import in ticketService.ts ----
const mockPrisma: any = {
  ticket: { findMany: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
  ticketTag: { findMany: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
  ticketActivity: { createMany: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock('@/database/client', () => ({
  DatabaseClient: { getInstance: () => mockPrisma },
  db: mockPrisma,
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));
jest.mock('@/services/ticketTagDualWriteService', () => ({
  dualWriteTicketTags: jest.fn().mockResolvedValue(undefined),
  dualDeleteTicketTag: jest.fn().mockResolvedValue(undefined),
}));
const addJob = jest.fn().mockResolvedValue(undefined);
jest.mock('@/queues/vespaQueue', () => ({ vespaQueue: { addJob } }));
jest.mock('@/vespa/src/types', () => ({ ticketSchema: 'ticket' }));
jest.mock('@xyne/shared', () => ({
  ActivityType: { TAGS: 'TAGS' },
  TicketStatusV2: { COMPLETED: 'COMPLETED' },
  BoardType: {},
  isReleaseTicket: () => false,
}));
jest.mock('@/database/repositories/ticketRepository', () => ({ TicketRepository: class {} }));
jest.mock('@/database/repositories/messageAttachmentRepository', () => ({ MessageAttachmentRepository: class {} }));
jest.mock('@/services/storage', () => ({ getStorageService: () => ({}) }));
jest.mock('@/utils/ticketMd', () => ({ syncConversationTicketMdFromPrismaTicket: jest.fn() }));
jest.mock('@/services/tickets/kanbanCountsSnapshotService', () => ({ buildKanbanCountsSnapshot: jest.fn() }));
jest.mock('@/services/websocketService', () => ({ websocketService: { broadcastTicketCountsUpdate: jest.fn() } }));
jest.mock('@/services/release/versionReleaseMappingService', () => ({ versionReleaseMappingService: {} }));
jest.mock('./stageTransition/ticketStageTransitionService', () => ({ ticketStageTransitionService: {} }));

import { ticketService } from './ticketService';

const WS = 'ws-1';

beforeEach(() => {
  jest.clearAllMocks();
  // $transaction just runs the callback with the same mock client.
  mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
  mockPrisma.ticketTag.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.ticketTag.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.ticketActivity.createMany.mockResolvedValue({ count: 0 });
});

function existingTags(map: Record<string, string[]>) {
  mockPrisma.ticketTag.findMany.mockImplementation(async ({ where }: any) => {
    const names = map[where.ticketId] ?? [];
    return names.map(name => ({ name }));
  });
}

describe('bulkUpdateTicketTags', () => {
  it('skips ticket ids outside the caller workspace (no cross-workspace write)', async () => {
    // Only t1 belongs to WS; t2 belongs to another workspace and must be skipped.
    mockPrisma.ticket.findMany.mockResolvedValue([{ id: 't1' }]);
    existingTags({ t1: ['old'] });

    const res = await ticketService.bulkUpdateTicketTags(
      ['t1', 't2'],
      { addTags: ['new'], removeTags: ['old'] },
      WS,
      'user-1',
    );

    expect(res.skipped).toContain('t2');
    expect(res.updated.map(u => u.ticketId)).toEqual(['t1']);
    // The workspace filter must be part of the authorization query.
    expect(mockPrisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ workspaceId: WS }) }),
    );
  });

  it('computes an additive diff and preserves untouched labels', async () => {
    mockPrisma.ticket.findMany.mockResolvedValue([{ id: 't1' }]);
    // t1 already has "keep" and "old"; we add "new", remove "old".
    existingTags({ t1: ['keep', 'old'] });

    const res = await ticketService.bulkUpdateTicketTags(
      ['t1'],
      { addTags: ['new'], removeTags: ['old'] },
      WS,
      'user-1',
    );

    expect(res.updated[0]).toEqual({ ticketId: 't1', added: ['new'], removed: ['old'] });
    // Removal only targets "old" — "keep" is never in a delete/create call.
    expect(mockPrisma.ticketTag.deleteMany).toHaveBeenCalledWith({
      where: { ticketId: 't1', name: { in: ['old'] } },
    });
    expect(mockPrisma.ticketTag.createMany).toHaveBeenCalledWith({
      data: [{ name: 'new', ticketId: 't1', workspaceId: WS }],
    });
    expect(res.totalAdded).toBe(1);
    expect(res.totalRemoved).toBe(1);
  });

  it('treats a no-op (label already present) as unchanged, not updated', async () => {
    mockPrisma.ticket.findMany.mockResolvedValue([{ id: 't1' }]);
    existingTags({ t1: ['new'] }); // already has the label we would add

    const res = await ticketService.bulkUpdateTicketTags(
      ['t1'],
      { addTags: ['new'] },
      WS,
      'user-1',
    );

    expect(res.unchanged).toEqual(['t1']);
    expect(res.updated).toEqual([]);
    expect(mockPrisma.ticketTag.createMany).not.toHaveBeenCalled();
  });

  it('keeps a tag requested in BOTH add and remove (add wins)', async () => {
    mockPrisma.ticket.findMany.mockResolvedValue([{ id: 't1' }]);
    existingTags({ t1: ['x'] });

    const res = await ticketService.bulkUpdateTicketTags(
      ['t1'],
      { addTags: ['x'], removeTags: ['x'] },
      WS,
      'user-1',
    );

    // "x" already present + add-wins → nothing to do.
    expect(res.unchanged).toEqual(['t1']);
    expect(mockPrisma.ticketTag.deleteMany).not.toHaveBeenCalled();
  });

  it('throws when neither addTags nor removeTags is provided', async () => {
    mockPrisma.ticket.findMany.mockResolvedValue([]);
    await expect(
      ticketService.bulkUpdateTicketTags(['t1'], {}, WS, 'user-1'),
    ).rejects.toThrow(/addTags or removeTags/);
  });
});
