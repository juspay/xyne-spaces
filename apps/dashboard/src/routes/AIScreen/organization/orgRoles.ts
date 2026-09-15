import type { AddableOrgRole, OrgRole } from '@/services/claw/clawOrgTypes';

export const ADDABLE_ROLE_OPTIONS: ReadonlyArray<{ value: AddableOrgRole; label: string }> = [
  { value: 'MEMBER', label: 'Member' },
  { value: 'ADMIN', label: 'Admin' },
];

export const OWNER_ROLE_OPTION = { value: 'OWNER' as const, label: 'Owner' };

export function orgRoleLabel(role: OrgRole): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export function isOrgRole(value: string): value is OrgRole {
  return value === 'OWNER' || value === 'ADMIN' || value === 'MEMBER';
}

export function isAddableOrgRole(value: string): value is AddableOrgRole {
  return value === 'ADMIN' || value === 'MEMBER';
}
