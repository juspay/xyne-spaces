import { Router, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '@/config/env';
import { getEncryptionProvider } from '@/services/encryption';
import { logger } from '@/utils/logger';

const router = Router();

// Base64 of a 65-byte uncompressed P-256 point (leading 0x04 encodes as 'B').
const P256_POINT_BASE64 = /^B[A-Za-z0-9+/]{86}=$/;

const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req): string => req.user?.sid ?? req.user?.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

function serviceUnavailable(res: Response, what: string, req: Request, err: unknown): void {
  logger.error(`Transit ${what} failed`, {
    userId: req.user?.id,
    error: err instanceof Error ? err.message : String(err),
  });
  res.status(502).json({ error: 'Encryption service unavailable' });
}

// The router is mounted behind authMiddleware.authenticate; only `register` needs the session.
router.get('/config', async (_req: Request, res: Response) => {
  try {
    res.json({
      ...(await getEncryptionProvider().getClientConfig()),
      fileChunkSize: config.enc.enableStorageEncryption ? config.enc.storageFileChunkSize : 0,
    });
  } catch {
    res.status(502).json({ error: 'Encryption service unavailable' });
  }
});

// The client's P-256 public key, kept by the encryption service under the auth session id; every transit key for the session is derived from it.
router.post('/register', registerLimiter, async (req: Request, res: Response) => {
  const sid = req.user?.sid;
  if (!req.user || !sid) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { publicKey } = req.body as { publicKey?: unknown };
  if (typeof publicKey !== 'string' || !P256_POINT_BASE64.test(publicKey)) {
    res.status(400).json({ error: 'Bad request', message: 'publicKey must be a base64 P-256 point' });
    return;
  }

  try {
    const serverKeys = await getEncryptionProvider().registerTransitClientKey(sid, publicKey);
    res.json(serverKeys);
  } catch (err) {
    serviceUnavailable(res, 'key registration', req, err);
  }
});

// The encryption service's public keys, for a client that meets a key id it has not
// derived yet (a server key added by rotation).
router.get('/server-keys', async (req: Request, res: Response) => {
  try {
    res.json(await getEncryptionProvider().getTransitServerKeys());
  } catch (err) {
    serviceUnavailable(res, 'server keys fetch', req, err);
  }
});

export default router;
