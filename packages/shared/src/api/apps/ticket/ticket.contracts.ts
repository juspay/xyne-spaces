import { z } from 'zod';
import { defineRoute } from '../../../enc-contracts/api-route.js';

/** GET /apps/ticket/boards */
export const appsTicketBoards = defineRoute({
  method: 'GET',
  path: '/boards',
  query: z.object({ projectId: z.string().min(1, 'projectId must not be empty').trim().optional() }),
  response: z.object({
    boards: z.array(
      z.object({
        boardId: z.string(),
        name: z.string(),
        boardType: z.string(),
        description: z.string().nullable(),
        projectId: z.string(),
        createdAt: z.union([z.date(), z.string()]),
        updatedAt: z.union([z.date(), z.string()]).nullable(),
      }),
    ),
  }),
});

/** GET /apps/ticket/boards/:boardId/stages */
export const appsTicketBoardStages = defineRoute({
  method: 'GET',
  path: '/boards/:boardId/stages',
  params: z.object({ boardId: z.string().min(1, 'boardId is required').trim() }),
  response: z.object({
    boardId: z.string(),
    boardName: z.string(),
    projectId: z.string().nullable(),
    stages: z.array(
      z.object({
        stageId: z.string(),
        name: z.string(),
        sequenceNumber: z.number(),
        eta: z.number().nullable(),
        defaultTicketStatusV2: z.string(),
      }),
    ),
  }),
});

/**
 * The channel ids of a listBySender query: `channelIds` (comma-separated), `channelId`
 * (repeated or single), each once, in that order.
 */
function listBySenderChannelIds(query: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const channelIdsParam = query.channelIds;
  if (typeof channelIdsParam === 'string' && channelIdsParam.trim()) {
    for (const part of channelIdsParam.split(',')) {
      const trimmed = part.trim();
      if (trimmed) ids.add(trimmed);
    }
  }
  const channelIdParam = query.channelId;
  if (Array.isArray(channelIdParam)) {
    for (const value of channelIdParam) {
      if (typeof value === 'string' && value.trim()) ids.add(value.trim());
    }
  } else if (typeof channelIdParam === 'string' && channelIdParam.trim()) {
    ids.add(channelIdParam.trim());
  }
  return [...ids];
}

/** GET /apps/ticket/listBySender: tickets a sender raised in channels the bot is in. */
export const appsTicketListBySender = defineRoute({
  method: 'GET',
  path: '/listBySender',
  query: z.preprocess(
    (query) => {
      const q = (query ?? {}) as Record<string, unknown>;
      return { senderEmail: q.senderEmail, limit: q.limit, cursor: q.cursor, channelIds: listBySenderChannelIds(q) };
    },
    z.object({
      channelIds: z.array(z.string().min(1, 'channelId must not be empty').trim()).min(1, {
        message: 'At least one channelId is required (channelId, repeated channelId, or channelIds)',
      }),
      senderEmail: z.string().email('senderEmail must be a valid email').trim(),
      limit: z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : 20)),
      cursor: z.string().optional(),
    }),
  ),
  response: z.object({
    items: z.array(z.record(z.string(), z.unknown())),
    nextCursor: z.string().nullable().optional(),
    hasMore: z.boolean(),
  }),
});