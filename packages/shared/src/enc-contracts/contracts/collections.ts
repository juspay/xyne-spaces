import { z } from 'zod';
import { defineRequestContract } from '../define.js';
import { unreadableString } from '../unreadable-string.js';

/**
 * Zero mutators `collection.createCollection`, `collection.updateCollection`. The client
 * encrypts `description`; it is stored as received.
 */
export const collectionCreateClient = defineRequestContract({
  sourceToDerived: { description: {} },
  schema: z.object({
    id: z.string(),
    scopeType: z.string(),
    scopeId: z.string(),
    name: z.string(),
    description: unreadableString().nullable().optional(),
    isPrivate: z.boolean().optional(),
    permissionId: z.string(),
    timestamp: z.number(),
  }),
});

export const collectionUpdateClient = defineRequestContract({
  sourceToDerived: { description: {} },
  schema: z.object({
    id: z.string(),
    name: z.string().optional(),
    description: unreadableString().nullable().optional(),
    isPrivate: z.boolean().optional(),
    timestamp: z.number(),
  }),
});
