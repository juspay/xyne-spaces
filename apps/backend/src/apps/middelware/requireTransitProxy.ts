import type { Request, Response, NextFunction } from 'express';
import { config } from '@/config/env';
import { TRANSIT_PROXY_HEADER, parseTransitProxyHeader } from './authenticator';

/**
 * In front of every /api/apps route. With the ingress transit proxy deployed
 * (TRANSIT_PROXY_INGRESS_ENABLED), every Xyne Apps call must have come through it: the proxy sets
 * `x-xyne-transit-proxy: ingress;<version>` on each request it forwards and drops any the caller
 * sent. A request without it reached the backend some other way and is refused, so nothing
 * falls back to plaintext. Without the proxy (the default) this does nothing.
 *
 * The header is not a credential: infra lets only the proxy reach /api/apps (Istio
 * AuthorizationPolicy), and the bot token is still checked by authenticateApp after this.
 */
export function requireTransitProxyIngress(req: Request, res: Response, next: NextFunction): void {
  if (!config.internal.transitProxyIngressEnabled) {
    next();
    return;
  }
  if (parseTransitProxyHeader(req.headers[TRANSIT_PROXY_HEADER])?.role === 'ingress') {
    next();
    return;
  }
  res.status(403).json({
    error: 'Forbidden',
    code: 'TRANSIT_PROXY_REQUIRED',
    message: 'Xyne Apps API calls must go through the transit proxy',
  });
}
