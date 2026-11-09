import { Router, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { getEncryptionProvider } from '@/services/encryption';
import { logger } from '@/utils/logger';

const router = Router();

// Base64 of a 65-byte uncompressed P-256 point.
const P256_POINT_BASE64 = /^[A-Za-z0-9+/]{86}==$/;

const handshakeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req): string => req.user?.sid ?? req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/config', async (req: Request, res: Response) => {
  if (!req.user?.sid) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    res.json(await getEncryptionProvider().getClientConfig());
  } catch {
    res.status(502).json({ error: 'Encryption service unavailable' });
  }
});

// Transit keys are derived per auth session (JWT `sid`) and epoch; this only wraps the
// current one for the caller under an ephemeral ECDH exchange. Nothing is stored.
router.post('/handshake', handshakeLimiter, async (req: Request, res: Response) => {
  const subject = req.user?.sid;
  if (!req.user || !subject) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { publicKey, epoch } = req.body as { publicKey?: unknown; epoch?: unknown };
  if (typeof publicKey !== 'string' || !P256_POINT_BASE64.test(publicKey)) {
    res.status(400).json({ error: 'Bad request', message: 'publicKey must be a base64 P-256 point' });
    return;
  }
  if (epoch !== undefined && !Number.isSafeInteger(epoch)) {
    res.status(400).json({ error: 'Bad request', message: 'epoch must be an integer' });
    return;
  }

  try {
    res.json(await getEncryptionProvider().transitHandshake({ subject, publicKey, epoch: epoch as number | undefined }));
  } catch (err) {
    logger.error('Transit handshake failed', {
      userId: req.user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(502).json({ error: 'Encryption service unavailable' });
  }
});

export default router;
