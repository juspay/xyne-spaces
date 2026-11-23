import { z } from 'zod';
import { CanvasVisibility } from '../../zero/types.js';
import { defineRequestContract } from '../define.js';
import { unreadableString } from '../unreadable-string.js';

/** Zero mutators `canvas.create`, `canvas.update`. The client encrypts `title`; it is stored as received. */
export const canvasCreateClient = defineRequestContract({
  sourceToDerived: { title: {} },
  schema: z.object({
    id: z.string(),
    title: unreadableString(),
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

export const canvasUpdateClient = defineRequestContract({
  sourceToDerived: { title: {} },
  schema: z.object({
    id: z.string(),
    title: unreadableString().optional(),
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
