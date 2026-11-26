import { z } from 'zod';
import { defineRoute } from '../../enc-contracts/api-route.js';

// ── Custom emojis (/emojis): reads and delete (upload and image streaming not moved) ──

const emoji = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  creator: z.object({ id: z.string(), name: z.string(), email: z.string(), picture: z.string().nullable() }).nullable(),
});

export const emojisList = defineRoute({
  method: 'GET',
  path: '',
  response: z.object({ success: z.literal(true), emojis: z.array(emoji) }),
});

export const emojisGet = defineRoute({
  method: 'GET',
  path: '/:emojiId',
  params: z.object({ emojiId: z.string().min(1) }),
  response: z.object({ success: z.literal(true), emoji }),
});

export const emojisDelete = defineRoute({
  method: 'DELETE',
  path: '/:emojiId',
  params: z.object({ emojiId: z.string().min(1) }),
  response: z.object({ success: z.literal(true), message: z.string() }),
});