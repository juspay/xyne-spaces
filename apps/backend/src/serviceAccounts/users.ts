// A service account's guest users. Access is decided by ServiceAccountPolicy; grants go through
// the resource types, marked with the service account as the granter.
import { randomUUID } from 'node:crypto';
import { Prisma, type ServiceAccount, type User } from '@prisma/client';
import { GuestEntity, OrgRole, UserStatus, WorkspaceRole } from '@xyne/shared';
import { db } from '@/database/client';
import { applyServiceAccountUserChanges, insertServiceAccountUser } from '@/bypassAcl/serviceAccountServices';
import { grantPermissionsForRole } from '@/services/permissionMatrix';
import { OrgMemberLimitError, organizationDomainService } from '@/services/organizationDomainService';
import { logger } from '@/utils/logger';
import { ServiceAccountResourceType } from './constants';
import { ServiceAccountError } from './errors';
import { isActive, ownedUserPrefix } from './ownership';
import { ServiceAccountPolicy } from './policy';
import { resourceType } from './resources';

const channels = resourceType(ServiceAccountResourceType.CHANNEL);

export type UserStatusView = 'ACTIVE' | 'DEACTIVATED';

export interface ServiceAccountUserView {
  userId: string;
  email: string;
  displayName: string;
  channelIds: string[];
  status: UserStatusView;
  createdAt: string;
  updatedAt: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toView(user: User, channelIds: string[]): ServiceAccountUserView {
  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName ?? user.name,
    channelIds,
    status: isActive(user) ? 'ACTIVE' : 'DEACTIVATED',
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

async function findUserByEmail(workspaceId: string, email: string): Promise<User | null> {
  return db.user.findFirst({ where: { workspaceId, email: { equals: email, mode: 'insensitive' } } });
}

/** 404 also for users the account doesn't own. */
export async function findOwnedUser(policy: ServiceAccountPolicy, email: string): Promise<User> {
  const user = await findUserByEmail(policy.workspaceId, normalizeEmail(email));
  if (!user || !policy.canManageUser(user)) {
    throw new ServiceAccountError('not_found', 'No user with that email.');
  }
  return user;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export async function createUser(
  account: ServiceAccount,
  input: { email: string; displayName: string; channelIds: string[] },
): Promise<ServiceAccountUserView> {
  const policy = new ServiceAccountPolicy(account);
  const { workspaceId } = policy;
  const email = normalizeEmail(input.email);
  const displayName = input.displayName.trim();
  const channelIds = [...new Set(input.channelIds)];

  await policy.assertCanGrant(channels.type, channelIds);
  await channels.assertUsable(workspaceId, channelIds);

  if (await findUserByEmail(workspaceId, email)) {
    throw new ServiceAccountError('conflict', 'A user with this email already exists.', { reason: 'user_exists' });
  }

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { orgId: true } });
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

  // org_members.email is globally unique. Only a guest membership of this workspace's org may be
  // reused: an external system must never claim a member's identity (and role) by asserting an email.
  const orgMember = await db.orgMember.findUnique({ where: { email } });
  if (orgMember && (orgMember.leftAt || orgMember.orgId !== workspace.orgId || orgMember.role !== OrgRole.GUEST)) {
    throw new ServiceAccountError('conflict', 'This email belongs to an existing member and cannot be added.', {
      reason: 'email_unavailable',
    });
  }
  if (!orgMember) {
    try {
      await organizationDomainService.assertOrgMemberLimit(workspace.orgId, email);
    } catch (err) {
      if (err instanceof OrgMemberLimitError) {
        throw new ServiceAccountError('forbidden', 'The organization has no seats left.', { reason: 'seat_limit_reached' });
      }
      throw err;
    }
  }

  const prepared = await channels.prepare(channelIds);

  let user: User;
  try {
    user = await insertServiceAccountUser({
      workspaceId,
      orgId: workspace.orgId,
      orgMember,
      email,
      displayName,
      providerUserId: `${ownedUserPrefix(account.id)}${randomUUID()}`,
      grantedBy: account.id,
      resource: channels,
      resourceIds: channelIds,
      prepared,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ServiceAccountError('conflict', 'A user with this email already exists.', { reason: 'user_exists' });
    }
    throw err;
  }

  await grantPermissionsForRole(user.id, user.email, WorkspaceRole.GUEST, workspaceId);
  logger.info('[service-account] user created', { serviceAccountId: account.id, userId: user.id });
  return toView(user, channelIds);
}

export interface ListUsersInput {
  emails?: string[];
  channelId?: string;
  status?: UserStatusView;
  limit: number;
  cursor?: string;
}

export async function listUsers(
  account: ServiceAccount,
  input: ListUsersInput,
): Promise<{ users: ServiceAccountUserView[]; notFound?: string[]; nextCursor: string | null }> {
  const policy = new ServiceAccountPolicy(account);
  const { workspaceId } = policy;
  const prefix = ownedUserPrefix(account.id);
  const emails = input.emails ? [...new Set(input.emails.map(normalizeEmail))] : undefined;
  const afterId = input.cursor ? decodeCursor(input.cursor) : undefined;

  const where: Prisma.UserWhereInput = {
    workspaceId,
    providerUserId: { startsWith: prefix },
    ...(emails && { email: { in: emails, mode: 'insensitive' } }),
    ...(input.status === 'ACTIVE' && { status: UserStatus.ACTIVE, leftAt: null }),
    ...(input.status === 'DEACTIVATED' && {
      OR: [{ status: { not: UserStatus.ACTIVE } }, { leftAt: { not: null } }],
    }),
  };
  const idFilter: Prisma.StringFilter = afterId ? { gt: afterId } : {};
  if (input.channelId) {
    // guest_access has no Prisma relation to users, so find the channel's members first.
    const members = await db.guestAccess.findMany({
      where: { workspaceId, accessibleEntityType: GuestEntity.CHANNEL, accessibleEntityId: input.channelId },
      select: { userId: true },
    });
    idFilter.in = members.map((member) => member.userId);
  }
  if (Object.keys(idFilter).length > 0) where.id = idFilter;

  const page = await db.user.findMany({ where, orderBy: { id: 'asc' }, take: input.limit + 1 });
  const hasMore = page.length > input.limit;
  const users = page.slice(0, input.limit);
  const ids = users.map((user) => user.id);
  const held = ids.length ? await channels.heldBy(workspaceId, ids) : new Map<string, string[]>();

  const result: { users: ServiceAccountUserView[]; notFound?: string[]; nextCursor: string | null } = {
    users: users.map((user) => toView(user, held.get(user.id) ?? [])),
    nextCursor: hasMore ? encodeCursor(ids[ids.length - 1]) : null,
  };
  if (emails) {
    // Emails with no user at all; ones only filtered out aren't "not found".
    const owned = await db.user.findMany({
      where: { workspaceId, email: { in: emails, mode: 'insensitive' }, providerUserId: { startsWith: prefix } },
      select: { email: true },
    });
    const found = new Set(owned.map((user) => normalizeEmail(user.email)));
    result.notFound = emails.filter((email) => !found.has(email));
  }
  return result;
}

function encodeCursor(userId: string): string {
  return Buffer.from(userId, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!decoded || !/^[A-Za-z0-9_-]+$/.test(decoded)) {
    throw new ServiceAccountError('validation_failed', 'cursor is not valid.', { reason: 'cursor_invalid' });
  }
  return decoded;
}

export interface UpdateUserInput {
  email: string;
  displayName?: string;
  addChannelIds?: string[];
  removeChannelIds?: string[];
  status?: 'DEACTIVATED';
}

export async function updateUser(account: ServiceAccount, input: UpdateUserInput): Promise<ServiceAccountUserView> {
  const policy = new ServiceAccountPolicy(account);
  const { workspaceId } = policy;
  const add = [...new Set(input.addChannelIds ?? [])];
  const remove = [...new Set(input.removeChannelIds ?? [])];
  const overlap = add.filter((id) => remove.includes(id));
  if (overlap.length > 0) {
    throw new ServiceAccountError('validation_failed', `${overlap.join(', ')} is in both addChannelIds and removeChannelIds.`);
  }

  const user = await findOwnedUser(policy, input.email);
  // Channels given some other way aren't the service account's to remove.
  await policy.assertCanGrant(channels.type, [...add, ...remove]);
  await channels.assertUsable(workspaceId, add);

  const current = (await channels.heldBy(workspaceId, [user.id])).get(user.id) ?? [];
  const toAdd = add.filter((id) => !current.includes(id));
  const toRemove = remove.filter((id) => current.includes(id));
  const after = current.filter((id) => !toRemove.includes(id)).concat(toAdd);
  if (after.length === 0) {
    throw new ServiceAccountError('validation_failed', 'A user must keep at least one channel.', { reason: 'last_channel' });
  }

  const data: Prisma.UserUpdateInput = {};
  if (input.displayName !== undefined) {
    const displayName = input.displayName.trim();
    data.name = displayName;
    data.displayName = displayName;
  }
  // Deactivation only: reactivating is left to Spaces admins, so the account can't undo theirs.
  if (input.status === 'DEACTIVATED' && isActive(user)) {
    data.status = UserStatus.INACTIVE;
    data.leftAt = new Date();
  }

  const prepared = await channels.prepare(toAdd);
  const updated = await applyServiceAccountUserChanges({
    workspaceId,
    user,
    data,
    grantedBy: account.id,
    resource: channels,
    add: toAdd,
    remove: toRemove,
    prepared,
  });

  logger.info('[service-account] user updated', {
    serviceAccountId: account.id,
    userId: user.id,
    added: toAdd,
    removed: toRemove,
    status: input.status,
  });
  return toView(updated, after);
}
