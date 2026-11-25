import { z } from 'zod';
import { defineRequestContract } from '../define.js';
import { derive } from '../extractors.js';
import { unreadableString } from '../unreadable-string.js';
import { sdlcIconNameSchema, sdlcTrackStatusSchema } from '../../sdlc.js';

/**
 * Zero mutators `sdlc.createTrack`, `sdlc.updateTrack`, `sdlc.addSdlcFolderItem`. The client
 * trims and encrypts the track / link description; it is stored as received. Its 2000-character
 * limit is checked on `rawLength` (the stored string, as the old zod `.max` measured it), since
 * zod cannot measure ciphertext.
 */
export const sdlcCreateTrackClient = defineRequestContract({
  sourceToDerived: { description: { rawLength: derive.rawLength } },
  schema: z.object({
    id: z.string(),
    linkId: z.string(),
    channelId: z.string(),
    name: z.string().trim().min(1).max(120),
    description: unreadableString().optional(),
    timestamp: z.number(),
  }),
});

export const sdlcUpdateTrackClient = defineRequestContract({
  sourceToDerived: { description: { rawLength: derive.rawLength } },
  schema: z.object({
    trackId: z.string(),
    name: z.string().trim().min(1).max(120).optional(),
    description: unreadableString().nullable().optional(),
    status: sdlcTrackStatusSchema.optional(),
    icon: sdlcIconNameSchema.nullable().optional(),
    timestamp: z.number(),
  }),
});

/** `linkDescription` is the encrypted, top-level description; `link.description` is still accepted (plaintext) from older clients. */
export const sdlcAddSdlcFolderItemClient = defineRequestContract({
  sourceToDerived: { linkDescription: { rawLength: derive.rawLength } },
  schema: z.object({
    itemType: z.enum(['ATTACHMENT', 'LINK']),
    itemId: z.string(),
    containmentLinkId: z.string(),
    flatLinkId: z.string(),
    channelId: z.string(),
    trackId: z.string(),
    parentType: z.enum(['TRACK', 'FOLDER']),
    parentId: z.string(),
    link: z
      .object({
        url: z.string().min(1),
        title: z.string().trim().min(1).max(300),
        description: z.string().trim().max(2000).optional(),
        favicon: z.string().optional(),
      })
      .optional(),
    linkDescription: unreadableString().optional(),
    timestamp: z.number(),
  }),
});
