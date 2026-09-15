import type { AdminDateRange, AdminOrgScope } from '@/services/claw/clawAdminTypes';

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

export const adminUsageKey = (scope: AdminOrgScope, range: AdminDateRange): unknown[] => [
  'claw-admin-usage',
  scope,
  range,
];

export const adminAuditKey = (
  scope: AdminOrgScope,
  filters: { eventType: string; agentId: string; range: string; offset: number },
): unknown[] => ['claw-admin-audit', scope, filters];

export const adminScheduledKey = (
  scope: AdminOrgScope,
  filters: { status: string; agentSlug: string; jobUserId: string; offset: number },
): unknown[] => ['claw-admin-scheduled', scope, filters];

export const auditAgentOptionsKey = (userId: string): unknown[] => [
  'claw-admin-agent-options',
  userId,
];

export const mcpPublishKey = (): unknown[] => ['claw-admin-mcp-publish'];

export const workflowRequestsKey = (scope: AdminOrgScope): unknown[] => [
  'claw-admin-workflow-requests',
  scope,
];

export const globalMcpKey = (): unknown[] => ['claw-admin-global-mcp'];

export const credentialFieldsKey = (): unknown[] => ['claw-admin-credential-fields'];

export const slackStatusesKey = (orgIds: readonly string[]): unknown[] => [
  'claw-admin-slack-statuses',
  orgIds,
];
