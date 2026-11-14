import { Router, type Request, type Response } from 'express';
import { config } from '@/config/env';
import { getLatestClientManifests } from '@/services/encryption';
import { logger } from '@/utils/logger';

const router = Router();

// Client encryption manifest for (tag, environment). Kept off the key-exchange router
// because clients fetch it often, while those routes run once per session key.
//
// `signedManifest` is the envelope the encryption service signed; clients that trust a
// manifest key use only that. `clientManifest` is the same manifest unsigned, for clients
// still in the unsigned rollout. Both come from this pod's cache (refreshed by the version
// poll), so a burst of refetches after a version change never reaches the service.
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
    const { manifest, signed } = await getLatestClientManifests(tag);
    if (!manifest) {
      res.status(404).json({ error: 'Not found', message: 'No client encryption manifest for this environment' });
      return;
    }
    // res.send, not res.json: the response-encryption middleware wraps res.json, and the
    // signed envelope must reach the client byte-for-byte or its signature breaks. The
    // manifest is not user data, so there is nothing to encrypt. Express still sets an
    // ETag and answers If-None-Match with 304.
    res.set('Cache-Control', 'no-cache');
    res.type('application/json').send(JSON.stringify({ clientManifest: manifest, signedManifest: signed }));
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
