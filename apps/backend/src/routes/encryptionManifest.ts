import { Router, type Request, type Response } from 'express';
import { config } from '@/config/env';
import {
  getEncryptionProvider,
  manifestEnvironmentForRequest,
  TRANSIT_TICKET_COOKIE,
  TRANSIT_TICKET_HEADER,
} from '@/services/encryption';
import { logger } from '@/utils/logger';

const router = Router();

/** The caller's transit ticket: header first, then the cookie (as the response middleware reads it). */
function transitTicket(req: Request): string | undefined {
  const header = req.header(TRANSIT_TICKET_HEADER);
  if (header) return header;
  const cookie: unknown = req.cookies?.[TRANSIT_TICKET_COOKIE];
  return typeof cookie === 'string' && cookie.length > 0 ? cookie : undefined;
}

// Client encryption manifest for the request's (tag, environment), encrypted by the
// encryption service with the caller's transit key: `clientManifest` is an ENC:…|tk-… string
// the client decrypts with its keyring (plain JSON when transit is not configured).
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

  const tag = typeof req.query.tag === 'string' && req.query.tag !== '' ? req.query.tag : 'default';
  const environment = manifestEnvironmentForRequest(req);

  try {
    const result = await getEncryptionProvider().getTransitClientManifest({
      tag,
      environment,
      subject,
      ticket: transitTicket(req),
    });
    if (!result) {
      res.status(404).json({ error: 'Not found', message: 'No client encryption manifest for this environment' });
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.json({ clientManifest: result.clientManifest });
  } catch (err) {
    logger.error('Failed to fetch client encryption manifest', {
      userId: req.user.id,
      tag,
      environment,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(502).json({ error: 'Encryption service unavailable' });
  }
});

export default router;
