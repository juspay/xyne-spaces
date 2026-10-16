import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Channel, ChannelScopeType, ChannelType, ChannelVisibility } from '@xyne/shared';
import type { User } from '@/src/machines/appStateMachine';
import {
  isDMChannel,
  isGroupDMChannel,
  shouldShowMessageAvatars,
  parseDMParticipantIds,
  getOtherParticipantIds,
  isSelfDmChannel,
  getDmAvatarUserIds,
  findOneToOneDmChannel,
  getActiveUserStatus,
  getUserDisplayName,
  getChannelDisplayName,
  classifyConversationHeaderTitle,
  getChannelNameUsersMap,
} from '@/src/utils/channel-utils';

const createUser = (id: string, overrides: Partial<User> = {}): User =>
  ({
    id,
    name: `User ${id}`,
    email: `${id}@example.com`,
    authProvider: 'GOOGLE',
    providerUserId: `provider-${id}`,
    status: 'ACTIVE',
    userType: 'USER',
    workspaceId: 'workspace-1',
    role: 'MEMBER',
    orgMemberId: `member-${id}`,
    createdAt: 1,
    updatedAt: 1,
    calendarVisibility: 'PUBLIC',
    ...overrides,
  }) as User;

const createChannel = (overrides: Partial<Channel> = {}): Channel =>
  ({
    id: 'channel-1',
    name: 'general',
    type: ChannelType.DEFAULT,
    scopeType: ChannelScopeType.DEFAULT,
    visibility: ChannelVisibility.PUBLIC,
    createdAt: 1,
    updatedAt: 1,
    lastActivityAt: 1,
    createdBy: 'user-a',
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    participantCount: 2,
    isArchived: false,
    ...overrides,
  }) as Channel;

describe('channel scope predicates', () => {
  it('isDMChannel is true for DM and GROUP_DM only', () => {
    assert.equal(isDMChannel(ChannelScopeType.DM), true);
    assert.equal(isDMChannel(ChannelScopeType.GROUP_DM), true);
    assert.equal(isDMChannel(ChannelScopeType.DEFAULT), false);
  });

  it('isGroupDMChannel is true only for GROUP_DM', () => {
    assert.equal(isGroupDMChannel(ChannelScopeType.GROUP_DM), true);
    assert.equal(isGroupDMChannel(ChannelScopeType.DM), false);
  });

  it('shouldShowMessageAvatars is true for channels and group DMs, not 1:1 DMs', () => {
    assert.equal(shouldShowMessageAvatars(ChannelScopeType.DEFAULT), true);
    assert.equal(shouldShowMessageAvatars(ChannelScopeType.GROUP_DM), true);
    assert.equal(shouldShowMessageAvatars(ChannelScopeType.DM), false);
  });
});

describe('parseDMParticipantIds / getOtherParticipantIds', () => {
  it('splits the comma-joined name for DM channels', () => {
    assert.deepEqual(parseDMParticipantIds({ name: 'u1,u2', scopeType: ChannelScopeType.DM }), [
      'u1',
      'u2',
    ]);
  });

  it('returns [] for non-DM channels regardless of name', () => {
    assert.deepEqual(
      parseDMParticipantIds({ name: 'u1,u2', scopeType: ChannelScopeType.DEFAULT }),
      [],
    );
  });

  it('drops empty segments from a trailing/duplicate comma', () => {
    assert.deepEqual(
      parseDMParticipantIds({ name: 'u1,,u2,', scopeType: ChannelScopeType.GROUP_DM }),
      ['u1', 'u2'],
    );
  });

  it('excludes the current user from the other-participant list', () => {
    assert.deepEqual(
      getOtherParticipantIds({ name: 'me,them', scopeType: ChannelScopeType.DM }, 'me'),
      ['them'],
    );
  });
});

