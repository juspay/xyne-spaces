import { route } from '../../enc-contracts/api-route.js';
import { z } from 'zod';

// ── Custom emojis (/emojis): reads and delete (upload and image streaming not moved) ──

const emoji = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  creator: z.object({ id: z.string(), name: z.string(), email: z.string(), picture: z.string().nullable() }).nullable(),
});

/** `/emojis`: custom emojis. Key order is the mount order. */
export const emojis = route('/emojis', {
  list: {
    method: 'GET',
    path: '',
    response: z.object({ success: z.literal(true), emojis: z.array(emoji) }),
  },
  get: {
    method: 'GET',
    path: '/:emojiId',
    params: z.object({ emojiId: z.string().min(1) }),
    response: z.object({ success: z.literal(true), emoji }),
  },
  delete: {
    method: 'DELETE',
    path: '/:emojiId',
    params: z.object({ emojiId: z.string().min(1) }),
    response: z.object({ success: z.literal(true), message: z.string() }),
  },
});
