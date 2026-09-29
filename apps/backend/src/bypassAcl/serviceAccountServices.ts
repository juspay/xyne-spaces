import type { OrgMember, Prisma, ServiceAccount, ServiceAccountKey, User } from '@prisma/client';
import { AuthProvider, OrgRole, UserStatus, WorkspaceRole } from '@xyne/shared';
import { db } from '@/database/client';
import type { ServiceAccountResourceType } from '@/serviceAccounts/constants';
import type { ResourceType } from '@/serviceAccounts/resources';
import type { SpacesTokenClaims } from '@/serviceAccounts/tokens/types';
import { asService, asSystem, transaction } from './base';

/**
 * Relocated from serviceAccounts/keys.ts. An S2S key is looked up by its hash before anything
 * says which workspace it is for — the key is what tells us — so this cannot be workspace-scoped.
 */
export function findServiceAccountKey(
  keyHash: string,
): Promise<{ key: ServiceAccountKey; account: ServiceAccount | null } | null> {
  return asSystem(['ServiceAccountKey', 'ServiceAccount'], 'S2S key auth: the key identifies the workspace', async () => {
    const key = await db.serviceAccountKey.findUnique({ where: { keyHash } });
    if (!key) return null;
    const account = await db.serviceAccount.findUnique({ where: { id: key.serviceAccountId } });
    return { key, account };
  });
}

export function recordServiceAccountKeyUse(keyId: string, at: Date): Promise<unknown> {
  return asSystem(['ServiceAccountKey'], 'S2S key auth: lastUsedAt bookkeeping', () =>
    db.serviceAccountKey.update({ where: { id: keyId }, data: { lastUsedAt: at } }),
  );
}

/**
 * Relocated from serviceAccounts/tokens/subjects. A Spaces token is checked before any request
 * user exists; the rows are read in the workspace the signed token names, keyed by its own ids.
 */
export function loadSpacesTokenRows(
  claims: SpacesTokenClaims,
): Promise<{ user: User | null; orgMember: OrgMember | null; serviceAccount: ServiceAccount | null }> {
  return asService(
    ['User', 'OrgMember', 'ServiceAccount'],
    'Spaces token auth: no request user yet; scoped to the workspace in the verified token',
    claims.sub,
    claims.workspaceId,
    async () => ({
      user: await db.user.findUnique({ where: { id: claims.sub } }),
      orgMember: await db.orgMember.findUnique({ where: { memberId: claims.memberId } }),
      serviceAccount: await db.serviceAccount.findUnique({ where: { id: claims.sa } }),
    }),
  );
}

/** Relocated from serviceAccounts/users.ts createUser: the guest, its membership and channels commit together. */
export function insertServiceAccountUser<P>(args: {
  workspaceId: string;
  orgId: string;
  orgMember: OrgMember | null;
  email: string;
  displayName: string;
  providerUserId: string;
  grantedBy: string;
  resource: ResourceType<P>;
  resourceIds: string[];
  prepared: P;
}): Promise<User> {
  return transaction(
    ['OrgMember', 'User', 'GuestAccess', 'ChannelParticipant', 'ChannelUserStatus', 'ChannelStats'],
    'service account creates a guest: user, membership and channel grants must commit together',
    db,
    async (tx) => {
      const member =
        args.orgMember ??
        (await tx.orgMember.create({ data: { orgId: args.orgId, email: args.email, role: OrgRole.GUEST } }));
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
      for (const id of args.resourceIds) {
        await args.resource.grant(tx, { workspaceId: args.workspaceId, userId: user.id, id, grantedBy: args.grantedBy }, args.prepared);
      }
      return user;
    },
  );
}

/** Relocated from serviceAccounts/users.ts updateUser: profile, status and channel changes commit together. */
export function applyServiceAccountUserChanges<P>(args: {
  workspaceId: string;
  user: User;
  data: Prisma.UserUpdateInput;
  grantedBy: string;
  resource: ResourceType<P>;
  add: string[];
  remove: string[];
  prepared: P;
}): Promise<User> {
  return transaction(
    ['User', 'GuestAccess', 'ChannelParticipant', 'ChannelUserStatus', 'ChannelStats'],
    'service account updates its guest: profile and channel grants must commit together',
    db,
    async (tx) => {
      const user =
        Object.keys(args.data).length > 0
          ? await tx.user.update({ where: { id: args.user.id }, data: args.data })
          : args.user;
      for (const id of args.add) {
        await args.resource.grant(tx, { workspaceId: args.workspaceId, userId: user.id, id, grantedBy: args.grantedBy }, args.prepared);
      }
      for (const id of args.remove) {
        await args.resource.revoke(tx, { workspaceId: args.workspaceId, userId: user.id, id });
      }
      return user;
    },
  );
}

/** Relocated from serviceAccounts/admin/resources.ts: disconnecting also takes it from the account's users. */
export function removeServiceAccountResource(args: {
  workspaceId: string;
  serviceAccountId: string;
  type: ServiceAccountResourceType;
  resourceId: string;
  resource: ResourceType;
  userIds: string[];
}): Promise<void> {
  return transaction(
    ['ServiceAccountResource', 'GuestAccess', 'ChannelParticipant', 'ChannelUserStatus', 'ChannelStats'],
    'disconnect: the resource and the grants it backed must go together',
    db,
    async (tx) => {
      await tx.serviceAccountResource.delete({
        where: {
          serviceAccountId_resourceType_resourceId: {
            serviceAccountId: args.serviceAccountId,
            resourceType: args.type,
            resourceId: args.resourceId,
          },
        },
      });
      for (const userId of args.userIds) {
        await args.resource.revoke(tx, { workspaceId: args.workspaceId, userId, id: args.resourceId });
      }
    },
  );
}
