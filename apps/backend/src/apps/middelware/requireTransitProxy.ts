import type { Request, Response, NextFunction } from 'express';
import { config } from '@/config/env';
import { TRANSIT_PROXY_HEADER, parseTransitProxyHeader } from './authenticator';

/**
 * In front of every /api/apps route: the backend's transit-proxy setting and where the request
 * came from must agree. The ingress proxy sets `x-xyne-transit-proxy: ingress;<version>` on each
 * request it forwards and drops any the caller sent.
 *
 * - TRANSIT_PROXY_ENABLED on (the proxy is deployed): every Xyne Apps call must have
 *   come through it. One without the header reached the backend some other way: 403
 *   TRANSIT_PROXY_REQUIRED, so nothing falls back to plaintext.
 * - Off (the default, no proxy): a request with the header is refused, 503
 *   TRANSIT_PROXY_NOT_ENABLED. The proxy encrypted its fields to the encryption service's apps
 *   key, which this backend does not turn into workspace-DEK ciphertext with the setting off; it
 *   would store transit ciphertext nobody can read. A proxy in front of a backend not set up for
 *   it is a deployment error, so it fails loudly instead.
 *
 * The header is not a credential: infra lets only the proxy reach /api/apps (Istio
 * AuthorizationPolicy), and the bot token is still checked by authenticateApp after this.
 */
export function requireTransitProxyIngress(req: Request, res: Response, next: NextFunction): void {
  const viaIngressProxy = parseTransitProxyHeader(req.headers[TRANSIT_PROXY_HEADER])?.role === 'ingress';
  if (config.internal.transitProxyEnabled === viaIngressProxy) {
    next();
    return;
  }
  if (viaIngressProxy) {
    res.status(503).json({
      error: 'Service Unavailable',
      code: 'TRANSIT_PROXY_NOT_ENABLED',
      message: 'This backend is not set up for the transit proxy (TRANSIT_PROXY_ENABLED is off)',
    });
    return;
  }
  res.status(403).json({
    error: 'Forbidden',
    code: 'TRANSIT_PROXY_REQUIRED',
    message: 'Xyne Apps API calls must go through the transit proxy',
  });
}
