import { z } from 'zod';
import { RCAStatus, COEStatus, SEVERITY } from '@xyne/shared';

const optionalTrimmedString = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional(),
);

export const rcaSchema = z.object({
  ticketId: z.string().trim().min(1, 'Ticket ID is required'),
  ownerId: z.string().trim().min(1, 'Owner ID is required'),
  title: z.string().trim().min(1, 'Title is required'),
  summary: z.string().trim().min(1, 'Summary is required'),
  rootCause: z.string().trim().min(1, 'Root cause is required'),
  severity: z.nativeEnum(SEVERITY, { message: 'Severity is required' }),
  bugType: z.string().trim().min(1, 'Bug type is required'),
  category: z.string().trim().min(1, 'Category type is required'),
  issueStartAt: z.number().nullable().optional(),
  status: z.nativeEnum(RCAStatus),
  issueCategory: z.string().trim().optional(),
});

export const impactSchema = z.object({
  ticketId: z.string().trim().min(1, 'Ticket ID is required'),
  impactType: z.string().trim().min(1, 'Impact type is required'),
  impact: z.string().trim().min(1, 'Impact summary is required'),
});

export const coeSchema = z.object({
  ownerId: z.string().trim().min(1, 'Owner ID is required'),
  actionType: z.string().trim().min(1, 'Action type is required'),
  action: z.string().trim().min(1, 'Action is required'),
  status: z.nativeEnum(COEStatus),
});

export const createRcaSchema = z.object({
  ticketId: z.string().trim().min(1, 'Ticket ID is required'),
  ownerId: z.string().trim().min(1, 'Owner ID is required'),
  title: z.string().trim().min(1, 'Title is required'),
  summary: optionalTrimmedString,
  severity: z.nativeEnum(SEVERITY, { message: 'Severity is required' }),
  bugType: z.string().trim().min(1, 'Bug type is required'),
  category: z.string().trim().min(1, 'Category type is required'),
  issueCategory: z.string().trim().optional(),
});

export type RCASchemaType = z.infer<typeof rcaSchema>;
export type ImpactSchemaType = z.infer<typeof impactSchema>;
export type COESchemaType = z.infer<typeof coeSchema>;
export type CreateRCASchemaType = z.infer<typeof createRcaSchema>;
