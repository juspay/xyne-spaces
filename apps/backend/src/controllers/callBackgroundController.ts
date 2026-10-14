import { randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import z from 'zod';
import { superpositionClient } from '@/services/superpositionClient';
import { storageService } from '@/services/storage';
import { callAdminAccessService } from '@/services/callAdminAccessService';
import { setSafeInlineImageHeaders } from '@/utils/safeAttachmentDownload';
import { logger } from '@/utils/logger';

/**
 * Superposition key listing the preset call backgrounds, edited by hand:
 * `{ "items": [{ "id": "<id from the calls admin upload>", "label": "Office" }] }`.
 * Resolved with the caller's workspaceId as context, so a workspace can get its own set.
 */
export const CALL_BACKGROUNDS_KEY = 'call_backgrounds';

/** Images live in the private bucket; ids are server-generated UUIDs, never paths. */
const STORAGE_PREFIX = 'call-backgrounds';
const imagePath = (id: string, variant: 'full' | 'thumb'): string =>
  `${STORAGE_PREFIX}/${id}${variant === 'thumb' ? '-thumb' : ''}.jpg`;

/** The client uploads pre-resized JPEGs (≤1280×720 and a small thumbnail). */
export const MAX_BACKGROUND_BYTES = 2 * 1024 * 1024;
export const MAX_BACKGROUND_THUMB_BYTES = 256 * 1024;

const backgroundEntrySchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(40),
});

const isJpeg = (buffer: Buffer): boolean =>
  buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

export const callBackgroundController = {
  /**
   * GET /api/calls/backgrounds
   * Preset backgrounds for the call background picker. Invalid entries are dropped
   * (and logged) rather than failing the whole list.
   */
  list: async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = req.user?.workspaceId;
      const raw = await superpositionClient.getObjectValue(
        CALL_BACKGROUNDS_KEY,
        { items: [] },
        workspaceId ? { workspaceId } : {}
      );
      const items = z.object({ items: z.array(z.unknown()) }).safeParse(raw);
      const backgrounds = (items.success ? items.data.items : []).flatMap((item) => {
        const parsed = backgroundEntrySchema.safeParse(item);
        if (!parsed.success) {
          logger.warn(`[CallBackgrounds] Skipping invalid entry in '${CALL_BACKGROUNDS_KEY}'`);
          return [];
        }
        return [parsed.data];
      });
      res.json({ success: true, backgrounds });
    } catch (error) {
      logger.error('[CallBackgrounds] Failed to resolve backgrounds:', error);
      res.status(500).json({ success: false, error: 'Failed to load call backgrounds' });
    }
  },

  /**
   * GET /api/calls/backgrounds/:id/image[?variant=thumb]
   * Streams a background from storage. Content never changes for an id, so it is
   * cached as immutable. Cross-origin readable because the camera pipeline uploads it
   * into WebGL (the global CORS middleware supplies the allow-origin headers).
   */
  image: async (req: Request, res: Response): Promise<void> => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) {
      res.status(404).json({ error: 'Background not found' });
      return;
    }
    const path = imagePath(id.data, req.query.variant === 'thumb' ? 'thumb' : 'full');
    try {
      const stream = await storageService.createReadStream(path);
      setSafeInlineImageHeaders(res, 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      stream.on('error', (error) => {
        logger.warn(`[CallBackgrounds] Failed to stream ${path}:`, error);
        if (!res.headersSent) res.status(404).json({ error: 'Background not found' });
        else res.destroy();
      });
      stream.pipe(res);
    } catch (error) {
      logger.warn(`[CallBackgrounds] Background not readable ${path}:`, error);
      if (!res.headersSent) res.status(404).json({ error: 'Background not found' });
    }
  },

  /**
   * POST /api/calls/admin/backgrounds (multipart: `image`, `thumb`)
   * SCRIBE admins only. Stores the pair and returns the id to add to Superposition.
   */
  upload: async (req: Request, res: Response): Promise<void> => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if ((await callAdminAccessService.getScope(user.id)) !== 'ORG') {
      res.status(403).json({ error: 'Only workspace call admins can upload backgrounds' });
      return;
    }

    const files = req.files as Record<string, Express.Multer.File[] | undefined> | undefined;
    const image = files?.image?.[0];
    const thumb = files?.thumb?.[0];
    if (
      !image ||
      !thumb ||
      thumb.size > MAX_BACKGROUND_THUMB_BYTES ||
      !isJpeg(image.buffer) ||
      !isJpeg(thumb.buffer)
    ) {
      res.status(400).json({ error: 'Expected a JPEG image and thumbnail' });
      return;
    }

    const id = randomUUID();
    try {
      for (const [variant, file] of [
        ['full', image],
        ['thumb', thumb],
      ] as const) {
        await storageService.uploadFileV2(file.buffer, {
          path: imagePath(id, variant),
          contentType: 'image/jpeg',
          cacheControl: 'public, max-age=31536000, immutable',
          ifNotExists: true,
        });
      }
      logger.info(`[CallBackgrounds] Uploaded background ${id} by ${user.id}`);
      res.json({ success: true, id });
    } catch (error) {
      logger.error('[CallBackgrounds] Upload failed:', error);
      res.status(500).json({ error: 'Failed to upload background' });
    }
  },
};
