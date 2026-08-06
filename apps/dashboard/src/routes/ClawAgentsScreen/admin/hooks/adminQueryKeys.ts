import type { AdminOrgScope, GrantableRole } from '@/services/claw/clawAdminTypes';

export const adminRolesKey = (role: GrantableRole): unknown[] => ['claw-admin-roles', role];

export const pendingRequestsKey = (scope: AdminOrgScope): unknown[] => [
  'claw-admin-requests',
  scope,
];

export const adminAgentsKey = (userId: string, scope: AdminOrgScope): unknown[] => [
  'claw-admin-agents',
  userId,
  scope,
];

export const pendingRequestsPrefix = (): unknown[] => ['claw-admin-requests'];

export const adminAgentsPrefix = (userId: string): unknown[] => ['claw-admin-agents', userId];

export const mcpPublishKey = (): unknown[] => ['claw-admin-mcp-publish'];

export const workflowRequestsKey = (scope: AdminOrgScope): unknown[] => [
  'claw-admin-workflow-requests',
  scope,
];

export const globalMcpKey = (): unknown[] => ['claw-admin-global-mcp'];
