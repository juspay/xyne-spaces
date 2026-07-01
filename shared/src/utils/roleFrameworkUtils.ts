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
