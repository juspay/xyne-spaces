import { randomUUID } from 'node:crypto';
import { Prisma, type User } from '@prisma/client';
import { ChannelScopeType, GuestEntity, UserStatus, WorkspaceRole } from '@xyne/shared';
import { applyGuestChanges, findOrgMembers, insertGuest, isOrgEmailTaken } from '@/bypassAcl/appGuestServices';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { grantPermissionsForRole } from '@/services/permissionMatrix';
import { OrgMemberLimitError, organizationDomainService } from '@/services/organizationDomainService';
import { logger } from '@/utils/logger';
import { mintGuestToken } from './guestToken';

/**
 * An app's guest users: people outside the workspace, owned by the installed app that created them
 * (providerUserId `app:<installedAppId>:<uuid>`). An app may only give its guests channels it created
 * (its bot is the creator), not ones it was only added to.
 */

/** The installed app acting, from its verified token: its install and its bot user. */
export interface GuestApp {
  installedAppId: string;
  botUserId: string;
  workspaceId: string;
}

/** A refusal the controller sends as `{ error, code }` with this status. */
export class GuestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export interface GuestView {
  userId: string;
  email: string;
  displayName: string;
  channelIds: string[];
  status: 'ACTIVE' | 'DEACTIVATED';
  createdAt: string;
  updatedAt: string;
}

const ownedPrefix = (app: GuestApp): string => `app:${app.installedAppId}:`;
const isActive = (user: Pick<User, 'status' | 'leftAt'>): boolean => user.status === UserStatus.ACTIVE && !user.leftAt;
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

function toView(user: User, channelIds: string[]): GuestView {
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

function findByEmail(workspaceId: string, email: string): Promise<User | null> {
  return db.user.findFirst({ where: { workspaceId, email: { equals: email, mode: 'insensitive' } } });
}

/** 404 also for users the app doesn't own. */
async function findOwnedGuest(app: GuestApp, email: string): Promise<User> {
  const user = await findByEmail(app.workspaceId, normalizeEmail(email));
  if (!user || !user.providerUserId.startsWith(ownedPrefix(app))) {
    throw new GuestError(404, 'USER_NOT_FOUND', 'No user with that email.');
  }
  return user;
}

/** The channels the app created, optionally narrowed to `ids`. */
async function appChannelIds(app: GuestApp, ids?: string[]): Promise<Set<string>> {
  const rows = await db.channel.findMany({
    where: { createdBy: app.botUserId, workspaceId: app.workspaceId, ...(ids && { id: { in: ids } }) },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/** Refuses any channel the app didn't create. */
async function assertAppChannels(app: GuestApp, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const allowed = await appChannelIds(app, ids);
  const notAllowed = ids.filter((id) => !allowed.has(id));
  if (notAllowed.length > 0) {
    throw new GuestError(403, 'CHANNEL_NOT_ALLOWED', `${notAllowed.join(', ')} is not a channel this app created.`);
  }
}

/** Channels a guest can be added to: live, and not a direct message. */
async function assertGrantable(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const channels = await db.channel.findMany({
    where: { id: { in: ids } },
    select: { id: true, isArchived: true, scopeType: true },
  });
  const archived = channels.filter((channel) => channel.isArchived).map((channel) => channel.id);
  if (archived.length > 0) {
    throw new GuestError(400, 'CHANNEL_ARCHIVED', `${archived.join(', ')} is archived.`);
  }
  const dms = channels
    .filter((channel) => channel.scopeType === ChannelScopeType.DM || channel.scopeType === ChannelScopeType.GROUP_DM)
    .map((channel) => channel.id);
  if (dms.length > 0) {
    throw new GuestError(400, 'CHANNEL_NOT_ALLOWED', `${dms.join(', ')} is a direct message.`);
  }
}

/** Each guest's channels, from guest_access (oldest first). */
async function guestChannels(workspaceId: string, userIds: string[]): Promise<Map<string, string[]>> {
  const rows = await db.guestAccess.findMany({
    where: { workspaceId, userId: { in: userIds }, accessibleEntityType: GuestEntity.CHANNEL },
    select: { userId: true, accessibleEntityId: true },
    orderBy: { createdAt: 'asc' },
  });
  const byUser = new Map<string, string[]>();
  for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.accessibleEntityId]);
  return byUser;
}

/** Where each new member's read cursor starts, as for any channel join. */
async function seenCutoffs(channelIds: string[]): Promise<Map<string, Date | null>> {
  return new Map(
    await Promise.all(
      channelIds.map(async (id) => [id, await repositories.channelParticipants.resolveSeenCutoff(id)] as const),
    ),
  );
}

export async function createGuest(
  app: GuestApp,
  input: { email: string; displayName: string; channelIds: string[] },
): Promise<GuestView> {
  const { workspaceId } = app;
  const email = normalizeEmail(input.email);
  const channelIds = [...new Set(input.channelIds)];
  await assertAppChannels(app, channelIds);
  await assertGrantable(channelIds);

  const existing = await findByEmail(workspaceId, email);
  if (existing) {
    // grantPermissionsForRole only logs failures; a retry of the create finishes it (it is add-only).
    if (existing.providerUserId.startsWith(ownedPrefix(app))) {
      await grantPermissionsForRole(existing.id, existing.email, WorkspaceRole.GUEST, workspaceId);
    }
    throw new GuestError(409, 'USER_EXISTS', 'A user with this email already exists.');
  }
  // org_members.email is globally unique. An existing membership is never reused: an app's
  // assertion of an email must not attach it to a real person's identity.
  if (await isOrgEmailTaken(app, email)) {
    throw new GuestError(409, 'EMAIL_UNAVAILABLE', 'This email already belongs to a Spaces account.');
  }
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { orgId: true } });
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);
  try {
    await organizationDomainService.assertOrgMemberLimit(workspace.orgId, email);
  } catch (err) {
    if (err instanceof OrgMemberLimitError) {
      throw new GuestError(403, 'SEAT_LIMIT_REACHED', 'The organization has no seats left.');
    }
    throw err;
  }

  let user: User;
  try {
    user = await insertGuest({
      workspaceId,
      orgId: workspace.orgId,
      email,
      displayName: input.displayName.trim(),
      providerUserId: `${ownedPrefix(app)}${randomUUID()}`,
      grantedBy: app.botUserId,
      channelIds,
      seenCutoffs: await seenCutoffs(channelIds),
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new GuestError(409, 'USER_EXISTS', 'A user with this email already exists.');
    }
    throw err;
  }
  await grantPermissionsForRole(user.id, user.email, WorkspaceRole.GUEST, workspaceId);
  logger.info('[app-guests] guest created', { installedAppId: app.installedAppId, userId: user.id });
  return toView(user, channelIds);
}

