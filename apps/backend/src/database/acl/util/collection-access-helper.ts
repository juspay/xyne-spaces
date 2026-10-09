import { Prisma, PrismaClient } from '@prisma/client'
import { CollectionRole } from '@xyne/shared'

/**
 * The real collection-permission rule (owner / direct / group / channel grant / public
 * fallback) — previously implemented only in the REST controller's getCollectionOrRole and
 * the Zero query ACL's canSelect. The generic Prisma ACL classes (CollectionsACL etc.) had
 * neither, so a caller that reached collections/items/permissions through the plain ACL-wrapped
 * `db` client (bypassing the controller's own check) got every workspace collection back.
 *
 * Permissions live only on ROOT collections (parentId IS NULL); sub-folders and files inherit
 * through rootCollectionId, which has no Prisma relation (no-FK convention — relationMode is
 * "prisma"), so visibility is computed as an id set here rather than a nested `whereExists`.
 *
 * `write` mirrors resolveCollectionAccess's own rule: public-fallback only ever grants VIEWER
 * (read), never write — a mutator needs to be the owner or hold an explicit EDITOR/OWNER grant.
 */
export async function getAccessibleCollectionRootIds(
  prisma: PrismaClient,
  userId: string,
  workspaceId: string,
  mode: 'read' | 'write',
): Promise<string[]> {
  const [userGroupIds, userChannelIds] = await Promise.all([
    prisma.userGroupMapping.findMany({ where: { userId }, select: { userGroupId: true } }).then(rows => rows.map(r => r.userGroupId)),
    prisma.channelParticipant.findMany({ where: { userId }, select: { channelId: true } }).then(rows => rows.map(r => r.channelId)),
  ])

  const grantWhere: Prisma.CollectionPermissionWhereInput =
    mode === 'write'
      ? {
          role: { in: [CollectionRole.EDITOR, CollectionRole.OWNER] },
          OR: [
            { userId },
            ...(userGroupIds.length ? [{ userGroupId: { in: userGroupIds } }] : []),
            ...(userChannelIds.length ? [{ channelId: { in: userChannelIds } }] : []),
          ],
        }
      : {
          OR: [
            { userId },
            ...(userGroupIds.length ? [{ userGroupId: { in: userGroupIds } }] : []),
            ...(userChannelIds.length ? [{ channelId: { in: userChannelIds } }] : []),
          ],
        }

  const roots = await prisma.collection.findMany({
    where: {
      workspaceId,
      parentId: null,
      OR: [
        { ownerId: userId },
        // Public fallback is read-only — never included for write.
        ...(mode === 'read' ? [{ isPrivate: false }] : []),
        { permissions: { some: grantWhere } },
      ],
    },
    select: { id: true },
  })
  return roots.map(r => r.id)
}
