/**
 * Unit tests for getWorkspaceActivityCounts (unread badge invariant endpoint).
 *
 * count = dmCount + bellCount + callCount per workspace, merged across the
 * member's identities. The mocks below replace Prisma with in-memory fixtures
 * and capture the where-clauses so the tests can assert the shared
 * BELL_COUNT_RULES are actually applied (not just that the sums work).
 */
jest.mock('@/config/env', () => ({ config: { backendUrl: 'http://localhost:3000' } }));
jest.mock('@/database/client', () => ({
  db: {},
  DatabaseClient: { getInstance: jest.fn(() => ({})) },
}));
jest.mock('@/database/repositories', () => ({ repositories: {} }));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
// sdlcNavTarget re-exports from '@xyne/shared/sdlc' (ESM dist jest can't parse).
jest.mock('@/sdlc/sdlcNavTarget', () => ({
  isSdlcChannel: jest.fn(() => false),
  sdlcConversationOwner: jest.fn(),
  sdlcConversationTicket: jest.fn(),
  sdlcTicketConversation: jest.fn(),
}));
// @xyne/shared ships ESM that jest's transform ignores — stub the imports used.
jest.mock('@xyne/shared', () => ({
  ChannelScopeType: { DM: 'DM', GROUP_DM: 'GROUP_DM' },
  UserStatus: { ACTIVE: 'ACTIVE' },
  ActivityClassification: {
    PENDING: 'PENDING',
    ACTIONABLE: 'ACTIONABLE',
    FYI: 'FYI',
    SKIP: 'SKIP',
    ERROR: 'ERROR',
  },
  BELL_COUNT_RULES: {
    excludedActorActions: ['added_v2', 'removed'],
    excludedCalls: { actionSource: 'call', actorAction: 'missed_call' },
    excludedClassifications: ['SKIP'],
    excludedLegacyDirectMessageActions: ['direct_message'],
    excludeClosedChannels: true,
    dmShelf: {
      channelScopes: ['DM', 'GROUP_DM'],
      mentionActorActions: ['mentioned_user', 'group_mention'],
    },
  },
  BELL_EXCLUDED_ACTOR_ACTIONS: ['added_v2', 'removed'],
  BELL_EXCLUDED_CLASSIFICATIONS: ['SKIP'],
  BELL_EXCLUDED_LEGACY_DIRECT_MESSAGE_ACTIONS: ['direct_message'],
  DM_SHELF_CHANNEL_SCOPES: ['DM', 'GROUP_DM'],
  DM_SHELF_MENTION_ACTOR_ACTIONS: ['mentioned_user', 'group_mention'],
  DESK_CHANNEL_TYPES: new Set(['EMAIL', 'SLACK', 'APP', 'CALL', 'SOCIAL_MEDIA']),
}));

import { ActivityService } from './activityService';
import { db } from '@/database/client';

type UserRow = { id: string; workspaceId: string };
type StatusRow = {
  userId: string;
  unreadCount: number;
  channel: { id: string; scopeType: string };
};
type GroupByRow = { userId: string; channelId: string | null; _count: { id: number } };

interface Fixture {
  users: UserRow[];
  dmStatuses: StatusRow[];
  groupDmMentionCounts: GroupByRow[];
  bellChannelCounts: GroupByRow[];
  /** (userId, channelId) pairs the visibility query returns: open status on a non-desk channel. */
  visibleStatuses: Array<{ userId: string; channelId: string }>;
  callCounts: Array<{ userId: string; _count: { id: number } }>;
}

/**
 * In-memory Prisma double. where-clauses are captured (not interpreted) —
 * the tests assert rule *presence* (e.g. classification notIn contains SKIP)
 * and compute expected sums from fixtures directly.
 */
