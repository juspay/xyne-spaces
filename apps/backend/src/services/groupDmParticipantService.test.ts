// XYNE-65314: "Add people" must not carry a deactivated user into a group DM.
jest.mock('@xyne/shared', () => ({
  ChannelRole: { ADMIN: 'ADMIN', MEMBER: 'MEMBER' },
  ChannelScopeType: { DM: 'DM', GROUP_DM: 'GROUP_DM' },
  ChannelVisibility: { PRIVATE: 'PRIVATE' },
  MAX_DM_PARTICIPANTS: 9,
  historyScopeToCutoff: () => null,
}));
jest.mock('@/services/websocketService', () => ({ websocketService: {} }));
jest.mock('@/utils/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

type TestUser = { id: string; name: string; displayName: string; status: string };
const users: Record<string, TestUser> = {
  me: { id: 'me', name: 'Me', displayName: 'Me', status: 'ACTIVE' },
  inactive: { id: 'inactive', name: 'Inactive', displayName: 'Inactive', status: 'INACTIVE' },
  carol: { id: 'carol', name: 'Carol', displayName: 'Carol', status: 'ACTIVE' },
  dave: { id: 'dave', name: 'Dave', displayName: 'Dave', status: 'ACTIVE' },
};
let added: Array<{ channelId: string; userId: string }> = [];
let existing: Array<{ userId: string }> = [];
let scopeType = 'DM';

jest.mock('@/database/repositories/channelRepository', () => ({
  ChannelRepository: jest.fn().mockImplementation(() => ({
    findById: async (id: string) => ({ id, scopeType }),
    getGroupChannelByMembers: async () => null,
    create: async (input: Record<string, unknown>) => ({ id: 'new-group-dm', ...input }),
    delete: jest.fn(),
  })),
}));
jest.mock('@/database/repositories/channelParticipantRepository', () => ({
  ChannelParticipantRepository: jest.fn().mockImplementation(() => ({
    getChannelParticipants: async () => existing,
    addParticipant: async (channelId: string, userId: string) => {
      added.push({ channelId, userId });
      return { id: `p-${userId}`, channelId, userId };
    },
    findParticipant: async (_channelId: string, userId: string) => ({ id: `p-${userId}` }),
    removeParticipant: jest.fn(),
  })),
}));
jest.mock('@/database/repositories/conversationRepository', () => ({
  ConversationRepository: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@/database/repositories/users', () => ({
  UserRepository: jest.fn().mockImplementation(() => ({
    findByIdInWorkspace: async (id: string) => users[id] ?? null,
    findMany: async () => [],
  })),
}));
jest.mock('@/database/repositories/projectRepository', () => ({
  ProjectRepository: jest
    .fn()
    .mockImplementation(() => ({ getDMProjectId: async () => 'dm-project' })),
}));

import { GroupDmParticipantService } from '@/services/groupDmParticipantService';

const addPeople = (channelId: string, userIds: string[]) =>
  new GroupDmParticipantService().addParticipants({
    channelId,
    currentUserId: 'me',
    workspaceId: 'ws',
    userIds,
    historyScope: { mode: 'none' } as never,
  });

describe('GroupDmParticipantService.addParticipants — deactivated users', () => {
  beforeEach(() => {
    added = [];
    scopeType = 'DM';
  });

  it('rejects turning a 1:1 DM with a deactivated user into a group', async () => {
    existing = [{ userId: 'me' }, { userId: 'inactive' }];

    await expect(addPeople('dm-me-inactive', ['carol'])).rejects.toThrow(
      'Cannot create a group with a deactivated member'
    );
    expect(added).toHaveLength(0);
  });

  it('drops deactivated existing members from the new group DM', async () => {
    scopeType = 'GROUP_DM';
    existing = [{ userId: 'me' }, { userId: 'inactive' }, { userId: 'carol' }];

    const result = await addPeople('group-dm', ['dave']);
    const members = added.filter((a) => a.channelId === result.channelId).map((a) => a.userId);

    expect(members.sort()).toEqual(['carol', 'dave', 'me']);
  });

  it('still rejects picking a deactivated user directly', async () => {
    existing = [{ userId: 'me' }, { userId: 'carol' }];

    await expect(addPeople('dm-me-carol', ['inactive'])).rejects.toThrow(
      'One or more participants not found or inactive'
    );
  });

  it('creates a group from an active 1:1 DM as before', async () => {
    existing = [{ userId: 'me' }, { userId: 'carol' }];

    const result = await addPeople('dm-me-carol', ['dave']);
    const members = added.filter((a) => a.channelId === result.channelId).map((a) => a.userId);

    expect(members.sort()).toEqual(['carol', 'dave', 'me']);
  });
});
