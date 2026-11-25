import { z } from 'zod';
import { defineRequestContract } from '../define.js';
import { unreadableString } from '../unreadable-string.js';

/** Zero mutators `emailSignature.create`, `emailSignature.update`. The client encrypts `content`; it is stored as received. */
export const emailSignatureCreateClient = defineRequestContract({
  sourceToDerived: { content: {} },
  schema: z.object({
    id: z.string(),
    name: z.string(),
    content: unreadableString(),
    timestamp: z.number(),
  }),
});

export const emailSignatureUpdateClient = defineRequestContract({
  sourceToDerived: { content: {} },
  schema: z.object({
    id: z.string(),
    name: z.string(),
    content: unreadableString(),
    timestamp: z.number(),
  }),
});
