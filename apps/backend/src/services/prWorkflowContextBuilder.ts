/**
 * PR Workflow Context Builder
 *
 * Builds workflow-specific contexts based on workflow type.
 * Spreads original context and overrides only specific fields.
 */

import { WorkflowType } from '@/workflows/types/workflow-enums';

export interface PRWorkflowContextParams {
  title: string;
  description: string;
  repoBranch: string;
  originalContext: Record<string, unknown>;
}

/**
 * Builds workflow context based on workflow type
 * Spreads original context and overrides specific PR-related fields
 */
export function buildPRWorkflowContext(
  workflowType: WorkflowType,
  _params: PRWorkflowContextParams
): Record<string, unknown> {
  // No workflow types are currently supported for PR comment triggers.
  throw new Error(
    `[PR-Context-Builder] Workflow type ${workflowType} is not supported for PR comment triggers.`
  );
}
