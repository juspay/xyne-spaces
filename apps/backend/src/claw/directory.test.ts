const mockUserFindMany = jest.fn(async (_a: unknown) => [] as unknown[]);
const mockUserFindUnique = jest.fn();
const mockGroupFindMany = jest.fn(async (_a: unknown) => [] as unknown[]);
jest.mock('@xyne/shared', () => ({ UserType: { USER: 'USER' } }));
jest.mock('@/database/client', () => ({
  db: {
    user: { findMany: (a: unknown) => mockUserFindMany(a), findUnique: (a: unknown) => mockUserFindUnique(a) },
    workspace: { findUnique: jest.fn(async () => ({ orgId: 'org1' })) },
    userGroup: { findMany: (a: unknown) => mockGroupFindMany(a) },
  },
}));
jest.mock('@/database/tenant/context', () => ({ runAsSystem: (fn: () => unknown) => fn() }));

import { directoryUser, groupsByAlias, usersByEmail, usersByHandle, usersByName } from './directory';

type Args = { where: Record<string, unknown>; select: Record<string, boolean>; take: number };
const lastArgs = (m: jest.Mock) => m.mock.calls.at(-1)![0] as Args;

beforeEach(() => jest.clearAllMocks());

describe('claw-auth directory lookups', () => {
  it('mention lookups: active humans only, at most 2, id + name only, scoped to the workspace', async () => {
    await usersByName('Ada Lovelace', 'ws1');
    const a = lastArgs(mockUserFindMany);
    expect(a.where).toMatchObject({ userType: 'USER', status: 'ACTIVE', workspaceId: 'ws1' });
    expect(a.take).toBe(2);
    expect(a.select).toEqual({ id: true, name: true });
  });

  it('email and handle lookups are scoped and limited; a handle with @ is refused', async () => {
    await usersByEmail('ada@x.io', 'ws1');
    expect(lastArgs(mockUserFindMany).where).toMatchObject({ status: 'ACTIVE', workspaceId: 'ws1' });
    await usersByHandle('ada.l', 'ws1');
    expect(lastArgs(mockUserFindMany).where).toMatchObject({ email: { startsWith: 'ada.l@' } });
    mockUserFindMany.mockClear();
    expect(await usersByHandle('ada@x.io')).toEqual([]);
    expect(await usersByName('  ')).toEqual([]);
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });

  it('groups: active, by alias, scoped to the workspace', async () => {
    await groupsByAlias('data-intel', 'ws1');
    expect(lastArgs(mockGroupFindMany).where).toMatchObject({ isActive: true, workspaceId: 'ws1' });
    expect(lastArgs(mockGroupFindMany).take).toBe(2);
  });

  it('one user: minimal profile fields, never secrets', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'u1', email: 'a@x.io', name: 'Ada', orgMemberId: 'm1', workspaceId: 'ws1', status: 'ACTIVE' });
    expect(await directoryUser('u1')).toEqual({ id: 'u1', email: 'a@x.io', name: 'Ada', spacesOrgMemberId: 'm1', workspaceId: 'ws1', spacesOrgId: 'org1', status: 'ACTIVE' });
    expect(Object.keys((mockUserFindUnique.mock.calls[0]![0] as Args).select).sort()).toEqual(['email', 'id', 'name', 'orgMemberId', 'status', 'workspaceId']);
  });
});