describe('self-DM handling', () => {
  it('isSelfDmChannel is true only for a single-participant DM equal to the user', () => {
    assert.equal(isSelfDmChannel({ name: 'me', scopeType: ChannelScopeType.DM }, 'me'), true);
    assert.equal(isSelfDmChannel({ name: 'me,them', scopeType: ChannelScopeType.DM }, 'me'), false);
    assert.equal(
      isSelfDmChannel({ name: 'me', scopeType: ChannelScopeType.GROUP_DM }, 'me'),
      false,
    );
  });

  it('getDmAvatarUserIds returns self for a self-DM, else the other participants', () => {
    assert.deepEqual(getDmAvatarUserIds({ name: 'me', scopeType: ChannelScopeType.DM }, 'me'), [
      'me',
    ]);
    assert.deepEqual(
      getDmAvatarUserIds({ name: 'me,them', scopeType: ChannelScopeType.DM }, 'me'),
      ['them'],
    );
  });
});

describe('findOneToOneDmChannel', () => {
  const channels = [
    { id: 'c-self', name: 'me', scopeType: ChannelScopeType.DM },
    { id: 'c-dm', name: 'me,them', scopeType: ChannelScopeType.DM },
    { id: 'c-group', name: 'me,them,other', scopeType: ChannelScopeType.GROUP_DM },
  ];

  it('finds the 1:1 DM containing both users', () => {
    assert.equal(findOneToOneDmChannel(channels, 'me', 'them')?.id, 'c-dm');
  });

  it('returns the self-DM when target equals current user', () => {
    assert.equal(findOneToOneDmChannel(channels, 'me', 'me')?.id, 'c-self');
  });

  it('does not match a group DM as a 1:1', () => {
    assert.equal(findOneToOneDmChannel(channels, 'me', 'other'), undefined);
  });
});

describe('getActiveUserStatus', () => {
  it('returns undefined when there is no status emoji', () => {
    assert.equal(getActiveUserStatus({ statusEmoji: null }), undefined);
  });

  it('returns the status when expiry is in the future', () => {
    assert.deepEqual(
      getActiveUserStatus({
        statusEmoji: '🎯',
        statusContent: 'Focusing',
        statusExpiryAt: Date.now() + 60_000,
      }),
      { emoji: '🎯', content: 'Focusing' },
    );
  });

  it('returns undefined when the status has expired', () => {
    assert.equal(
      getActiveUserStatus({ statusEmoji: '🎯', statusExpiryAt: Date.now() - 60_000 }),
      undefined,
    );
  });

  it('treats a missing expiry as never-expiring', () => {
    assert.deepEqual(getActiveUserStatus({ statusEmoji: '💤' }), {
      emoji: '💤',
      content: undefined,
    });
  });
});

describe('getUserDisplayName', () => {
  it('returns Unknown for null/undefined', () => {
    assert.equal(getUserDisplayName(null), 'Unknown');
    assert.equal(getUserDisplayName(undefined), 'Unknown');
  });

  it('prefers displayName, then name, then email', () => {
    assert.equal(getUserDisplayName(createUser('a', { displayName: 'Ada' })), 'Ada');
    assert.equal(getUserDisplayName(createUser('a', { displayName: '', name: 'Grace' })), 'Grace');
    assert.equal(
      getUserDisplayName(createUser('a', { displayName: '', name: '', email: 'e@x.io' })),
      'e@x.io',
    );
  });
});

describe('getChannelDisplayName', () => {
  it('returns the raw name for non-DM channels', () => {
    const channel = createChannel({ name: 'engineering', scopeType: ChannelScopeType.DEFAULT });
    assert.equal(getChannelDisplayName(channel, 'me', new Map()), 'engineering');
  });

  it('shows the other person for a 1:1 DM', () => {
    const channel = createChannel({ name: 'me,them', scopeType: ChannelScopeType.DM });
    const users = new Map<string, User>([['them', createUser('them', { displayName: 'Linus' })]]);
    assert.equal(getChannelDisplayName(channel, 'me', users), 'Linus');
  });

  it('falls back to "Unknown User" when the DM peer is not in the map', () => {
    const channel = createChannel({ name: 'me,them', scopeType: ChannelScopeType.DM });
    assert.equal(getChannelDisplayName(channel, 'me', new Map()), 'Unknown User');
  });

  it('renders a self-DM as "<name> (you)"', () => {
    const channel = createChannel({ name: 'me', scopeType: ChannelScopeType.DM });
    const users = new Map<string, User>([['me', createUser('me', { displayName: 'Me' })]]);
    assert.equal(getChannelDisplayName(channel, 'me', users), 'Me (you)');
  });

  it('joins names for a small group DM', () => {
    const channel = createChannel({ name: 'me,a,b', scopeType: ChannelScopeType.GROUP_DM });
    const users = new Map<string, User>([
      ['a', createUser('a', { displayName: 'Alice' })],
      ['b', createUser('b', { displayName: 'Bob' })],
    ]);
    assert.equal(getChannelDisplayName(channel, 'me', users), 'Alice, Bob');
  });

  it('summarises a large group DM as "x, y, z and N others"', () => {
    const channel = createChannel({
      name: 'me,a,b,c,d,e',
      scopeType: ChannelScopeType.GROUP_DM,
    });
    const users = new Map<string, User>([
      ['a', createUser('a', { displayName: 'A' })],
      ['b', createUser('b', { displayName: 'B' })],
      ['c', createUser('c', { displayName: 'C' })],
      ['d', createUser('d', { displayName: 'D' })],
      ['e', createUser('e', { displayName: 'E' })],
    ]);
    // otherIds = [a,b,c,d,e] (5) -> first 3 names + "and 2 others".
    assert.equal(getChannelDisplayName(channel, 'me', users), 'A, B, C and 2 others');
  });
});

