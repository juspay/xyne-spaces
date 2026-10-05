/**
 * The parts of an app's guest APIs its bot can't do under its own ACL (it is an ordinary org
 * member): writes that must commit together (an interactive transaction runs without the ACL),
 * other people's org_members rows, and the guest token check, which runs before any request user
 * exists. apps/core/guestUtils decides what the app may touch; everything else there runs as the bot.
 */
import type { InstalledApps, OrgMember, Prisma, User } from '@prisma/client';
import { AuthProvider, GuestEntity, OrgRole, UserStatus, WorkspaceRole } from '@xyne/shared';
import type { GuestTokenClaims } from '@/apps/core/guestToken';
import type { GuestApp } from '@/apps/core/guestUtils';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { asService, transaction } from './base';

/** Whether any org already has this email (org_members.email is unique across orgs). */
export function isOrgEmailTaken(app: GuestApp, email: string): Promise<boolean> {
  return asService(['OrgMember'], 'app guest create: the email check spans every org', app.botUserId, app.workspaceId, async () =>
    !!(await db.orgMember.findUnique({ where: { email }, select: { memberId: true } })),
  );
}

/** Other people's org memberships, to tell who has left the org; the bot only sees its own. */
export function findOrgMembers(app: GuestApp, memberIds: string[]): Promise<Pick<OrgMember, 'memberId' | 'leftAt'>[]> {
  return asService(['OrgMember'], "app guests: read whether these people have left the org", app.botUserId, app.workspaceId, async () =>
    // Awaited here: a Prisma query runs when awaited, and must run inside this scope.
    await db.orgMember.findMany({ where: { memberId: { in: memberIds } }, select: { memberId: true, leftAt: true } }),
  );
}

/**
 * A guest token is checked before any request user exists; the rows are read in the workspace
 * the signed token names, keyed by its own ids.
 */
export function loadGuestTokenRows(claims: GuestTokenClaims): Promise<{
  user: User | null;
  member: OrgMember | null;
  install: InstalledApps | null;
  bot: User | null;
  permissions: string[];
}> {
  return asService(
    ['User', 'OrgMember', 'InstalledApps', 'InstalledAppPermission'],
    'Spaces token auth: no request user yet; scoped to the workspace in the verified token',
    claims.sub,
    claims.workspaceId,
    async () => {
      const install = await db.installedApps.findUnique({ where: { id: claims.app } });
      return {
        user: await db.user.findUnique({ where: { id: claims.sub } }),
        member: await db.orgMember.findUnique({ where: { memberId: claims.memberId } }),
        install,
        bot: install ? await db.user.findUnique({ where: { id: install.userId } }) : null,
        permissions: install
          ? (await repositories.appPermissions.getGrantedPermissionsWithMeta(install.id)).effectiveNames
          : [],
      };
    },
  );
}

// A guest's channel access is two rows (guest_access + channel_participants); the guest ACL
// passes on either, so they are always added and removed together.
async function grantChannel(
  tx: Prisma.TransactionClient,
  args: { workspaceId: string; userId: string; channelId: string; grantedBy: string; seenCutoff: Date | null },
): Promise<void> {
  const { workspaceId, userId, channelId, grantedBy } = args;
  await tx.guestAccess.upsert({
    where: {
      userId_accessibleEntityId_accessibleEntityType: {
        userId,
        accessibleEntityId: channelId,
        accessibleEntityType: GuestEntity.CHANNEL,
      },
    },
    update: { invitedBy: grantedBy },
    create: {
      userId,
      workspaceId,
      accessibleEntityId: channelId,
      accessibleEntityType: GuestEntity.CHANNEL,
      invitedBy: grantedBy,
      createdAt: new Date(),
    },
  });
  await repositories.channelParticipants.addParticipantInTransaction(tx, channelId, userId, args.seenCutoff);
}

async function revokeChannel(
  tx: Prisma.TransactionClient,
  args: { workspaceId: string; userId: string; channelId: string },
): Promise<void> {
  const { workspaceId, userId, channelId } = args;
  await tx.guestAccess.deleteMany({
    where: { workspaceId, userId, accessibleEntityId: channelId, accessibleEntityType: GuestEntity.CHANNEL },
  });
  const removed = await tx.channelParticipant.deleteMany({ where: { channelId, userId } });
  await tx.channelUserStatus.deleteMany({ where: { channelId, userId } });
  if (removed.count > 0) {
    await tx.channelStats.updateMany({ where: { channelId }, data: { participantCount: { decrement: removed.count } } });
  }
}

/** The guest, its membership and channels commit together. */
export function insertGuest(args: {
  workspaceId: string;
  orgId: string;
  email: string;
  displayName: string;
  providerUserId: string;
  grantedBy: string;
  channelIds: string[];
  seenCutoffs: Map<string, Date | null>;
}): Promise<User> {
  return transaction(
    ['OrgMember', 'User', 'GuestAccess', 'ChannelParticipant', 'ChannelUserStatus', 'ChannelStats'],
    'app creates a guest: user, membership and channel grants must commit together',
    db,
    async (tx) => {
      const member = await tx.orgMember.create({ data: { orgId: args.orgId, email: args.email, role: OrgRole.GUEST } });
      const user = await tx.user.create({
        data: {
          email: args.email,
          name: args.displayName,
          displayName: args.displayName,
          providerUserId: args.providerUserId,
          authProvider: AuthProvider.API_KEY,
          workspaceId: args.workspaceId,
          role: WorkspaceRole.GUEST,
          status: UserStatus.ACTIVE,
          orgMemberId: member.memberId,
        },
      });
      for (const channelId of args.channelIds) {
        await grantChannel(tx, {
          workspaceId: args.workspaceId,
          userId: user.id,
          channelId,
          grantedBy: args.grantedBy,
          seenCutoff: args.seenCutoffs.get(channelId) ?? null,
        });
      }
      return user;
    },
  );
}

/** Profile, status and channel changes commit together. */
export function applyGuestChanges(args: {
  workspaceId: string;
  user: User;
  data: Prisma.UserUpdateInput;
  grantedBy: string;
  add: string[];
  remove: string[];
  seenCutoffs: Map<string, Date | null>;
}): Promise<User> {
  return transaction(
    ['User', 'GuestAccess', 'ChannelParticipant', 'ChannelUserStatus', 'ChannelStats'],
    'app updates its guest: profile and channel grants must commit together',
    db,
    async (tx) => {
      const user =
        Object.keys(args.data).length > 0
          ? await tx.user.update({ where: { id: args.user.id }, data: args.data })
          : args.user;
      for (const channelId of args.add) {
        await grantChannel(tx, {
          workspaceId: args.workspaceId,
          userId: user.id,
          channelId,
          grantedBy: args.grantedBy,
          seenCutoff: args.seenCutoffs.get(channelId) ?? null,
        });
      }
      for (const channelId of args.remove) {
        await revokeChannel(tx, { workspaceId: args.workspaceId, userId: user.id, channelId });
      }
      return user;
    },
  );
}
