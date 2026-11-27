import { route } from '../../../enc-contracts/api-route.js';
import { z } from 'zod';

// ─── Dashboard settings and admin APIs: activity aliases, client events, custom emojis, ──
// ─── a channel's tag-generation config, and a file's metadata (bot token) ───────────────
// Ids, names and settings only: nothing encrypted. Rules are the controllers' own, moved here.

const timestamp = z.union([z.date(), z.string()]);

// ── A file's metadata, for a Xyne App (/apps/files/info/:attachmentId), bot token ──

/** `/apps/files`: a file's metadata for bots. Key order is the mount order. */
export const files = route('/files', {
  info: {
    method: 'GET',
    path: '/info/:attachmentId',
    params: z.object({ attachmentId: z.string().min(1) }),
    response: z.object({
      id: z.string(),
      originalFilename: z.string(),
      mimetype: z.string(),
      size: z.number(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      thumbnailUrl: z.string().nullable(),
      createdAt: timestamp,
      conversationId: z.string().nullable(),
    }),
  },
});
