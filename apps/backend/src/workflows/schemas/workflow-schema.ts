import { z } from 'zod';
import { BaseWorkflowContext } from '../workflow-types';

export const BaseWorkflowContextSchema = z.object({
  ticketId: z.string().describe('_HIDDEN_Automatically populated from ticket context'),
  userId: z.string().optional().describe('_HIDDEN_Automatically populated from user context'),
  metadata: z.record(z.any()).optional().describe('_HIDDEN_Internal metadata'),
  modelName: z.string().optional(),
  executorType: z.enum(['xyne-code', 'opencode']).optional().describe('Executor type to use for agentic checkpoints'),
  useQuestioningMode: z.preprocess(
    (val) => {
      if (val === undefined || val === null) return undefined;
      if (typeof val === 'string') return val === 'true';
      if (typeof val === 'boolean') return val;
      return false;
    },
    z.boolean().optional()
  ).describe('Enable question mode to ask clarifying questions before implementation'),
});

export function baseContextMapper(payload: any): BaseWorkflowContext {
  return {
    ticketId: payload.ticketId,
    userId: payload.userId,
    metadata: payload.metadata,
    modelName: payload.modelName,
    executorType: payload.executorType,
    useQuestioningMode: payload.useQuestioningMode === 'true' || payload.useQuestioningMode === true,
  };
}