export interface ListGuestsInput {
  emails?: string[];
  channelId?: string;
  status?: 'ACTIVE' | 'DEACTIVATED';
  limit: number;
  cursor?: string;
}

export async function listGuests(
  app: GuestApp,
  input: ListGuestsInput,
): Promise<{ users: GuestView[]; notFound?: string[]; nextCursor: string | null }> {
  const { workspaceId } = app;
  const emails = input.emails ? [...new Set(input.emails.map(normalizeEmail))] : undefined;
  const afterId = input.cursor ? decodeCursor(input.cursor) : undefined;

  const where: Prisma.UserWhereInput = {
    workspaceId,
    providerUserId: { startsWith: ownedPrefix(app) },
    ...(emails && { email: { in: emails, mode: 'insensitive' } }),
    ...(input.status === 'ACTIVE' && { status: UserStatus.ACTIVE, leftAt: null }),
    ...(input.status === 'DEACTIVATED' && { OR: [{ status: { not: UserStatus.ACTIVE } }, { leftAt: { not: null } }] }),
  };
  const idFilter: Prisma.StringFilter = afterId ? { gt: afterId } : {};
  if (input.channelId) {
    await assertAppChannels(app, [input.channelId]);
    const members = await db.guestAccess.findMany({
      where: { workspaceId, accessibleEntityType: GuestEntity.CHANNEL, accessibleEntityId: input.channelId },
      select: { userId: true },
    });
    idFilter.in = members.map((member) => member.userId);
  }
  if (Object.keys(idFilter).length > 0) where.id = idFilter;

  const page = await db.user.findMany({ where, orderBy: { id: 'asc' }, take: input.limit + 1 });
  const users = page.slice(0, input.limit);
  const held = users.length ? await guestChannels(workspaceId, users.map((user) => user.id)) : new Map<string, string[]>();
  // Only the app's channels: a channel a person gave the guest is not the app's to see.
  const appChannels = await appChannelIds(app);

  const result: { users: GuestView[]; notFound?: string[]; nextCursor: string | null } = {
    users: users.map((user) => toView(user, (held.get(user.id) ?? []).filter((id) => appChannels.has(id)))),
    nextCursor: page.length > input.limit ? Buffer.from(users[users.length - 1].id, 'utf8').toString('base64url') : null,
  };
  if (emails) {
    // Emails with no user at all; ones only filtered out aren't "not found".
    const owned = await db.user.findMany({
      where: { workspaceId, email: { in: emails, mode: 'insensitive' }, providerUserId: { startsWith: ownedPrefix(app) } },
      select: { email: true },
    });
    const found = new Set(owned.map((user) => normalizeEmail(user.email)));
    result.notFound = emails.filter((email) => !found.has(email));
  }
  return result;
}

function decodeCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^[A-Za-z0-9_-]+$/.test(decoded)) {
    throw new GuestError(400, 'CURSOR_INVALID', 'cursor is not valid.');
  }
  return decoded;
}

export interface UpdateGuestInput {
  email: string;
  displayName?: string;
  addChannelIds?: string[];
  removeChannelIds?: string[];
  status?: 'DEACTIVATED';
}

export async function updateGuest(app: GuestApp, input: UpdateGuestInput): Promise<GuestView> {
  const { workspaceId } = app;
  const add = [...new Set(input.addChannelIds ?? [])];
  const remove = [...new Set(input.removeChannelIds ?? [])];
  if (add.some((id) => remove.includes(id))) {
    throw new GuestError(400, 'VALIDATION_ERROR', 'A channel is in both addChannelIds and removeChannelIds.');
  }

  const user = await findOwnedGuest(app, input.email);
  // Channels given some other way aren't the app's to remove.
  await assertAppChannels(app, [...add, ...remove]);
  await assertGrantable(add);

  const current = (await guestChannels(workspaceId, [user.id])).get(user.id) ?? [];
  const toAdd = add.filter((id) => !current.includes(id));
  const toRemove = remove.filter((id) => current.includes(id));
  const after = current.filter((id) => !toRemove.includes(id)).concat(toAdd);
  // Deactivating needs no channel, so an app can always cut a guest off.
  if (toRemove.length > 0 && after.length === 0 && input.status !== 'DEACTIVATED') {
    throw new GuestError(400, 'LAST_CHANNEL', 'A user must keep at least one channel.');
  }

  const data: Prisma.UserUpdateInput = {};
  if (input.displayName !== undefined) data.name = data.displayName = input.displayName.trim();
  // Deactivation only: reactivating is left to Spaces admins, so the app can't undo theirs.
  if (input.status === 'DEACTIVATED' && isActive(user)) {
    data.status = UserStatus.INACTIVE;
    data.leftAt = new Date();
  }

  const updated = await applyGuestChanges({
    workspaceId,
    user,
    data,
    grantedBy: app.botUserId,
    add: toAdd,
    remove: toRemove,
    seenCutoffs: await seenCutoffs(toAdd),
  });
  logger.info('[app-guests] guest updated', { installedAppId: app.installedAppId, userId: user.id });
  const appChannels = await appChannelIds(app);
  return toView(updated, after.filter((id) => appChannels.has(id)));
}

/** A Spaces token for one of the app's active guests. */
export async function issueGuestToken(
  app: GuestApp,
  email: string,
): Promise<{ accessToken: string; expiresAt: string; userId: string }> {
  const user = await findOwnedGuest(app, email);
  const [member] = await findOrgMembers(app, [user.orgMemberId]);
  if (!isActive(user) || !member || member.leftAt) {
    throw new GuestError(403, 'USER_DEACTIVATED', 'This user is deactivated.');
  }
  const { token, expiresAt } = mintGuestToken({
    sub: user.id,
    workspaceId: user.workspaceId,
    memberId: user.orgMemberId,
    app: app.installedAppId,
  });
  return { accessToken: token, expiresAt: expiresAt.toISOString(), userId: user.id };
}
