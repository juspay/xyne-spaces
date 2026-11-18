import { z } from 'zod';
import { defineRequestContract } from '../define.js';

export const replyToConversation = defineRequestContract({
  route: 'POST /conversations/:conversationId/messages',
  revision: 1,
  schema: z.object({
    content: z.string().optional(),
    msgType: z.enum(['USER', 'BOT']).optional(),
    visibleTo: z.string().nullable().optional(),
    fileMetadata: z.string().optional(),
    showInChannel: z
      .union([z.boolean(), z.enum(['true', 'false']).transform(value => value === 'true')])
      .optional(),
  }),
  encrypt: ['content'],
  derive:  ['mentions', 'links', 'command'],
  persist: ['mentions', 'links.pr'],
});
