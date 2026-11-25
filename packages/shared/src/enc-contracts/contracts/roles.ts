import { z } from 'zod';
import { defineRequestContract } from '../define.js';
import { unreadableString } from '../unreadable-string.js';

/** Zero mutators `role.create`, `role.update`. The client encrypts `description`; it is stored as received. */
export const roleCreateClient = defineRequestContract({
  sourceToDerived: { description: {} },
  schema: z.object({
    id: z.string(),
    name: z.string(),
    description: unreadableString().optional(),
    timestamp: z.number(),
  }),
});

export const roleUpdateClient = defineRequestContract({
  sourceToDerived: { description: {} },
  schema: z.object({
    id: z.string(),
    name: z.string().optional(),
    description: unreadableString().optional(),
    timestamp: z.number(),
  }),
});
