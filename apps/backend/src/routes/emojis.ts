import express, { Request, Response, NextFunction } from 'express';
import { customEmojiController } from '../controllers/customEmojiController';
import { uploadSingle } from '../middleware/upload';
import { config } from '../config/env';
// Typed routes: src/api (the router tree), contracts in @xyne/shared (packages/shared/src/api).


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

// Typed routes (api.emojis: list, get, delete) are served by the API router behind the contract gate.
// The image stream and the upload (a file streamed to storage) stay here.
// Stream emoji image - must come before /:emojiId to avoid route conflicts
router.get(
  '/:emojiId/stream',
  setCrossOriginHeaders,
  customEmojiController.streamEmojiImage.bind(customEmojiController)
);
// Create emoji with file upload - upload middleware must come before auth
// Note: auth is applied at app.ts level
router.post('/', uploadSingle({ maxBytes: 256 * 1024 }), customEmojiController.createCustomEmoji);

export default router;