function makeDb(fixture: Fixture) {
  const whereClauses: Record<string, unknown[]> = {};

  const db = {
    user: {
      findMany: jest.fn().mockResolvedValue(fixture.users),
    },
    channelUserStatus: {
      findMany: jest.fn().mockImplementation(({ where }) => {
        (whereClauses.channelUserStatus ??= []).push(where);
        // The endpoint queries DM/GROUP_DM statuses (channel.scopeType filter) and the
        // bell-visibility pairs (channel.type filter) separately. Distinguish by the
        // channel filter's shape.
        const wantsVisibility = Boolean((where as { channel?: { type?: unknown } }).channel?.type);
        return Promise.resolve(wantsVisibility ? fixture.visibleStatuses : fixture.dmStatuses);
      }),
    },
    activity: {
      groupBy: jest.fn().mockImplementation(({ where, by }) => {
        (whereClauses.activity ??= []).push({ where, by });
        if (by.length === 2) {
          // by ['userId','channelId'] is ambiguous between the groupDmMention
          // query and the bellChannelCounts query — disambiguate by the
          // actorAction filter shape (mention list vs notIn list).
          const actionFilter = (where as { actorAction?: { in?: string[]; notIn?: string[] } })
            .actorAction;
          if (actionFilter?.in) return Promise.resolve(fixture.groupDmMentionCounts);
          return Promise.resolve(fixture.bellChannelCounts);
        }
        return Promise.resolve(fixture.callCounts);
      }),
    },
  };

  return { db, whereClauses };
}

function makeService(fixture: Fixture) {
  const { db: mockDb, whereClauses } = makeDb(fixture);
  // The counting query lives in bypassAcl/ and reads the module-level `db`, so the
  // in-memory double is installed on the mocked client (the constructor arg alone
  // no longer reaches it).
  Object.assign(db, mockDb);
  const service = new ActivityService(mockDb as unknown as typeof db);
  return { service, whereClauses };
}

