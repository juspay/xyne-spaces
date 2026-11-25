import { z } from 'zod';
import { defineRequestContract } from '../define.js';
import { unreadableString } from '../unreadable-string.js';

/**
 * Zero mutator `workspace.update`. The client encrypts `description` (top-level so a contract can
 * name it); it is stored as received. `updates` is the old nested shape, still accepted from
 * clients that predate the top-level fields; nothing in it is encrypted.
 */
export const workspaceUpdateClient = defineRequestContract({
  sourceToDerived: { description: {} },
  schema: z.object({
    workspaceId: z.string(),
    timestamp: z.number(),
    name: z.string().optional(),
    description: unreadableString().optional(),
    updates: z
      .object({
        name: z.string().optional(),
        description: z.string().optional(),
      })
      .optional(),
  }),
});