describe('classifyConversationHeaderTitle', () => {
  it('is pending until visible channels are published, then unknown', () => {
    assert.equal(
      classifyConversationHeaderTitle({
        channel: null,
        currentUserId: 'me',
        usersById: new Map(),
        visibleChannelsReady: false,
        usersReady: false,
      }),
      'pending',
    );
    assert.equal(
      classifyConversationHeaderTitle({
        channel: null,
        currentUserId: 'me',
        usersById: new Map(),
        visibleChannelsReady: true,
        usersReady: true,
      }),
      'unknown',
    );
  });

  it('holds a missing channel as pending during a notification open', () => {
    assert.equal(
      classifyConversationHeaderTitle({
        channel: null,
        currentUserId: 'me',
        usersById: new Map(),
        visibleChannelsReady: true,
        usersReady: true,
        holdAbsentChannel: true,
      }),
      'pending',
    );
  });

  it('resolves a DEFAULT channel as soon as the row exists', () => {
    assert.equal(
      classifyConversationHeaderTitle({
        channel: { name: 'general', scopeType: ChannelScopeType.DEFAULT },
        currentUserId: 'me',
        usersById: new Map(),
        visibleChannelsReady: true,
        usersReady: false,
      }),
      'resolved',
    );
  });

  it('keeps a DM pending until the user directory is ready, then unknown_user', () => {
    const channel = { name: 'me,them', scopeType: ChannelScopeType.DM };
    assert.equal(
      classifyConversationHeaderTitle({
        channel,
        currentUserId: 'me',
        usersById: new Map(),
        visibleChannelsReady: true,
        usersReady: false,
      }),
      'pending',
    );
    assert.equal(
      classifyConversationHeaderTitle({
        channel,
        currentUserId: 'me',
        usersById: new Map(),
        visibleChannelsReady: true,
        usersReady: true,
      }),
      'unknown_user',
    );
  });

  it('resolves a DM when the peer name is in the map', () => {
    assert.equal(
      classifyConversationHeaderTitle({
        channel: { name: 'me,them', scopeType: ChannelScopeType.DM },
        currentUserId: 'me',
        usersById: new Map([['them', { name: 'Ada' }]]),
        visibleChannelsReady: true,
        usersReady: true,
      }),
      'resolved',
    );
  });

  it('treats a self-DM as resolved without waiting for users', () => {
    assert.equal(
      classifyConversationHeaderTitle({
        channel: { name: 'me', scopeType: ChannelScopeType.DM },
        currentUserId: 'me',
        usersById: new Map(),
        visibleChannelsReady: true,
        usersReady: false,
      }),
      'resolved',
    );
  });
});

describe('getChannelNameUsersMap', () => {
  it('reuses one map for the same user directory array', () => {
    const users = [{ id: 'a', name: 'Ada' }];
    const first = getChannelNameUsersMap(users);
    const second = getChannelNameUsersMap(users);

    assert.equal(first, second);
    assert.equal(first.get('a')?.name, 'Ada');
    assert.notEqual(first, getChannelNameUsersMap([{ id: 'a', name: 'Ada' }]));
  });
});
