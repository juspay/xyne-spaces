import { Router, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '@/config/env';
import { getEncryptionProvider } from '@/services/encryption';
import { TRANSIT_TICKET_COOKIE } from '@/services/encryption/types';
import { logger } from '@/utils/logger';

const router = Router();

// Base64 of a 65-byte uncompressed P-256 point.
const P256_POINT_BASE64 = /^[A-Za-z0-9+/]{86}==$/;
// `tk-` plus the base64 of a sealed ticket.
const TICKET = /^tk-[A-Za-z0-9+/]{80,120}={0,2}$/;

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

// Ephemeral ECDH that hands the caller a traffic key plus the ticket sealing it. The ticket is
// bound to the auth session (JWT `sid`); presenting one resumes that key instead of minting a
// new one. The cookie carries the current ticket to the sync proxy, which cannot see headers
// set by the client. Nothing is stored.
router.post('/handshake', handshakeLimiter, async (req: Request, res: Response) => {
  const subject = req.user?.sid;
  if (!req.user || !subject) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { publicKey, ticket } = req.body as { publicKey?: unknown; ticket?: unknown };
  if (typeof publicKey !== 'string' || !P256_POINT_BASE64.test(publicKey)) {
    res.status(400).json({ error: 'Bad request', message: 'publicKey must be a base64 P-256 point' });
    return;
  }
  if (ticket !== undefined && (typeof ticket !== 'string' || !TICKET.test(ticket))) {
    res.status(400).json({ error: 'Bad request', message: 'ticket is malformed' });
    return;
  }

  try {
    const result = await getEncryptionProvider().transitHandshake({ subject, publicKey, ticket });
    if (ticket === undefined) {
      res.cookie(TRANSIT_TICKET_COOKIE, result.ticket, {
        httpOnly: true,
        secure: config.env === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: Math.max(0, result.expiresAt * 1000 - Date.now()),
      });
    }
    res.json(result);
  } catch (err) {
    logger.error('Transit handshake failed', {
      userId: req.user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(502).json({ error: 'Encryption service unavailable' });
  }
});

export default router;
