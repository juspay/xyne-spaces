import { z } from 'zod';
import { defineRequestContract } from '../define.js';
import { derive } from '../extractors.js';
import { unreadableString } from '../unreadable-string.js';

/**
 * Zero mutators `canvasComment.createThread`, `reply`, `updateComment`; their args are these
 * bodies. The client encrypts the comment `body` (and the thread's `anchorText`); the server
 * stores them as received and never reads them: mentions arrive separately as
 * `mentionedUserIds`. `anchorText` lists one fact so that "no facts" means it was empty, which
 * is how `anchorText || null` is kept.
 */
export const canvasCommentCreateThreadClient = defineRequestContract({
  sourceToDerived: {
    body: {},
    anchorText: { textLength: derive.textLength },
  },
  schema: z.object({
    threadId: z.string(),
    commentId: z.string(),
    canvasId: z.string(),
    blockId: z.string().min(1),
    anchorText: unreadableString().optional(),
    body: unreadableString(z.string().min(1)),
    mentionedUserIds: z.array(z.string()).default([]),
    timestamp: z.number(),
  }),
});

export const canvasCommentReplyClient = defineRequestContract({
  sourceToDerived: { body: {} },
  schema: z.object({
    commentId: z.string(),
    threadId: z.string(),
    canvasId: z.string(),
    body: unreadableString(z.string().min(1)),
    mentionedUserIds: z.array(z.string()).default([]),
    timestamp: z.number(),
  }),
});

export const canvasCommentUpdateClient = defineRequestContract({
  sourceToDerived: { body: {} },
  schema: z.object({
    commentId: z.string(),
    body: unreadableString(z.string().min(1)),
    mentionedUserIds: z.array(z.string()).default([]),
    timestamp: z.number(),
  }),
});
