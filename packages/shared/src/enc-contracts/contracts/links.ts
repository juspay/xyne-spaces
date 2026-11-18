import { z } from 'zod';
import { defineRequestContract, type RequestOf } from '../define.js';

/**
 * Link mutators. `title` and `description` are stored as sent; nothing is derived. The title
 * is read later by the SDLC agent prompt, a direct consumer tracked separately.
 */
export const linksCreateClient = defineRequestContract({
  encrypted: ['title', 'description'],
  derived: [],
  schema: z.object({
    id: z.string(),
    url: z.string(),
    title: z.string(),
    description: z.string().optional(),
    favicon: z.string().optional(),
    channelId: z.string(),
    visibility: z.enum(['DEFAULT', 'PERSONAL']).optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
});

export type LinksCreateRequest = RequestOf<typeof linksCreateClient>;

export const linksUpdateClient = defineRequestContract({
  encrypted: ['title', 'description'],
  derived: [],
  schema: z.object({
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    favicon: z.string().optional(),
    visibility: z.enum(['DEFAULT', 'PERSONAL']).optional(),
    updatedAt: z.number(),
  }),
});

export type LinksUpdateRequest = RequestOf<typeof linksUpdateClient>;
