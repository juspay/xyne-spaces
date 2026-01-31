import express, { Request, Response, NextFunction } from 'express';
import { customEmojiController } from '../controllers/customEmojiController';
import { uploadSingle } from '../middleware/upload';
import { config } from '../config/env';

const router = express.Router();

/**
 * Middleware to set cross-origin headers for emoji image streaming.
 * Allows only whitelisted origins from environment variables.
 */
const setCrossOriginHeaders = (req: Request, res: Response, next: NextFunction): void => {
  const referer = req.headers.referer;
  const allowedOrigins = config.cors.allowedMediaOrigins;

  if (referer) {
    // Extract origin from referer URL (protocol + host + port, without path)
    const url = new URL(referer);
    const origin = url.origin;

    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin) || allowedOrigins.includes(origin + '/')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('cross-origin-resource-policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }
  next();
};

// Custom emoji CRUD routes
router.get('/', customEmojiController.getAllCustomEmojis);
// Stream emoji image - must come before /:emojiId to avoid route conflicts
router.get(
  '/:emojiId/stream',
  setCrossOriginHeaders,
  customEmojiController.streamEmojiImage.bind(customEmojiController)
);
router.get('/:emojiId', customEmojiController.getCustomEmojiById);
// Create emoji with file upload - upload middleware must come before auth
// Note: auth is applied at app.ts level
router.post('/', uploadSingle, customEmojiController.createCustomEmoji);
router.delete('/:emojiId', customEmojiController.deleteCustomEmoji);

export default router;
