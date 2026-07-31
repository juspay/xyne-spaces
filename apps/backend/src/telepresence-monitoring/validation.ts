import { z } from 'zod';
import { TELEPRESENCE_DEVICE_TYPES, TELEPRESENCE_HEALTH_STATUSES } from './utils';

const TelepresenceDeviceTypeSchema = z.enum(TELEPRESENCE_DEVICE_TYPES);

const TelepresenceHealthStatusSchema = z.enum(TELEPRESENCE_HEALTH_STATUSES);

const isoDateTimeString = z.string().min(1).refine((val) => !Number.isNaN(Date.parse(val)), {
  message: 'must be a valid date-time string',
});

const TelepresenceDeviceReportSchema = z.object({
  deviceType: TelepresenceDeviceTypeSchema,
  name: z.string().optional(),
  status: TelepresenceHealthStatusSchema.optional(),
  connected: z.number().int().nonnegative(),
  detected: z.number().int().nonnegative(),
  description: z.string().optional(),
}).passthrough();

export const TelepresenceHealthReportRequestSchema = z.object({
  userId: z.string().min(1),
  reportedAt: isoDateTimeString,
  cpuTemperature: z.number(),
  devices: z.array(TelepresenceDeviceReportSchema).min(1, 'devices must contain at least one record'),
}).passthrough();

export const TelepresenceHealthQuerySchema = z.object({
  userId: z.string().min(1).optional(),
});

const optionalBooleanFlag = z.preprocess((val) => {
  if (val === undefined) {
    return undefined;
  }
  if (typeof val === 'string') {
    return val === 'true';
  }
  return val;
}, z.boolean().optional());

export const TelepresenceHealthTimeSeriesQuerySchema = z.object({
  userId: z.string().min(1).optional(),
  from: isoDateTimeString,
  to: isoDateTimeString,
  screen: optionalBooleanFlag,
  camera: optionalBooleanFlag,
  microphone: optionalBooleanFlag,
  speaker: optionalBooleanFlag,
}).passthrough();
