/**
 * Zod schema and context mapper for Xyne Spaces Plan Review Loop Workflow
 */

import { z } from 'zod';
import { BaseWorkflowContextSchema, baseContextMapper } from '../../schemas/workflow-schema';
import { ImageAttachment } from '../../types/workflow-enums';
import { XyneSpacesPlanReviewLoopContext } from './types';

export const XyneSpacesPlanReviewLoopInputSchema = BaseWorkflowContextSchema.extend({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  baseBranch: z.string().optional(),
  repoBranch: z.string().optional(),
  checkoutCommit: z.string().optional(),
  taskType: z.enum(['feature', 'bug', 'refactor', 'performance', 'security', 'documentation'])
    .optional()
    .default('feature')
    .describe('Type of task - determines which quality gates apply'),
  imageAttachments: z.array(z.object({
    id: z.string(),
    type: z.literal('image'),
    data: z.string(),
    mimeType: z.string(),
    name: z.string(),
  })).optional(),
  maxLoopIterations: z.number().min(1).max(10).optional().default(5),
  approvalThreshold: z.number().min(1).max(10).optional().default(7),
});

export const xyneSpacesPlanReviewLoopContextMapper = (
  payload: z.infer<typeof XyneSpacesPlanReviewLoopInputSchema> & {
    ticketId: string;
    title: string;
    description: string;
    baseBranch?: string;
    repoBranch?: string;
    checkoutCommit?: string;
    imageAttachments?: ImageAttachment[];
    taskType?: 'feature' | 'bug' | 'refactor' | 'performance' | 'security' | 'documentation';
    maxLoopIterations?: number;
    approvalThreshold?: number;
  }
): XyneSpacesPlanReviewLoopContext => ({
  ...baseContextMapper(payload),
  title: payload.title,
  description: payload.description,
  baseBranch: payload.baseBranch,
  repoBranch: payload.repoBranch,
  checkoutCommit: payload.checkoutCommit,
  imageAttachments: payload.imageAttachments,
  taskType: payload.taskType ?? 'feature',
  maxLoopIterations: payload.maxLoopIterations ?? 5,
  approvalThreshold: payload.approvalThreshold ?? 7,
});
