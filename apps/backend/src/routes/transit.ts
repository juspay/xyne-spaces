import { Router, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '@/config/env';
import { getEncryptionProvider } from '@/services/encryption';
import { TRANSIT_KEY_COOKIE } from '@/services/encryption/types';
import { deviceCookieOptions } from '@/services/authSessionService';
import { websocketService } from '@/services/websocketService';
import { logger } from '@/utils/logger';

const router = Router();

// Base64 of a 65-byte uncompressed P-256 point (leading 0x04 encodes as 'B').
const P256_POINT_BASE64 = /^B[A-Za-z0-9+/]{86}=$/;
// The key pair belongs to the browser, not the user, so the cookie outlives any session.
const TRANSIT_KEY_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

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
      fileChunkSize: config.enc.storageFileChunkSize,
    });
  } catch {
    res.status(502).json({ error: 'Encryption service unavailable' });
  }
});

// The client's P-256 public key, which every transit key for it is derived from. Kept by
// the encryption service under the auth session id (for pushes that carry no cookie) and
// set as the `xk` cookie for websockets and the sync proxy, which cannot see headers the
// client sets. Responds with the encryption service's public keys, the other half of the
// derivation; nothing secret travels and nothing is minted.
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
    websocketService.setSessionTransitKey(sid, publicKey);
    res.cookie(TRANSIT_KEY_COOKIE, publicKey, {
      ...deviceCookieOptions(req),
      path: '/',
      maxAge: TRANSIT_KEY_COOKIE_MAX_AGE_MS,
    });
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
