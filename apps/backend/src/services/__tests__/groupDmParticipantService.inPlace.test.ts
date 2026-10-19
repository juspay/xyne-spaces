jest.mock('@xyne/shared', () => ({
  ChannelRole: { ADMIN: 'ADMIN', MEMBER: 'MEMBER' },
  ChannelScopeType: { DM: 'DM', GROUP_DM: 'GROUP_DM', DEFAULT: 'DEFAULT' },
  ChannelVisibility: { PRIVATE: 'PRIVATE', PUBLIC: 'PUBLIC' },
  MAX_DM_PARTICIPANTS: 10,
  historyScopeToCutoff: (scope: { mode: string; from?: string }) =>
    scope.mode === 'beginning' || scope.mode === 'none' ? null : new Date(scope.from as string),
}));

enum ChannelScopeType {
  DM = 'DM',
  GROUP_DM = 'GROUP_DM',
}

jest.mock('@/services/websocketService', () => ({
  websocketService: { broadcastLabelUnreadCountsUpdate: jest.fn() },
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('@/database/repositories/channelRepository', () => ({ ChannelRepository: jest.fn() }));
jest.mock('@/database/repositories/channelParticipantRepository', () => ({
  ChannelParticipantRepository: jest.fn(),
}));
jest.mock('@/database/repositories/conversationRepository', () => ({
  ConversationRepository: jest.fn(),
}));
jest.mock('@/database/repositories/users', () => ({ UserRepository: jest.fn() }));
jest.mock('@/database/repositories/projectRepository', () => ({ ProjectRepository: jest.fn() }));

import { GroupDmParticipantService } from '../groupDmParticipantService';

type Participant = { id: string; channelId: string; userId: string };

function makeService(opts: {
  scopeType: ChannelScopeType;
  members: string[];
  existingGroupByName?: Record<string, { id: string }>;
  failAddFor?: string;
}) {
  const participants = new Map<string, Participant[]>();
  participants.set(
    'src',
    opts.members.map(userId => ({ id: `p-src-${userId}`, channelId: 'src', userId })),
  );
  const channels: Record<string, { id: string; name: string; scopeType: ChannelScopeType }> = {
    src: { id: 'src', name: [...opts.members].sort().join(','), scopeType: opts.scopeType },
  };

  const channelRepository = {
    findById: jest.fn(async (id: string) => channels[id] ?? null),
    getGroupChannelByMembers: jest.fn(async (ids: string[]) => {
      const name = [...ids].sort().join(',');
      if (opts.existingGroupByName?.[name]) return opts.existingGroupByName[name];
      return Object.values(channels).find(
        c => c.scopeType === ChannelScopeType.GROUP_DM && c.name === name,
      ) ?? null;
    }),
    create: jest.fn(async (input: { name: string; scopeType: ChannelScopeType }) => {
      const ch = { id: 'new', name: input.name, scopeType: input.scopeType };
      channels.new = ch;
      participants.set('new', []);
      return ch;
    }),
    update: jest.fn(async (id: string, data: { name?: string }) => {
      if (data.name !== undefined) channels[id].name = data.name;
      return channels[id];
    }),
    delete: jest.fn(),
  };

  const channelParticipantRepository = {
    getChannelParticipants: jest.fn(async (channelId: string) => participants.get(channelId) ?? []),
    findParticipant: jest.fn(async (channelId: string, userId: string) =>
      (participants.get(channelId) ?? []).find(p => p.userId === userId) ?? null,
    ),
    addParticipant: jest.fn(async (channelId: string, userId: string) => {
      if (userId === opts.failAddFor) throw new Error('db down');
      const list = participants.get(channelId) ?? [];
      const found = list.find(p => p.userId === userId);
      if (found) return found;
      const p = { id: `p-${channelId}-${userId}`, channelId, userId };
      list.push(p);
      participants.set(channelId, list);
      return p;
    }),
    removeParticipant: jest.fn(async (channelId: string, userId: string) => {
      participants.set(
        channelId,
        (participants.get(channelId) ?? []).filter(p => p.userId !== userId),
      );
    }),
  };

  const conversationRepository = {
    moveConversationsToChannel: jest.fn(async () => ({ moved: 3, remaining: 0 })),
  };

  const userRepository = {
    findByIdInWorkspace: jest.fn(async (id: string) => ({
      id,
      name: id,
      displayName: id,
      status: 'ACTIVE',
    })),
    findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map(id => ({ id, name: id, displayName: id })),
    ),
  };

  const service = new GroupDmParticipantService();
  Object.assign(service as unknown as Record<string, unknown>, {
    channelRepository,
    channelParticipantRepository,
    conversationRepository,
    userRepository,
    projectRepository: { getDMProjectId: jest.fn(async () => 'dm-project') },
  });

  return { service, channels, participants, channelRepository, conversationRepository };
}

const base = { channelId: 'src', currentUserId: 'alice', workspaceId: 'ws' };

describe('GroupDmParticipantService.addParticipants — in-place group DM add', () => {
  it('adds people to the same GROUP_DM and updates its member key when history is "beginning"', async () => {
    const t = makeService({ scopeType: ChannelScopeType.GROUP_DM, members: ['alice', 'bob', 'carol'] });

    const result = await t.service.addParticipants({
      ...base,
      userIds: ['dave'],
      historyScope: { mode: 'beginning' },
    });

    expect(result.channelId).toBe('src');
    expect(result.isExisting).toBe(false);
    expect(result.participantsAdded).toBe(1);
    expect(result.addedParticipants.map(p => p.userId)).toEqual(['dave']);
    expect(result.conversationsMoved).toBe(0);
    expect(t.channels.src.name).toBe('alice,bob,carol,dave');
    expect(t.channelRepository.create).not.toHaveBeenCalled();
    expect(t.conversationRepository.moveConversationsToChannel).not.toHaveBeenCalled();
  });

  it('falls back to the existing group when one already has the resulting member set', async () => {
    const t = makeService({
      scopeType: ChannelScopeType.GROUP_DM,
      members: ['alice', 'bob', 'carol'],
      existingGroupByName: { 'alice,bob,carol,dave': { id: 'other' } },
    });

    const result = await t.service.addParticipants({
      ...base,
      userIds: ['dave'],
      historyScope: { mode: 'beginning' },
    });

    expect(result.channelId).toBe('other');
    expect(result.isExisting).toBe(true);
    expect(t.channels.src.name).toBe('alice,bob,carol');
  });

  it('keeps forking a new group for narrower history scopes', async () => {
    const t = makeService({ scopeType: ChannelScopeType.GROUP_DM, members: ['alice', 'bob', 'carol'] });

    const result = await t.service.addParticipants({
      ...base,
      userIds: ['dave'],
      historyScope: { mode: 'none' },
    });

    expect(result.channelId).toBe('new');
    expect(t.channels.src.name).toBe('alice,bob,carol');
  });

  it('still creates a new group when adding to a 1:1 DM, even with full history', async () => {
    const t = makeService({ scopeType: ChannelScopeType.DM, members: ['alice', 'bob'] });

    const result = await t.service.addParticipants({
      ...base,
      userIds: ['carol'],
      historyScope: { mode: 'beginning' },
    });

    expect(result.channelId).toBe('new');
    expect(t.channels.src.name).toBe('alice,bob');
  });

  it('rolls back newly added members if the in-place add fails partway', async () => {
    const t = makeService({
      scopeType: ChannelScopeType.GROUP_DM,
      members: ['alice', 'bob', 'carol'],
      failAddFor: 'erin',
    });

    await expect(
      t.service.addParticipants({
        ...base,
        userIds: ['dave', 'erin'],
        historyScope: { mode: 'beginning' },
      }),
    ).rejects.toThrow('db down');

    expect((t.participants.get('src') ?? []).map(p => p.userId).sort()).toEqual([
      'alice',
      'bob',
      'carol',
    ]);
    expect(t.channels.src.name).toBe('alice,bob,carol');
  });

  it('rejects in-place adds past the participant limit', async () => {
    const members = ['alice', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8', 'u9'];
    const t = makeService({ scopeType: ChannelScopeType.GROUP_DM, members });

    await expect(
      t.service.addParticipants({ ...base, userIds: ['x'], historyScope: { mode: 'beginning' } }),
    ).rejects.toThrow(/Maximum/);
  });
});
