/**
 * Search request contract.
 *
 * A zod mirror of `apps/backend/src/validators/vespaSearchValidator.ts`, which is
 * Joi. The duplication is deliberate and worth it: this schema validates
 * `/api/sdk/search` and is what the SDK's build-time check compares its search
 * parameters against, while the Joi schema stays the validator for the existing
 * `/api/vespaSearch` route, which is not being changed.
 *
 * Only parameters meaningful to an external caller are exposed. Internal ones
 * used by claw-auth's knowledge-base tooling (`includeChunkLevel`,
 * `startChunkIndex`, `chunkLimit`, `collectionId`, `fileId`, `searchId`,
 * `presentationSummary`, `includeDebugInfo`) are deliberately omitted — they
 * expose chunk-level index internals rather than product concepts.
 */

import { z } from 'zod';

const APPS = ['chat', 'ticket', 'user', 'file', 'collection', 'mail', 'xyneapp', 'call'] as const;

const TYPES = [
  'messages',
  'attachments',
  'calls',
  'channels',
  'tickets',
  'users',
  'files',
  'canvas',
  'transcript',
  'rca',
  'people',
  'emails',
] as const;

/** Query params arrive as strings; accept a comma-separated list or an array. */
const csv = z
  .union([z.string(), z.array(z.string())])
  .transform((v) =>
    (Array.isArray(v) ? v : v.split(','))
      .map((s) => s.trim())
      .filter(Boolean),
  );

const commaEnum = <T extends readonly [string, ...string[]]>(values: T, label: string) =>
  z.string().refine(
    (v) => v.split(',').every((part) => (values as readonly string[]).includes(part.trim())),
    { message: `${label} must be comma-separated values from: ${values.join(', ')}` },
  );

const boolish = z.union([z.boolean(), z.enum(['true', 'false'])]).transform((v) => v === true || v === 'true');

export const searchQuerySchema = z.object({
  /** Free text. Omit (or send empty) to search by filters alone. */
  q: z.string().max(500).optional(),

  apps: commaEnum(APPS, 'apps').optional(),
  type: commaEnum(TYPES, 'type').optional(),
  subApp: z.enum(['canvas', 'transcript', 'recording', 'rca', 'collections']).optional(),

  offset: z.coerce.number().int().min(0).max(1000).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(20),

  // Who and where.
  from: csv.optional(),
  withUser: csv.optional(),
  fromEmail: csv.optional(),
  toEmail: csv.optional(),
  in: csv.optional(),
  mentions: csv.optional(),
  channelMentions: csv.optional(),

  // Work-item filters.
  projectId: csv.optional(),
  status: csv.optional(),
  ticketId: csv.optional(),
  priority: z.string().optional(),
  board: z.string().optional(),
  tags: z.string().optional(),
  stage: z.string().optional(),
  assignee: z.string().optional(),

  // Dates. `range` takes natural windows ("today", "last 7 days"); the rest are
  // explicit cutoffs.
  before: z.string().optional(),
  after: z.string().optional(),
  on: z.string().optional(),
  range: z.string().optional(),
  created: z.string().optional(),

  // Calls.
  callStatus: z.string().optional(),
  callType: z.string().optional(),
  callStartsAt: z.coerce.number().int().min(0).optional(),
  callEndsAt: z.coerce.number().int().min(0).optional(),

  // Result shaping.
  orderBy: z.enum(['newest', 'oldest', 'relevance']).optional(),
  /** Empty string disables grouping and returns one flat ranked list. */
  groupBy: z.string().optional(),
  includeBotMessages: boolish.optional(),
  onlyMyChannels: boolish.optional(),
  view: z.enum(['installed', 'org', 'marketplace']).optional(),
});


/** Consumed by `searchSchemaQuerySchema` below; not part of the public surface. */
const VESPA_SCHEMAS = [
  'chat_message',
  'chat_attachment',
  'chat_container',
  'ticket',
  'user',
  'file',
  'sam_transcript',
  'mail',
  'mail_attachment',
  'project',
  'memory',
  'call',
] as const;

export const searchSchemaQuerySchema = z.object({
  schema: z.enum(VESPA_SCHEMAS),
});

