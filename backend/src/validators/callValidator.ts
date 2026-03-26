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

// RRULE must start with a valid FREQ; COUNT and UNTIL are allowed (backend derives endsOn from them)
const RRULE_REQUIRED_PREFIX = /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/i;

/**
 * Validation schema for creating a recurring call series.
 * channelId is required (pass targetUserIds to auto-create a DM channel on the backend).
 * recurrenceRule must be a bare RRULE string (no UNTIL/COUNT).
 * startTime / endTime use 24-hour HH:mm format.
 * startsOn / endsOn are epoch-millisecond timestamps.
 */
export const RecurringScheduleCallSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(200, 'Title must be at most 200 characters'),
    description: z.string().max(1000).optional(),
    channelId: z.string().optional(),
    targetUserIds: z.array(z.string()).optional(),
    timezone: z.string().min(1, 'Timezone is required'),
    recurrenceRule: z
      .string()
      .min(1, 'Recurrence rule is required')
      .refine(
        (val) => RRULE_REQUIRED_PREFIX.test(val),
        'RRULE must start with FREQ=DAILY|WEEKLY|MONTHLY|YEARLY',
      ),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be in HH:mm format'),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, 'endTime must be in HH:mm format'),
    startsOn: z
      .number()
      .refine(
        (val) => val > Date.now() - 24 * 60 * 60 * 1000,
        'startsOn must not be in the past',
      ),
    endsOn: z.number().optional(),
  })
  .refine(
    (data) => data.channelId || (data.targetUserIds && data.targetUserIds.length > 0),
    'Either channelId or targetUserIds is required',
  )
  .refine(
    (data) => !data.endsOn || data.endsOn > data.startsOn,
    'endsOn must be after startsOn',
  )
  .refine(
    (data) => data.startTime !== data.endTime,
    'startTime and endTime must not be the same',
  );

export type RecurringScheduleCallInput = z.infer<typeof RecurringScheduleCallSchema>;

/**
 * Validation schema for updating a single scheduled call instance.
 * All fields are optional — only provided fields will be updated.
 */
export const UpdateScheduleCallSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(200).optional(),
    startsAt: z
      .number()
      .refine((val) => val > Date.now(), 'startsAt must be in the future')
      .optional(),
    endsAt: z.number().optional(),
    targetUserIds: z.array(z.string()).optional(),
    channelId: z.string().optional(),
  })
  .refine(
    (data) => !data.startsAt || !data.endsAt || data.startsAt < data.endsAt,
    'endsAt must be after startsAt',
  );

export type UpdateScheduleCallInput = z.infer<typeof UpdateScheduleCallSchema>;

/**
 * Validation schema for updating a recurring call series.
 * All fields are optional — only provided fields will be updated.
 */
export const UpdateRecurringSeriesSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(200).optional(),
    recurrenceRule: z
      .string()
      .refine(
        (val) => RRULE_REQUIRED_PREFIX.test(val),
        'RRULE must start with FREQ=DAILY|WEEKLY|MONTHLY|YEARLY',
      )
      .optional(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be in HH:mm format').optional(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, 'endTime must be in HH:mm format').optional(),
    startsOn: z.number().optional(),
    endsOn: z.number().optional(),
    timezone: z.string().optional(),
    targetUserIds: z.array(z.string()).optional(),
    channelId: z.string().optional(),
  })
  .refine(
    (data) => !data.startTime || !data.endTime || data.startTime !== data.endTime,
    'startTime and endTime must not be the same',
  );

export type UpdateRecurringSeriesInput = z.infer<typeof UpdateRecurringSeriesSchema>;
