/**
 * Workflow Step Key Utilities
 *
 * Generates Redis keys for workflow step storage.
 * Format: workflow:{workflowExecutionId} or workflow:{workflowExecutionId}:{stepName}
 *
 * Example: workflow:exec-123 (aggregate)
 * Example: workflow:exec-123:STEP_1 (per-step)
 */

/**
 * Build a Redis key for workflow step storage.
 * @param workflowExecutionId - The workflow execution ID
 * @param stepName - Optional step name for per-step storage (agentic steps)
 * @returns The Redis key string
 */
export function buildWorkflowStepKey(workflowExecutionId: string, stepName?: string): string {
  if (stepName) {
    return `workflow:${workflowExecutionId}:${stepName}`;
  }
  return `workflow:${workflowExecutionId}`;
}

/**
 * Extract workflow execution ID and optional step name from a Redis key.
 * Supports both formats:
 * - workflow:{executionId} (aggregate)
 * - workflow:{executionId}:{stepName} (per-step)
 * @param key - The Redis key string (e.g., 'workflow:exec-123' or 'workflow:exec-123:STEP_1')
 * @returns The workflow execution ID and optional step name, or null if invalid
 */
export function parseWorkflowStepKey(key: string): { workflowExecutionId: string; stepName?: string } | null {
  if (!key.startsWith('workflow:')) {
    return null;
  }
  const parts = key.slice('workflow:'.length).split(':');
  if (parts.length === 0 || !parts[0]) {
    return null;
  }
  return {
    workflowExecutionId: parts[0],
    stepName: parts[1]  // undefined for aggregate keys
  };
}

/**
 * Pattern to match all workflow step keys in Redis.
 * Useful for scanning all workflow execution keys.
 * Matches both aggregate and per-step keys.
 */
export const WORKFLOW_STEP_KEY_PATTERN = 'workflow:*';
