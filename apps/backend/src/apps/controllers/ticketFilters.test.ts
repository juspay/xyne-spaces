import { TicketPriority, TicketStatusV2 } from '@prisma/client';
import { buildTicketFilterWhere } from './ticketFilters';

describe('buildTicketFilterWhere', () => {
  it('returns an empty where for no filters (caller owns scope/defaults)', () => {
    expect(buildTicketFilterWhere()).toEqual({});
    expect(buildTicketFilterWhere({})).toEqual({});
  });

  it('maps non-identity core column filters to `in` predicates', () => {
    const where = buildTicketFilterWhere({
      statusV2: [TicketStatusV2.TODO, TicketStatusV2.STARTED],
      priority: [TicketPriority.HIGH],
      stageName: ['Triage'],
      ticketType: ['bug'],
    });

    expect(where.statusV2).toEqual({ in: [TicketStatusV2.TODO, TicketStatusV2.STARTED] });
    expect(where.priority).toEqual({ in: [TicketPriority.HIGH] });
    expect(where.stageName).toEqual({ in: ['Triage'] });
    expect(where.ticketType).toEqual({ in: ['bug'] });
  });

  it('expands identity columns to raw + prefixed stored forms (both formats)', () => {
    const where = buildTicketFilterWhere({
      assignedTo: ['user_1'],
      createdBy: ['user_2'],
      userGroupId: ['grp_1'],
    });

    // A plain id must match tickets stored either raw or prefixed.
    expect(where.assignedTo).toEqual({
      in: ['user_1', 'user:user_1', 'group:user_1', 'userGroup:user_1'],
    });
    expect(where.createdBy).toEqual({
      in: ['user_2', 'user:user_2', 'group:user_2', 'userGroup:user_2'],
    });
    expect(where.userGroupId).toEqual({
      in: ['grp_1', 'user:grp_1', 'group:grp_1', 'userGroup:grp_1'],
    });
  });

  it('accepts an already-prefixed identity value and still covers the raw form', () => {
    const assignedTo = (buildTicketFilterWhere({ assignedTo: ['user:user_1'] }).assignedTo as {
      in: string[];
    }).in;
    // Passing the prefixed form still yields the raw id, so both storage formats match.
    expect(assignedTo).toContain('user:user_1');
    expect(assignedTo).toContain('user_1');

    const userGroupId = (buildTicketFilterWhere({ userGroupId: ['group:grp_1'] }).userGroupId as {
      in: string[];
    }).in;
    expect(userGroupId).toContain('group:grp_1');
    expect(userGroupId).toContain('grp_1');
  });

  it('de-duplicates expanded identity values (raw + prefixed supplied together)', () => {
    const assignedTo = (buildTicketFilterWhere({
      assignedTo: ['user_1', 'user:user_1'],
    }).assignedTo as { in: string[] }).in;
    // No duplicates even though both forms were supplied.
    expect(new Set(assignedTo).size).toBe(assignedTo.length);
    expect(assignedTo).toContain('user_1');
    expect(assignedTo).toContain('user:user_1');
  });

  it('filters related-table tags via the tags relation (match any)', () => {
    const where = buildTicketFilterWhere({ tags: ['urgent', 'p0'] });
    expect(where.tags).toEqual({ some: { name: { in: ['urgent', 'p0'] } } });
  });

  it('only sets isArchived when explicitly provided', () => {
    expect(buildTicketFilterWhere({}).isArchived).toBeUndefined();
    expect(buildTicketFilterWhere({ isArchived: true }).isArchived).toBe(true);
    expect(buildTicketFilterWhere({ isArchived: false }).isArchived).toBe(false);
  });

  it('builds a createdAt range from createdAfter/createdBefore', () => {
    const after = new Date('2026-01-01T00:00:00.000Z');
    const before = new Date('2026-02-01T00:00:00.000Z');

    expect(buildTicketFilterWhere({ createdAfter: after }).createdAt).toEqual({ gte: after });
    expect(buildTicketFilterWhere({ createdBefore: before }).createdAt).toEqual({ lte: before });
    expect(buildTicketFilterWhere({ createdAfter: after, createdBefore: before }).createdAt).toEqual({
      gte: after,
      lte: before,
    });
  });

  it('ignores empty filter arrays', () => {
    const where = buildTicketFilterWhere({ statusV2: [], tags: [], assignedTo: [] });
    expect(where.statusV2).toBeUndefined();
    expect(where.tags).toBeUndefined();
    expect(where.assignedTo).toBeUndefined();
    expect(where).toEqual({});
  });

  it('does not emit channel/board/cursor predicates (caller-owned)', () => {
    const where = buildTicketFilterWhere({ statusV2: [TicketStatusV2.TODO] });
    expect(where.channelId).toBeUndefined();
    expect(where.boardId).toBeUndefined();
    expect(where.AND).toBeUndefined();
  });
});
