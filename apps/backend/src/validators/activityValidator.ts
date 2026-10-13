import { z } from 'zod';

/**
 * Validation schema for activity log payload
 */
export const ActivityPayloadSchema = z.object({
  timestamp: z.string().refine(
    (val) => !isNaN(Date.parse(val)),
    { message: 'Invalid timestamp format' }
  ),
  userId: z.string().min(1).max(100),
  userEmail: z.string()
    .email({ message: 'Invalid email format' })
    .max(255)
    .optional(),
  sessionId: z.string().min(1).max(100).optional(),
  event: z.enum(['onIdle', 'onActive', 'onAction']),
  status: z.enum(['idle', 'active']),
  page: z.string()
    .max(500)
    .refine(
      (val) => !/[<>"'&\r\n]/.test(val),
      { message: 'Page URL contains invalid characters' }
    ),
  activeDurationSec: z.number().min(0).optional(),
  pageDurationSec: z.number().min(0).optional(),
  previousPage: z.string().max(500).optional(),
  previousPagePath: z.string().max(500).optional(),
  idleTimeSec: z.number().min(0).optional(),
  platform: z.string().max(200).optional(), // Added by backend from UserSession.deviceInfo
  triggerEvent: z.string().max(100).optional(),
});

// Type inference from schema
export type ValidatedActivityPayload = z.infer<typeof ActivityPayloadSchema>;

/**
 * Validate activity payload from request body
 * @throws ZodError if validation fails
 */
export function validateActivityPayload(data: unknown): ValidatedActivityPayload {
  return ActivityPayloadSchema.parse(data);
}
