import { UserResponsibility } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';

const prisma = DatabaseClient.getInstance();

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
