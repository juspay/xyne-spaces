export const WORKFLOWS_TYPE = 'Workflow';
export const WORKFLOWS_SCOPE = { workflowType: WORKFLOWS_TYPE } as const;
export const DEFAULT_FOLDER_ID = 'default';
export const DEFAULT_CRON_TIMEZONE = 'Asia/Kolkata';
export const TERMINAL_EXECUTION_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED'] as const;
export const CREDENTIAL_ACTIVE = 'ACTIVE';
export const CREDENTIAL_REVOKED = 'REVOKED';
export const CREDENTIAL_SUMMARY_SELECT = {
  workspaceId: true,
  name: true,
  credType: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;
