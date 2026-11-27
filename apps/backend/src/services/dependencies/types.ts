import { ApplicationError } from '@rocicorp/zero';
import { z } from 'zod';

export const dependencySettingsSchema = z
  .object({
    strength: z.enum(['SOFT', 'HARD']).default('SOFT'),
    gatedStageId: z.string().min(1).nullable().default(null),
    satisfiedStageId: z.string().min(1).nullable().default(null),
  })
  .strict();
export const createBlocksSchema = dependencySettingsSchema
  .extend({
    sourceTicketId: z.string().min(1),
    targetTicketId: z.string().min(1),
  })
  .strict();
export const subTicketGatingSchema = dependencySettingsSchema.omit({ satisfiedStageId: true });

export const dependencyChangeSchema = dependencySettingsSchema
  .extend({ reason: z.string().trim().min(1).max(2000).optional() })
  .strict();
export const dependencyActionSchema = z
  .object({ reason: z.string().trim().min(1).max(2000).optional() })
  .strict();
export const subTicketChangeSchema = subTicketGatingSchema
  .extend({ reason: z.string().trim().min(1).max(2000).optional() })
  .strict();

export type DependencySettings = z.infer<typeof dependencySettingsSchema>;
export type CreateBlocksInput = z.infer<typeof createBlocksSchema>;

export class DependencyError extends ApplicationError {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    details: { softCount?: number; hardCount?: number; canAdminOverride?: boolean } = {},
  ) {
    super(message, { details: { code, ...details } });
    this.name = 'DependencyError';
  }
}
