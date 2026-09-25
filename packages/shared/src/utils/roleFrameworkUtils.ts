import { UserResponsibility } from '../zero/schema.js';

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

export const roleNameFromEnum = (responsibility: UserResponsibility): string =>
  responsibility as string;

// Deterministic id for a USER_GROUP-scoped user_role_mappings row. Deterministic (not random)
// so Zero client and server compute the same id for the same (group, user, role), and so a
// re-add after a remove reuses the id. Aligns 1:1 with the natural key
// (userId, roleId, entityType=USER_GROUP, entityId=userGroupId).
export const groupRoleMappingId = (
  userGroupId: string,
  userId: string,
  roleId: string,
): string => `ugr_${userGroupId}_${userId}_${roleId}`;
