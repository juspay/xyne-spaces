import { z } from 'zod';
import { defineRoute } from '../../enc-contracts/api-route.js';

const timestamp = z.union([z.date(), z.string()]);
const alias = z.object({
  id: z.string(),
  createdAt: timestamp,
  updatedAt: timestamp,
  eventName: z.string(),
  eventCategory: z.string(),
  aliasEventName: z.string(),
  aliasEventCategory: z.string(),
  isBlacklisted: z.boolean(),
});

// ── Activity aliases (/activity-aliases) ────────────────────────────────────

const aliasId = z.object({ id: z.string().min(1) });

export const activityAliasesList = defineRoute({
  method: 'GET',
  path: '',
  response: z.object({ aliases: z.array(alias) }),
});

export const activityAliasesCreate = defineRoute({
  method: 'POST',
  path: '',
  body: z
    .object({
      eventName: z.string().min(1),
      eventCategory: z.string().min(1),
      aliasEventName: z.string().optional(),
      aliasEventCategory: z.string().optional(),
      isBlacklisted: z.boolean().default(false),
    })
    .refine((data) => data.isBlacklisted || (!!data.aliasEventName && !!data.aliasEventCategory), {
      message: 'aliasEventName and aliasEventCategory are required when not blacklisted',
      path: ['aliasEventName'],
    }),
  response: z.object({ alias }),
});

export const activityAliasesUpdate = defineRoute({
  method: 'PUT',
  path: '/:id',
  params: aliasId,
  body: z.object({
    aliasEventName: z.string().optional(),
    aliasEventCategory: z.string().optional(),
    isBlacklisted: z.boolean().optional(),
  }),
  response: z.object({ alias }),
});

export const activityAliasesDelete = defineRoute({
  method: 'DELETE',
  path: '/:id',
  params: aliasId,
  response: z.null(),
});