import { z } from 'zod';

export const FLOW_STEP_ROOT_ID_FIELD = 'rootId' as const;

export const flowStepVisibilitySchemaShape = {
  excludeFlowSteps: z.boolean().optional(),
} as const;

export interface FlowStepVisibilityOptions {
  excludeFlowSteps?: boolean;
}
