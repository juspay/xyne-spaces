import { AccessType } from '@xyne/shared';
import { PrismaClient, } from '@prisma/client'

/**
 * True when `userId` has ADMIN access to the named resource — granted directly, or via one of the
 * user's groups. Prisma counterpart of the Zero `admin-access` helpers; shared by table ACLs so the
 * direct-then-group lookup lives in one place.
 */
export async function hasResourceAdminAccess(
  prisma: PrismaClient,
  userId: string,
  resourceName: string,
): Promise<boolean> {
  const resource = await prisma.resource.findUnique({
    where: { name: resourceName },
    select: { id: true },
  })
  if (!resource) return false

  const direct = await prisma.resourceAccess.findFirst({
    where: { userId, resourceId: resource.id, accessType: AccessType.ADMIN },
    select: { id: true },
  })
  if (direct) return true

  const groups = await prisma.userGroupMapping.findMany({
    where: { userId },
    select: { userGroupId: true },
  })
  if (groups.length === 0) return false

  const viaGroup = await prisma.resourceAccess.findFirst({
    where: {
      resourceId: resource.id,
      accessType: AccessType.ADMIN,
      groupId: { in: groups.map(g => g.userGroupId) },
    },
    select: { id: true },
  })
  return viaGroup !== null
}

export const hasProjectAdminAccess = (prisma: PrismaClient, userId: string): Promise<boolean> =>
  hasResourceAdminAccess(prisma, userId, 'LISTPROJECTS')

export const hasUserGroupsAdminAccess = (prisma: PrismaClient, userId: string): Promise<boolean> =>
  hasResourceAdminAccess(prisma, userId, 'USER-GROUPS')

export const hasXyneAppsAdminAccess = (prisma: PrismaClient, userId: string): Promise<boolean> =>
  hasResourceAdminAccess(prisma, userId, 'XYNE-APPS')
