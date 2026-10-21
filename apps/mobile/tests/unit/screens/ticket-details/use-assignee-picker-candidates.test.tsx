/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports and cannot reference module scope */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { type ReactElement } from 'react';
import { act, create } from 'react-test-renderer';

jest.mock('@xyne/shared', () => require('../../../mocks/xyne-shared'));

type TestUser = {
  id: string;
  name: string;
  email: string;
  isDeactivated?: boolean;
};

const mockBaseUsers: TestUser[] = [
  { id: 'u-1', name: 'Ada Lovelace', email: 'ada@example.com' },
  { id: 'u-2', name: 'Grace Hopper', email: 'grace@example.com' },
  { id: 'u-3', name: 'Alan Turing', email: 'alan@example.com' },
  { id: 'u-deactivated', name: 'Old Account', email: 'old@example.com', isDeactivated: true },
];

const mockState = {
  users: [...mockBaseUsers] as TestUser[],
  participants: [{ userId: 'u-1' }, { userId: 'u-2' }] as Array<{ userId: string }>,
  groupMappings: [{ userId: 'u-3' }] as Array<{ userId: string }>,
};

jest.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => mockState.users,
}));

jest.mock('@/src/utils/channel-utils', () => ({
  getUserDisplayName: (user: { name: string }) => user.name,
}));

jest.mock('@/src/utils/statusUtils', () => ({
  isUserDeactivated: (user: { isDeactivated?: boolean }) => user.isDeactivated === true,
}));

jest.mock('@/src/zero/queries', () => ({
  queries: {
    channelParticipants: jest.fn((args: { channelId: string }) => ({
      kind: 'participants' as const,
      ...args,
    })),
    getUserGroupMembers: jest.fn((args: { userGroupId: string }) => ({
      kind: 'groupMembers' as const,
      ...args,
    })),
  },
}));

jest.mock('@/src/hooks/useQuery', () => ({
  useQuery: (query: { kind?: string }, options?: { enabled?: boolean }) => {
    if (options?.enabled === false) return [[]];
    if (query?.kind === 'groupMembers') return [mockState.groupMappings];
    return [mockState.participants];
  },
}));

import { useAssigneePickerCandidates } from '@/src/screens/ticket-details/use-assignee-picker-candidates';
import { queries } from '@/src/zero/queries';

type Latest = ReturnType<typeof useAssigneePickerCandidates>;
let latest!: Latest;

function Probe(props: {
  channelId?: string;
  userGroupId?: string | null;
  query?: string;
  selectedUserId?: string | null;
  maxVisible?: number;
}): ReactElement | null {
  latest = useAssigneePickerCandidates({
    channelId: props.channelId ?? 'ch-1',
    userGroupId: props.userGroupId ?? null,
    query: props.query ?? '',
    selectedUserId: props.selectedUserId ?? null,
    ...(props.maxVisible !== undefined ? { maxVisible: props.maxVisible } : {}),
  });
  return null;
}

const mount = (props: Parameters<typeof Probe>[0] = {}): void => {
  act(() => {
    create(<Probe {...props} />);
  });
};

describe('useAssigneePickerCandidates', () => {
  beforeEach(() => {
    mockState.users = [...mockBaseUsers];
    mockState.participants = [{ userId: 'u-1' }, { userId: 'u-2' }];
    mockState.groupMappings = [{ userId: 'u-3' }];
    jest.mocked(queries.channelParticipants).mockClear();
    jest.mocked(queries.getUserGroupMembers).mockClear();
  });

  it('unions channel participants and group members, skips deactivated, sorts by name', () => {
    mount({ userGroupId: 'g-1' });
    expect(latest.candidates.map(u => u.id)).toEqual(['u-1', 'u-3', 'u-2']);
  });

  it('strips group: prefix when loading group members', () => {
    mount({ userGroupId: 'group:g-99' });
    expect(queries.getUserGroupMembers).toHaveBeenCalledWith({ userGroupId: 'g-99' });
  });

  it('filters by name or email and updates empty label', () => {
    mount({ query: 'grace' });
    expect(latest.candidates.map(u => u.id)).toEqual(['u-2']);

    mount({ query: 'zzz' });
    expect(latest.candidates).toEqual([]);
    expect(latest.emptyLabel).toBe('No matching members');
  });

  it('pins the selected user first', () => {
    mount({ selectedUserId: 'u-2' });
    expect(latest.candidates[0]?.id).toBe('u-2');
  });

  it('caps the list at maxVisible (default 10)', () => {
    mockState.participants = Array.from({ length: 15 }, (_, i) => ({ userId: `extra-${i}` }));
    mockState.users = mockState.participants.map((p, i) => ({
      id: p.userId,
      name: `User ${String(i).padStart(2, '0')}`,
      email: `u${i}@example.com`,
    }));

    mount({ maxVisible: 5 });
    expect(latest.candidates).toHaveLength(5);

    mount({});
    expect(latest.candidates).toHaveLength(10);
  });

  it('reports no members when channel and group are empty', () => {
    mockState.participants = [];
    mockState.groupMappings = [];
    mount({ userGroupId: null });
    expect(latest.candidates).toEqual([]);
    expect(latest.emptyLabel).toBe('No members found in this channel or group');
  });
});
