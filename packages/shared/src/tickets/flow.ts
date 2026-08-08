import { z } from 'zod';

export const flowStepVisibilitySchemaShape = {
  excludeFlowSteps: z.boolean().optional(),
} as const;

export interface FlowStepVisibilityOptions {
  excludeFlowSteps?: boolean;
}
