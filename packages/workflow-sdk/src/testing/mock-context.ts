import type { WorkflowContext } from '../types/context.js';
import type { ResourceAttributes } from '../authz/attributes.js';

/**
 * Create a mock WorkflowContext for testing.
 *
 * Provides sensible defaults — override any field via the `overrides` param.
 * Pass `attributes` to simulate the workflow's tenant; steps that resolve
 * credentials or store attachments key off it.
 */
export function createMockContext(
  overrides?: Partial<WorkflowContext> & {
    workflowId?: string;
    attributes?: ResourceAttributes<'workflow'>;
    metadata?: Record<string, unknown>;
    triggerType?: string;
    triggerData?: Record<string, unknown>;
  },
): WorkflowContext {
  const {
    workflowId,
    attributes,
    metadata,
    triggerType,
    triggerData,
    ...rest
  } = overrides ?? {};

  return {
    workflow: {
      id: workflowId ?? 'wf_test',
      attributes: attributes as ResourceAttributes<'workflow'>,
      metadata: metadata ?? {},
    },
    trigger: {
      type: triggerType ?? 'TEST',
      ...triggerData,
    },
    execution: { id: 'test-execution' },
    steps: {},
    vars: {},
    ...rest,
  };
}
