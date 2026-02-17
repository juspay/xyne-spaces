import { z } from 'zod';
import { BaseWorkflowContext } from '../workflow-types';

export const BaseWorkflowContextSchema = z.object({
  ticketId: z.string().describe('_HIDDEN_Automatically populated from ticket context'),
  userId: z.string().optional().describe('_HIDDEN_Automatically populated from user context'),
  metadata: z.record(z.any()).optional().describe('_HIDDEN_Internal metadata'),
  modelName: z.string().optional()
});

export function baseContextMapper(payload: any): BaseWorkflowContext {
  return {
    ticketId: payload.ticketId,
    userId: payload.userId,
    metadata: payload.metadata,
    modelName: payload.modelName,
  };
}