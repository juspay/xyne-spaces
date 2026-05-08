import { z } from 'zod';

export const createFolderSchema = z.object({
    name: z.string().min(1, 'Folder name is required').max(255),
    parentId: z.string().uuid().optional().nullable(),
    metadata: z.record(z.any()).optional(),
});

export type CreateFolderInput = z.infer<typeof createFolderSchema>;
