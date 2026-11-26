import { z } from 'zod';
import { defineRoute } from '../api-route.js';

// ─── Message reactions (/messages/...): dashboard login. Emoji names and user ids only. ───

const messageId = z.object({ messageId: z.string().min(1) });
const reactionParams = z.object({ messageId: z.string().min(1), emojiName: z.string().min(1) });
/** One emoji on a message: who reacted, and whether the caller did. */
const messageReactions = z.object({
  emojiName: z.string(),
  count: z.number(),
  userHasReacted: z.boolean(),
  users: z.array(z.object({ userId: z.string(), name: z.string(), email: z.string().optional() })),
});
const reactions = z.array(messageReactions);
const change = z.object({
  success: z.literal(true),
  message: z.string(),
  added: z.boolean().optional(),
  reactions,
});

export const reactionsAdd = defineRoute({
  method: 'POST',
  path: '/messages/:messageId/reactions',
  params: messageId,
  body: z.object({ emojiName: z.string().min(1) }),
  response: change,
});

export const reactionsRemove = defineRoute({
  method: 'DELETE',
  path: '/messages/:messageId/reactions/:emojiName',
  params: reactionParams,
  response: change,
});

export const reactionsToggle = defineRoute({
  method: 'POST',
  path: '/messages/:messageId/reactions/:emojiName/toggle',
  params: reactionParams,
  response: change,
});

export const reactionsGet = defineRoute({
  method: 'GET',
  path: '/messages/:messageId/reactions',
  params: messageId,
  response: z.object({ reactions }),
});

/** Reactions of up to 100 messages at once (conversation loading). */
export const reactionsBulk = defineRoute({
  method: 'POST',
  path: '/messages/reactions/bulk',
  body: z.object({ messageIds: z.array(z.string()).min(1, 'Message IDs array is required').max(100, 'Too many message IDs (max 100)') }),
  response: z.object({ success: z.literal(true), reactions: z.record(z.string(), reactions) }),
});
