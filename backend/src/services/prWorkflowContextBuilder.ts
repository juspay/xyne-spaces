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
  params: PRWorkflowContextParams
): Record<string, unknown> {
  switch (workflowType) {
    case WorkflowType.XYNE_SPACES_FEATURE_IMPLEMENTATION:
      return {
        ...params.originalContext,
        title: params.title,
        description: params.description,
        repoBranch: params.repoBranch,
      };

    case WorkflowType.FIDO_SERVER_WORKFLOW:
      params.originalContext['reviewCode'] = false; // FIDO workflows don't require code review
      return {
        ...params.originalContext,
        description: params.description,
        repoBranch: params.repoBranch,
      };

    default:
      // Unsupported workflow type - throw error
      throw new Error(
        `[PR-Context-Builder] Workflow type ${workflowType} is not supported for PR comment triggers. ` +
        `Only XYNE_SPACES_FEATURE_IMPLEMENTATION and FIDO_SERVER_WORKFLOW are supported.`
      );
  }
}
