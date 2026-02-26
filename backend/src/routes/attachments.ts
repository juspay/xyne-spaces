import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AttachmentController } from '../controllers/attachmentController';
import { config } from '../config/env';

const router = Router();
const attachmentController = new AttachmentController();
const upload = multer({
  limits: {
    fileSize: 1024 * 1024 * 1024,
    files: 20,
  },
});

/**
 * Middleware to set cross-origin headers for media streaming.
 * Allows only whitelisted origins from environment variables.
 */
const setCrossOriginHeaders = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const origin = req.headers.referer;
  const allowedOrigins = config.cors.allowedMediaOrigins;
  // Check if origin is in allowed list
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('cross-origin-resource-policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
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

// Download attachment by ID
router.get('/attachments/:attachmentId/download', attachmentController.downloadAttachment.bind(attachmentController));

// Download thumbnail by attachment ID
router.get('/attachments/:attachmentId/thumbnail', attachmentController.downloadThumbnail.bind(attachmentController));

// Download file by GCS path (query parameter)
router.get('/attachments/file', attachmentController.downloadByPath.bind(attachmentController));

// Upload attachments for an entity (e.g., IMPACT)
router.post(
  '/attachments/upload',
  upload.fields([{ name: 'files', maxCount: 10 }]),
  attachmentController.uploadAttachments.bind(attachmentController),
);

export default router;
