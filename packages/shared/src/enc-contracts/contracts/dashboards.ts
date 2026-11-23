import { z } from 'zod';
import { defineRequestContract } from '../define.js';
import { unreadableString } from '../unreadable-string.js';

/** Zero mutator `dashboard.upsert`. The client trims and encrypts `description`; it is stored as received. */
export const dashboardUpsertClient = defineRequestContract({
  sourceToDerived: { description: {} },
  schema: z.object({
    id: z.string(),
    name: z.string(),
    description: unreadableString().optional(),
    createdBy: z.string(),
    timestamp: z.number(),
  }),
});
