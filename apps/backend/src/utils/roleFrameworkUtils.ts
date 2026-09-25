import { UserResponsibility, UserRoleMappingEntityType } from '@xyne/shared';
import { PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';

const prisma = DatabaseClient.getInstance();

/**
 * The roles each member holds WITHIN a given group, unioned across both binding
 * sources (see the role-framework contract):
 *   1. user_role_mappings rows scoped entityType='USER_GROUP', entityId=userGroupId
 *   2. the legacy user_group_mappings.roleId for that group (when non-null)
 *
 * Returns Map<userId, Set<roleId>>. A user appears only if they hold at least one
 * role via either source; callers that must also enforce group membership should
 * intersect with the group's user_group_mappings. Two batched queries — no N+1.
 */
export async function getGroupRoleIdsByUser(
  userGroupId: string,
  client: PrismaClient = prisma,
): Promise<Map<string, Set<string>>> {
  const [urmRows, ugmRows] = await Promise.all([
    client.userRoleMapping.findMany({
      where: { entityType: UserRoleMappingEntityType.USER_GROUP, entityId: userGroupId },
      select: { userId: true, roleId: true },
    }),
    client.userGroupMapping.findMany({
      where: { userGroupId, roleId: { not: null } },
      select: { userId: true, roleId: true },
    }),
  ]);

  const byUser = new Map<string, Set<string>>();
  const add = (userId: string, roleId: string) => {
    let set = byUser.get(userId);
    if (!set) {
      set = new Set<string>();
      byUser.set(userId, set);
    }
    set.add(roleId);
  };
  for (const row of urmRows) add(row.userId, row.roleId);
  for (const row of ugmRows) if (row.roleId) add(row.userId, row.roleId);
  return byUser;
}

export const DEFAULT_ROLE_NAME_TO_ENUM: Record<string, UserResponsibility> = {
  MANAGER: UserResponsibility.MANAGER,
  TEAM_LEAD: UserResponsibility.TEAM_LEAD,
  MEMBER: UserResponsibility.MEMBER,
  PR_REVIEWER: UserResponsibility.PR_REVIEWER,
  QA: UserResponsibility.QA,
};

export const isDefaultRoleName = (name: string): boolean => name in DEFAULT_ROLE_NAME_TO_ENUM;

export const enumFromRoleName = (name: string): UserResponsibility | null =>
  DEFAULT_ROLE_NAME_TO_ENUM[name] ?? null;

export const roleNameFromEnum = (responsibility: string): string => responsibility;

// Deterministic id for a USER_GROUP-scoped user_role_mappings row — see the shared copy in
// packages/shared/src/utils/roleFrameworkUtils.ts. Kept identical so client (shared mutators)
// and server (backend mutators) compute the same id for the same (group, user, role).
export const groupRoleMappingId = (
  userGroupId: string,
  userId: string,
  roleId: string,
): string => `ugr_${userGroupId}_${userId}_${roleId}`;

const roleIdCache = new Map<string, { name: string; workspaceId: string }>();

export async function getRoleName(roleId: string): Promise<string | null> {
  const cached = roleIdCache.get(roleId);
  if (cached) return cached.name;
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { name: true, workspaceId: true },
  });
  if (!role) return null;
  roleIdCache.set(roleId, { name: role.name, workspaceId: role.workspaceId });
  return role.name;
}

export async function userResponsibilityFromRoleId(
  roleId: string,
): Promise<UserResponsibility | null> {
  const name = await getRoleName(roleId);
  if (!name) return null;
  return enumFromRoleName(name);
}

export async function roleIdFromEnum(
  responsibility: string,
  workspaceId: string,
): Promise<string | null> {
  const role = await prisma.role.findFirst({
    where: { name: responsibility, workspaceId },
    select: { id: true },
  });
  return role?.id ?? null;
}
