import type { AgentShareRole } from '@/services/claw/clawAuthAgentTypes';

export const ROLE_OPTIONS: ReadonlyArray<{ value: AgentShareRole; label: string }> = [
  { value: 'VIEWER', label: 'Viewer (Can view & run)' },
  { value: 'CONTRIBUTOR', label: 'Contributor (Can edit)' },
  { value: 'EDITOR', label: 'Editor (Can edit & share)' },
];

export function roleLabel(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export function isShareRole(value: string): value is AgentShareRole {
  return value === 'VIEWER' || value === 'CONTRIBUTOR' || value === 'EDITOR';
}
