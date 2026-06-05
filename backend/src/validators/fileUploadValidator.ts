import { z } from 'zod';

export const uploadFilesSchema = z.object({
  duplicateStrategy: z.enum(['skip', 'rename', 'overwrite']).optional().default('rename'),
  parentId: z.string().nullable().optional(),
  sessionId: z.string().optional(),
});

export type UploadFilesInput = z.infer<typeof uploadFilesSchema>;

// Duplicate handling strategies
export enum DuplicateStrategy {
  SKIP = 'skip',
  RENAME = 'rename',
  OVERWRITE = 'overwrite',
}
