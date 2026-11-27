import { route } from '../../enc-contracts/api-route.js';
import { z } from 'zod';

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

/** `/activity-aliases`: activity aliases. Key order is the mount order. */
export const activityAliases = route('/activity-aliases', {
  list: {
    method: 'GET',
    path: '',
    response: z.object({ aliases: z.array(alias) }),
  },
  create: {
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
  },
  update: {
    method: 'PUT',
    path: '/:id',
    params: aliasId,
    body: z.object({
      aliasEventName: z.string().optional(),
      aliasEventCategory: z.string().optional(),
      isBlacklisted: z.boolean().optional(),
    }),
    response: z.object({ alias }),
  },
  delete: {
    method: 'DELETE',
    path: '/:id',
    params: aliasId,
    response: z.null(),
  },
});
