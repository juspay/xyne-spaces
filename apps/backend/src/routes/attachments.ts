import { Router, Request, Response, NextFunction } from 'express';
import { AttachmentController } from '../controllers/attachmentController';
import { config } from '../config/env';
import { uploadMultiple } from '../middleware/upload';

const router = Router();
const attachmentController = new AttachmentController();

const normalizeOrigin = (value: string): string => value.replace(/\/+$/, '');

const resolveRequestOrigin = (req: Request): string | null => {
  const rawOrigin = req.headers.origin;
  if (typeof rawOrigin === 'string' && rawOrigin.length > 0) {
    return normalizeOrigin(rawOrigin);
  }

  const rawReferer = req.headers.referer;
  if (typeof rawReferer !== 'string' || rawReferer.length === 0) {
    return null;
  }

  try {
    return normalizeOrigin(new URL(rawReferer).origin);
  } catch {
    return null;
  }
};

/**
 * Middleware to set cross-origin headers for media streaming.
 * Allows only whitelisted origins from environment variables.
 */
const setCrossOriginHeaders = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const requestOrigin = resolveRequestOrigin(req);
  const allowedOrigins = new Set(
    config.cors.allowedMediaOrigins.map((origin: string) => normalizeOrigin(origin))
  );

  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  next();
};

// Stream attachment with range request support (for video/audio)
// Apply cross-origin middleware to allow video/audio playback from whitelisted origins
router.get(
  '/attachments/:attachmentId/stream',
  setCrossOriginHeaders,
  attachmentController.streamAttachment.bind(attachmentController)
);

router.get(
  '/attachments/:attachmentId/video-preview',
  attachmentController.getVideoPreviewStatus.bind(attachmentController)
);

router.post(
  '/attachments/:attachmentId/video-preview',
  attachmentController.requestVideoPreview.bind(attachmentController)
);

// Download attachment by ID
router.get('/attachments/:attachmentId/download', attachmentController.downloadAttachment.bind(attachmentController));

// Download thumbnail by attachment ID
router.get('/attachments/:attachmentId/thumbnail', attachmentController.downloadThumbnail.bind(attachmentController));

// Upload attachments for an entity (e.g., IMPACT)
router.post(
  '/attachments/upload',
  uploadMultiple,
  attachmentController.uploadAttachments.bind(attachmentController),
);

export default router;
