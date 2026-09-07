import { z } from 'zod';

export const HistoryScopeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({
    mode: z.literal('today'),
    from: z
      .string()
      .refine(val => !isNaN(Date.parse(val)), { message: 'Invalid date format' }),
  }),
  z.object({ mode: z.literal('beginning') }),
  z.object({
    mode: z.literal('custom'),
    from: z
      .string()
      .refine(val => !isNaN(Date.parse(val)), { message: 'Invalid date format' })
      .refine(val => Date.parse(val) <= Date.now(), {
        message: 'Cutoff date cannot be in the future',
      }),
  }),
]);

export const AddGroupDmParticipantsSchema = z
  .object({
    userIds: z.array(z.string().min(1)).min(1, { message: 'At least one user is required' }),
    historyScope: HistoryScopeSchema.optional(),
    includeHistory: z.boolean().optional(),
  })
  .refine(data => data.historyScope !== undefined || data.includeHistory !== undefined, {
    message: 'historyScope is required',
    path: ['historyScope'],
  });

export type AddGroupDmParticipantsBody = z.infer<typeof AddGroupDmParticipantsSchema>;
