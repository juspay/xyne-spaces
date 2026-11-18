import { z } from 'zod';
import { CanvasVisibility } from '../../zero/types.js';
import { defineRequestContract, type RequestOf } from '../define.js';

/**
 * Canvas mutators. `title` is stored as sent; nothing is derived. The title is read later by
 * Vespa, share notifications and Slack DMs, recording emails and SDLC prompts, all direct
 * consumers tracked separately. The canvas body (`content`) is not part of this rule.
 */
export const canvasCreateClient = defineRequestContract({
  encrypted: ['title'],
  derived: [],
  schema: z.object({
    id: z.string(),
    title: z.string(),
    channelId: z.string().optional(),
    folderId: z.string().optional(),
    projectId: z.string().optional(),
    visibility: z.nativeEnum(CanvasVisibility).optional(),
    content: z.any().optional(),
    timestamp: z.number(),
    participantId: z.string(),
    connectId: z.string().optional(),
    viewAccessId: z.string().optional(),
    editAccessId: z.string().optional(),
  }),
});

export type CanvasCreateRequest = RequestOf<typeof canvasCreateClient>;

export const canvasUpdateClient = defineRequestContract({
  encrypted: ['title'],
  derived: [],
  schema: z.object({
    id: z.string(),
    title: z.string().optional(),
    content: z.any().optional(),
    visibility: z.nativeEnum(CanvasVisibility).optional(),
    isCollaborative: z.boolean().optional(),
    folderId: z.string().nullable().optional(),
    projectId: z.string().nullable().optional(),
    channelId: z.string().nullable().optional(),
    timestamp: z.number(),
    viewAccessId: z.string().optional(),
    editAccessId: z.string().optional(),
  }),
});

export type CanvasUpdateRequest = RequestOf<typeof canvasUpdateClient>;
