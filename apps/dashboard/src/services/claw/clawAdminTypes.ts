export type AdminOrgScope = 'org' | 'all';

export interface AdminAccessFlags {
  isAdmin: boolean;
  hasSearchEvalAccess: boolean;
}

export type RequestTargetType = 'agent' | 'skill';
export type RequestKind = 'push_to_global' | 'push_to_spaces';

export interface AgentRequestItem {
  id: string;
  requesterId: string;
  requesterName?: string | null;
  requesterEmail?: string | null;
  targetType: RequestTargetType;
  requestType: RequestKind;
  agentId?: string | null;
  agentSlug?: string | null;
  agentName?: string | null;
  agentOwnerName?: string | null;
  agentOwnerEmail?: string | null;
  skillId?: string | null;
  skillSlug?: string | null;
  skillName?: string | null;
  orgId?: string | null;
  orgName?: string | null;
  status: string;
  note?: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  eventType: string;
  targetId: string;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  orgId?: string | null;
  orgName?: string | null;
}

export type AdminDateRange = 7 | 30 | 'all';

export interface AgentUsageStat {
  agentSlug: string;
  orgId?: string;
  orgName?: string | null;
  runs: number;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
}

export interface AdminScheduledJob {
  id: string;
  userId: string;
  agentSlug: string;
  task: string;
  type: 'once' | 'cron';
  cronExpression: string | null;
  runCount: number;
  maxRuns: number | null;
  status: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  label: string | null;
  createdAt: string;
  orgId?: string;
  orgName?: string | null;
  user: { id: string; name: string; email: string } | null;
}

export const AUDIT_EVENT_TYPES = [
  'AGENT_CREATED',
  'AGENT_UPDATED',
  'AGENT_DELETED',
  'AGENT_CONFIG_UPDATED',
  'AGENT_PROMOTED',
  'AGENT_DEMOTED',
  'AGENT_SHARED',
  'AGENT_UNSHARED',
  'ROLE_GRANTED',
  'ROLE_REVOKED',
  'REQUEST_CREATED',
  'REQUEST_APPROVED',
  'REQUEST_REJECTED',
  'MCP_GLOBAL_FALLBACK_ENABLED',
  'MCP_GLOBAL_FALLBACK_DISABLED',
  'MCP_GLOBAL_CREDENTIALS_SET',
  'MCP_GLOBAL_CREDENTIALS_REMOVED',
  'MCP_CONNECTOR_CREATED',
  'MCP_CONNECTOR_UPDATED',
  'MCP_CONNECTOR_DELETED',
  'MCP_CONNECTOR_EDIT_REQUESTED',
  'MCP_CONNECTOR_EDIT_APPROVED',
  'MCP_CONNECTOR_EDIT_REJECTED',
  'MCP_CONNECTOR_EDIT_SUPERSEDED',
  'MCP_CONNECTOR_EDIT_CANCELLED',
] as const;

export const auditEventLabel = (value: string): string =>
  value
    .toLowerCase()
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export const auditDescription = (value: string): string =>
  value.replace(/("[^"]*")\s*\([^)]*\)/g, '$1');

export interface WorkflowGlobalRequest {
  id: string;
  workflowId: string;
  workflow: { id: string; name: string; description?: string | null } | null;
  requestedByUserId: string;
  requestedByUser?: { id: string; name: string | null; email: string } | null;
  orgId?: string;
  orgName?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewedByUserId?: string | null;
  reviewNote?: string | null;
  createdAt: string;
}

export interface AdminMcpServerSummary {
  id: string;
  type: string;
  name: string;
  description: string | null;
  enabled: boolean;
  allowGlobalFallback: boolean;
  hasGlobalCredentials: boolean;
  globalCredentialsUpdatedAt: string | null;
  globalCredentialsSetByUserId: string | null;
}

export interface McpPublishRequest {
  id: string;
  name: string;
  type: string;
  description: string | null;
  transport?: string | null;
  connectorMeta?: Record<string, unknown> | null;
  credentialForm?: unknown;
  launchConfigTemplate?: unknown;
  httpConfigTemplate?: unknown;
  healthcheckSpec?: unknown;
  writeToolPolicy?: unknown;
  publishRequestedByUserId?: string | null;
  publishRequestedAt?: string | null;
}

export interface CredentialField {
  name: string;
  label: string;
  type: 'text' | 'password';
  placeholder: string;
  optional?: boolean;
}

export interface McpGlobalCredsDetail {
  type: string;
  orgId: string | null;
  hasCredentials: boolean;
  credentialKeys?: string[];
  updatedAt?: string;
  setByUserId?: string | null;
}
