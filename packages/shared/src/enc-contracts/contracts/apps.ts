import { z } from 'zod';
import { defineRequestContract, type RequestOf } from '../define.js';

/**
 * Xyne Apps `POST /apps/chat/postMessage`, sent by bots through the ingress gateway, which
 * encrypts `markdownText` under the apps transit keys; the handler stores the workspace-DEK
 * ciphertext as-is. `text` stays plaintext for now: the handler resolves Slack mentions and
 * parses BlockKit in it, which cannot run on ciphertext until that processing moves into the
 * encryption service's extractor.
 */
export const appsChatPostMessageClient = defineRequestContract({
  encrypted: ['markdownText'],
  derived: [],
  schema: z.object({
    channelId: z.string().optional(),
    channelName: z.string().optional(),
    conversationId: z.string().optional(),
    text: z.string().optional(),
    markdownText: z.string().optional(),
    flow: z.unknown().optional(),
    attachments: z.array(z.unknown()).optional(),
  }),
});

export type AppsChatPostMessageRequest = RequestOf<typeof appsChatPostMessageClient>;
