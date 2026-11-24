import { Router, type Request, type Response } from 'express';
import { config } from '@/config/env';
import { getEncryptionProvider } from '@/services/encryption';
import { TRANSIT_PROXY_HEADER, authenticateApp, parseTransitProxyHeader } from '@/apps/middelware/authenticator';
import { logger } from '@/utils/logger';

/**
 * Internal routes for the Xyne transit proxy only. Nothing here checks who the caller is:
 * infra allows only the proxies' service accounts to reach /api/internal/transit-proxy (Istio
 * AuthorizationPolicy), so these must never be routed from the edge.
 */
const router = Router();

/**
 * POST /api/internal/transit-proxy/verify-token: the proxy's pre-check, before it encrypts anything.
 * The bot's own `Authorization: Bearer <app JWT>` is forwarded unchanged and verified by the
 * same authenticateApp every app route uses. 200 with who the token is for, or 401.
 */
router.post('/verify-token', authenticateApp, (req: Request, res: Response) => {
  const auth = (req as Request & { auth?: { appId?: string; installedAppId?: string } }).auth;
  res.set('Cache-Control', 'no-store');
  res.json({
    appId: auth?.appId,
    installedAppId: auth?.installedAppId,
    userId: req.user?.id,
    workspaceId: req.user?.workspaceId,
  });
});

/**
 * GET /api/internal/transit-proxy/client-manifest?tag=&environment=: the manifest for a proxy,
 * encrypted by the encryption service to the proxy key named by `x-xyne-transit-proxy`.
 * The backend relays ciphertext it cannot read or change.
 */
router.get('/client-manifest', async (req: Request, res: Response) => {
  const proxyClient = parseTransitProxyHeader(req.headers[TRANSIT_PROXY_HEADER]);
  const tag = typeof req.query.tag === 'string' ? req.query.tag : '';
  const environment = typeof req.query.environment === 'string' ? req.query.environment : '';
  if (!proxyClient || !tag || !environment) {
    res.status(400).json({ error: 'Bad request', message: `${TRANSIT_PROXY_HEADER}, tag and environment are required` });
    return;
  }
  if (!config.enc.apiClientEncryptionEnabled) {
    res.status(503).json({ error: 'API client encryption is not enabled' });
    return;
  }
  try {
    const result = await getEncryptionProvider().getTransitClientManifest({ tag, environment, proxyClient });
    if (!result) {
      res.status(404).json({ error: 'Not found', message: 'No client encryption manifest for this tag and environment' });
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.json({ clientManifest: result.clientManifest });
  } catch (err) {
    logger.error('[transit-proxy] failed to fetch client manifest', {
      tag,
      environment,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(502).json({ error: 'Encryption service unavailable' });
  }
});

export default router;
