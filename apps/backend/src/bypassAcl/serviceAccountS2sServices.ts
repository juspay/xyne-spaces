/**
 * The /api/s2s/v1 operations. An S2S request has no req.user — it is authenticated by a service
 * account's key — so each operation opens a service scope bound to that account's workspace, the
 * same way unauthenticated webhook handlers do. The account's own rules (ServiceAccountPolicy)
 * still decide what it may touch.
 */
import type { ServiceAccount } from '@prisma/client';
import { issueSpacesToken } from '@/serviceAccounts/login';
import {
  createUser,
  listUsers,
  updateUser,
  type ListUsersInput,
  type UpdateUserInput,
} from '@/serviceAccounts/users';
import { asService, type TableName } from './base';

const USER_TABLES: TableName[] = [
  'User',
  'OrgMember',
  'Workspace',
  'GuestAccess',
  'ChannelParticipant',
  'ChannelUserStatus',
  'ChannelStats',
  'Channel',
  'ServiceAccountResource',
];

function asServiceAccount<T>(account: ServiceAccount, tables: TableName[], reason: string, fn: () => Promise<T>): Promise<T> {
  return asService(tables, reason, `service-account:${account.id}`, account.workspaceId, fn);
}

export function s2sCreateUser(account: ServiceAccount, input: Parameters<typeof createUser>[1]) {
  return asServiceAccount(account, USER_TABLES, 'S2S user create: key-authenticated, no req.user', () =>
    createUser(account, input),
  );
}

export function s2sListUsers(account: ServiceAccount, input: ListUsersInput) {
  return asServiceAccount(account, ['User', 'GuestAccess'], 'S2S user list: key-authenticated, no req.user', () =>
    listUsers(account, input),
  );
}

export function s2sUpdateUser(account: ServiceAccount, input: UpdateUserInput) {
  return asServiceAccount(account, USER_TABLES, 'S2S user update: key-authenticated, no req.user', () =>
    updateUser(account, input),
  );
}

export function s2sIssueSpacesToken(account: ServiceAccount, email: string) {
  return asServiceAccount(account, ['User', 'OrgMember'], 'S2S token: key-authenticated, no req.user', () =>
    issueSpacesToken(account, 'email', { email }),
  );
}