describe('ActivityService.getWorkspaceActivityCounts', () => {
  const MEMBER_ID = 'member-1';

  const baseFixture = (): Fixture => ({
    users: [{ id: 'user-1', workspaceId: 'ws-1' }],
    dmStatuses: [],
    groupDmMentionCounts: [],
    bellChannelCounts: [],
    visibleStatuses: [],
    callCounts: [],
  });

  it('returns [] when the member has no active identities', async () => {
    const { service } = makeService({ ...baseFixture(), users: [] });
    await expect(service.getWorkspaceActivityCounts(MEMBER_ID)).resolves.toEqual([]);
  });

  it('sums dmCount + bellCount + callCount for a single identity (count sum invariant)', async () => {
    const { service } = makeService({
      ...baseFixture(),
      dmStatuses: [
        { userId: 'user-1', unreadCount: 3, channel: { id: 'ch-dm', scopeType: 'DM' } },
      ],
      bellChannelCounts: [
        { userId: 'user-1', channelId: 'ch-other', _count: { id: 4 } },
        { userId: 'user-1', channelId: null, _count: { id: 2 } },
      ],
      visibleStatuses: [{ userId: 'user-1', channelId: 'ch-other' }],
      callCounts: [{ userId: 'user-1', _count: { id: 1 } }],
    });

    await expect(service.getWorkspaceActivityCounts(MEMBER_ID)).resolves.toEqual([
      { workspaceId: 'ws-1', count: 10 }, // 3 dm + 6 bell + 1 call
    ]);
  });

  it('counts bell rows only in visible channels; ticket rows with null channelId always count', async () => {
    const { service } = makeService({
      ...baseFixture(),
      bellChannelCounts: [
        { userId: 'user-1', channelId: 'ch-open', _count: { id: 2 } },
        { userId: 'user-1', channelId: 'ch-closed', _count: { id: 5 } },
        { userId: 'user-1', channelId: null, _count: { id: 1 } },
      ],
      // ch-closed has no visible status row (closed or deleted for this user).
      visibleStatuses: [{ userId: 'user-1', channelId: 'ch-open' }],
    });

    await expect(service.getWorkspaceActivityCounts(MEMBER_ID)).resolves.toEqual([
      { workspaceId: 'ws-1', count: 3 }, // 2 open + 1 ticket; closed 5 excluded
    ]);
  });

  it('excludes rows in desk-type channels and channels with no status row (same rule as the bell)', async () => {
    const { service, whereClauses } = makeService({
      ...baseFixture(),
      bellChannelCounts: [
        { userId: 'user-1', channelId: 'ch-normal', _count: { id: 2 } },
        // email/Slack/app/call/social channel — the visibility query filters it out
        { userId: 'user-1', channelId: 'ch-slack', _count: { id: 6 } },
        // no channel_user_status row at all
        { userId: 'user-1', channelId: 'ch-orphan', _count: { id: 9 } },
      ],
      visibleStatuses: [{ userId: 'user-1', channelId: 'ch-normal' }],
    });

    await expect(service.getWorkspaceActivityCounts(MEMBER_ID)).resolves.toEqual([
      { workspaceId: 'ws-1', count: 2 },
    ]);

    // The visibility query must carry the same rule as userVisibleChannelsV3:
    // open status, and channel.type not in the desk types.
    const visibilityWhere = (
      whereClauses.channelUserStatus as Array<{
        isClosed?: boolean;
        isDeleted?: boolean;
        channelId?: { in: string[] };
        channel?: { type?: { notIn: string[] } };
      }>
    ).find(w => w.channel?.type);
    expect(visibilityWhere?.isClosed).toBe(false);
    expect(visibilityWhere?.isDeleted).toBe(false);
    expect(visibilityWhere?.channel?.type?.notIn).toEqual(
      expect.arrayContaining(['EMAIL', 'SLACK', 'APP', 'CALL', 'SOCIAL_MEDIA']),
    );
    // Scoped to the channels that actually have unread bell rows.
    expect(visibilityWhere?.channelId?.in).toEqual(['ch-normal', 'ch-slack', 'ch-orphan']);
  });

  it('skips the visibility query when every bell row is a ticket row (null channelId)', async () => {
    const { service, whereClauses } = makeService({
      ...baseFixture(),
      bellChannelCounts: [{ userId: 'user-1', channelId: null, _count: { id: 4 } }],
    });

    await expect(service.getWorkspaceActivityCounts(MEMBER_ID)).resolves.toEqual([
      { workspaceId: 'ws-1', count: 4 },
    ]);
    const visibilityQueries = (
      (whereClauses.channelUserStatus ?? []) as Array<{ channel?: { type?: unknown } }>
    ).filter(w => w.channel?.type);
    expect(visibilityQueries).toHaveLength(0);
  });

  it("keeps another identity's rows when only this user has no visible status (per-user state)", async () => {
    const { service } = makeService({
      ...baseFixture(),
      users: [
        { id: 'user-1', workspaceId: 'ws-1' },
        { id: 'user-2', workspaceId: 'ws-1' },
      ],
      bellChannelCounts: [
        { userId: 'user-1', channelId: 'ch-shared', _count: { id: 2 } },
        { userId: 'user-2', channelId: 'ch-shared', _count: { id: 7 } },
      ],
      // only user-2 still has ch-shared open; user-1 closed it
      visibleStatuses: [{ userId: 'user-2', channelId: 'ch-shared' }],
    });

    await expect(service.getWorkspaceActivityCounts(MEMBER_ID)).resolves.toEqual([
      { workspaceId: 'ws-1', count: 7 }, // only user-1's rows in ch-shared excluded
    ]);
  });

  it('subtracts unread top-level GROUP_DM mentions from dmCount, floored at 0 per channel', async () => {
    const { service } = makeService({
      ...baseFixture(),
      dmStatuses: [
        // unreadCount 5, 3 unread mentions → 5-3 = 2
        { userId: 'user-1', unreadCount: 5, channel: { id: 'ch-gdm', scopeType: 'GROUP_DM' } },
        // unreadCount 1, 4 unread mentions → floored at 0
        { userId: 'user-1', unreadCount: 1, channel: { id: 'ch-gdm-2', scopeType: 'GROUP_DM' } },
        // plain DM: unreadCount 4, no mention subtraction
        { userId: 'user-1', unreadCount: 4, channel: { id: 'ch-dm', scopeType: 'DM' } },
      ],
      groupDmMentionCounts: [
        { userId: 'user-1', channelId: 'ch-gdm', _count: { id: 3 } },
        { userId: 'user-1', channelId: 'ch-gdm-2', _count: { id: 4 } },
      ],
    });

    await expect(service.getWorkspaceActivityCounts(MEMBER_ID)).resolves.toEqual([
      { workspaceId: 'ws-1', count: 6 }, // (5-3) + max(0, 1-4) + 4
    ]);
  });

  it('merges two identities in one workspace by summing (no last-write-wins)', async () => {
    const { service } = makeService({
      ...baseFixture(),
      users: [
        { id: 'user-1', workspaceId: 'ws-1' },
        { id: 'user-2', workspaceId: 'ws-1' },
      ],
      dmStatuses: [
        { userId: 'user-1', unreadCount: 2, channel: { id: 'ch-a', scopeType: 'DM' } },
        { userId: 'user-2', unreadCount: 3, channel: { id: 'ch-b', scopeType: 'DM' } },
      ],
      bellChannelCounts: [
        { userId: 'user-2', channelId: 'ch-other', _count: { id: 4 } },
      ],
      visibleStatuses: [{ userId: 'user-2', channelId: 'ch-other' }],
      callCounts: [{ userId: 'user-1', _count: { id: 1 } }],
    });

    await expect(service.getWorkspaceActivityCounts(MEMBER_ID)).resolves.toEqual([
      { workspaceId: 'ws-1', count: 10 }, // (2+1) user-1 + (3+4) user-2
    ]);
  });

  it('splits identities across workspaces into separate rows', async () => {
    const { service } = makeService({
      ...baseFixture(),
      users: [
        { id: 'user-1', workspaceId: 'ws-1' },
        { id: 'user-2', workspaceId: 'ws-2' },
      ],
      dmStatuses: [
        { userId: 'user-1', unreadCount: 2, channel: { id: 'ch-a', scopeType: 'DM' } },
        { userId: 'user-2', unreadCount: 3, channel: { id: 'ch-b', scopeType: 'DM' } },
      ],
    });

    const result = await service.getWorkspaceActivityCounts(MEMBER_ID);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ workspaceId: 'ws-1', count: 2 });
    expect(result).toContainEqual({ workspaceId: 'ws-2', count: 3 });
  });

  it('applies the shared BELL_COUNT_RULES to the bell query where-clause', async () => {
    const { service, whereClauses } = makeService(baseFixture());
    await service.getWorkspaceActivityCounts(MEMBER_ID);

    const activityQueries = whereClauses.activity as Array<{
      where: {
        actorAction?: { notIn?: string[]; in?: string[] };
        classification?: { notIn?: string[] };
        NOT?: { AND: Array<{ actionSource: string; actorAction: string }> };
        isThreadActivity?: boolean | { not: boolean };
        actionSource?: string;
      };
      by: string[];
    }>;

    // The bell query (actorAction notIn shape).
    const bellQuery = activityQueries.find(q => q.where.actorAction?.notIn);
    expect(bellQuery).toBeDefined();
    expect(bellQuery?.where.actorAction?.notIn).toEqual(
      expect.arrayContaining(['added_v2', 'removed', 'direct_message']),
    );
    expect(bellQuery?.where.classification?.notIn).toEqual(['SKIP']);
    expect(bellQuery?.where.NOT?.AND).toEqual([
      { actionSource: 'call' },
      { actorAction: 'missed_call' },
    ]);

    // The dm-shelf subtraction query (actorAction in shape).
    // Skipped entirely when no open GROUP_DM channels exist.
    expect(activityQueries.find(q => q.where.actorAction?.in)).toBeUndefined();

    // When it DOES run (fixture with open GROUP_DM channels), its thread
    // filter must be { not: true } (matches false AND null — legacy rows),
    // mirroring the client predicate's `!== true`.
    const groupDmResult = makeService({
      ...baseFixture(),
      dmStatuses: [
        { userId: 'user-1', unreadCount: 2, channel: { id: 'gdm-1', scopeType: 'GROUP_DM' } },
      ],
    });
    await groupDmResult.service.getWorkspaceActivityCounts(MEMBER_ID);
    const groupDmQueries = (groupDmResult.whereClauses.activity ?? []).map(
      (q: unknown) => q as { where: { actorAction?: { in?: string[] } }; by: string[] },
    );
    const mentionQuery = groupDmQueries.find(q => q.where.actorAction?.in);
    expect(mentionQuery).toBeDefined();
    expect(
      (mentionQuery?.where as { isThreadActivity?: unknown }).isThreadActivity,
    ).toEqual({ not: true });

    // The call query (by userId only, missed_call).
    const callQuery = activityQueries.find(q => q.by.length === 1);
    expect(callQuery?.where.actorAction).toBe('missed_call');
  });
});
