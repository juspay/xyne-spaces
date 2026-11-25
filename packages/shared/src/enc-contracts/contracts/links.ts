import { z } from 'zod';
import { defineRequestContract } from '../define.js';
import { derive } from '../extractors.js';
import { unreadableString } from '../unreadable-string.js';

/**
 * Zero mutators `links.create`, `links.update`. The client encrypts `description` (`title`
 * stays plaintext: the SDLC agent reads it). `description` lists one fact so that "no facts"
 * means it was empty, which is how `description || null` is kept.
 */
export const linksCreateClient = defineRequestContract({
  sourceToDerived: { description: { textLength: derive.textLength } },
  schema: z.object({
    id: z.string(),
    url: z.string().url(),
    title: z.string().min(1),
    description: unreadableString().optional(),
    favicon: z.string().optional(),
    channelId: z.string(),
    visibility: z.enum(['DEFAULT', 'PERSONAL']).default('DEFAULT'),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
});

export const linksUpdateClient = defineRequestContract({
  sourceToDerived: { description: { textLength: derive.textLength } },
  schema: z.object({
    id: z.string(),
    title: z.string().min(1).optional(),
    description: unreadableString().optional(),
    favicon: z.string().optional(),
    visibility: z.enum(['DEFAULT', 'PERSONAL']).optional(),
    updatedAt: z.number(),
  }),
});
