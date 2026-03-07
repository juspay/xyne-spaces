import { z } from 'zod';

/**
 * Validation schema for scheduling a call
 */
export const ScheduleCallSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  startsAt: z.number().refine(
    (val) => val > Date.now(),
    'startsAt must be in the future'
  ),
  endsAt: z.number(),
  channelId: z.string().optional(),
  targetUserIds: z.array(z.string()).optional(),
}).refine(
  (data) => data.channelId || (data.targetUserIds && data.targetUserIds.length > 0),
  'Either channelId or targetUserIds is required'
).refine(
  (data) => data.startsAt < data.endsAt,
  'endsAt must be after startsAt'
);

// Type inference from schema
export type ScheduleCallInput = z.infer<typeof ScheduleCallSchema>;
