export const GENERIC_RECOVERY_EXCLUDED_WORKFLOW_TYPES = [
  'Automations',
  'SDLC_WORK',
  'SDLC_WIKI',
  'Workflow',
] as const;

export function isGenericWorkflowRecoveryType(workflowType: string | null): boolean {
  return !GENERIC_RECOVERY_EXCLUDED_WORKFLOW_TYPES.some(type => type === workflowType);
}
