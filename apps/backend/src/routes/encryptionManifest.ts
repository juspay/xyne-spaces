import { Router, type Request, type Response } from 'express';
import { config } from '@/config/env';
import { getEncryptionProvider } from '@/services/encryption';
import { logger } from '@/utils/logger';

const router = Router();

// Client encryption manifest for (tag, environment). Kept off the key-exchange router
// because clients fetch it often, while those routes run once per session key.
router.get('/', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!config.enc.apiClientEncryptionEnabled) {
    res.json({ clientManifest: null });
    return;
  }

  const tag = typeof req.query.tag === 'string' && req.query.tag !== '' ? req.query.tag : 'default';

  try {
    const clientManifest = await getEncryptionProvider().getClientManifest({ tag, environment: config.env });
    if (!clientManifest) {
      res.status(404).json({ error: 'Not found', message: 'No client encryption manifest for this environment' });
      return;
    }
    res.json({ clientManifest });
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
