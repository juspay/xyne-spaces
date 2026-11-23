import { Router, type Request, type Response } from 'express';
import { config } from '@/config/env';
import { getEncryptionProvider } from '@/services/encryption';
import { hasTransitCaller, transitCaller } from '@/middleware/decryptionMiddleware';
import { logger } from '@/utils/logger';

const router = Router();

// Client encryption manifest for the tag, as served by the encryption service (each
// deployment is pinned to one environment), encrypted for the caller's transit public key:
// `clientManifest` is an ENC:…|tk-… string the client decrypts with its keyring (plain JSON
// when transit is not configured).
router.get('/', async (req: Request, res: Response) => {
  const subject = req.user?.sid;
  if (!req.user || !subject) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!config.enc.apiClientEncryptionEnabled) {
    res.json({ clientManifest: null });
    return;
  }

  // Only one manifest family exists today.
  const tag = 'default';
  const caller = transitCaller(req);
  if (!hasTransitCaller(caller)) {
    res.status(400).json({ error: 'Client manifest requires the client transit key', code: 'TRANSIT_KEY_REQUIRED' });
    return;
  }

  try {
    const result = await getEncryptionProvider().getTransitClientManifest({ tag, ...caller });
    if (!result) {
      res.status(404).json({ error: 'Not found', message: 'No client encryption manifest for this tag' });
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.json({ clientManifest: result.clientManifest });
  } catch (err) {
    logger.error('Failed to fetch client encryption manifest', {
      userId: req.user.id,
      tag,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(502).json({ error: 'Encryption service unavailable' });
  }
});

export default router;
