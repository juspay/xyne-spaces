/**
 * Service-to-service authentication without a shared key.
 *
 * Each service (Spaces, claw-auth, the xyne-claw runtime) holds only its own
 * ES256 private key and signs a short assertion per request; receivers hold the
 * senders' public keys, one set per sender, so one service's key can never
 * sign as another. Each assertion:
 *   - lives at most 120 s (senders use 60 s),
 *   - is single-use (its jti is recorded in Redis; refused if Redis is down),
 *   - is bound to one request: `htm` (method) and `htu` (path) must match.
 *
 * Header `x-service-assertion: <JWT>`, typ "xyne-service+jwt", ES256, kid.
 * Claims { iss <service>, aud <service>, iat, exp, jti, htm, htu }.
 *
 * It proves only which service is calling. It never names a user: user-scoped
 * work goes through agent tokens (claw/tokens.ts) or delegation tokens.
 */

import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { KeyObject } from 'crypto';
import { redisService } from '@/services/redisService';
import { logger } from '@/utils/logger';
import { SPACES_ISSUER, clawRuntimePublicKey, clawServicePublicKey, signSpacesJwt, spacesPublicKey, verifyEs256 } from './jwt';

export type ServiceName = 'xyne-spaces' | 'xyne-claw-auth' | 'xyne-claw';
export const SERVICE_ASSERTION_HEADER = 'x-service-assertion';
export const SERVICE_ASSERTION_TYP = 'xyne-service+jwt';
const SELF: ServiceName = SPACES_ISSUER as ServiceName;
const LIFETIME_SECONDS = 60;
const MAX_LIFETIME_SECONDS = 120;
const REPLAY_TTL_SECONDS = MAX_LIFETIME_SECONDS + 60;

/** Public keys allowed to sign as each caller. */
const ISSUER_KEYS: Partial<Record<ServiceName, (kid: string) => KeyObject | undefined>> = {
  'xyne-claw-auth': clawServicePublicKey,
  'xyne-claw': clawRuntimePublicKey,
  // Spaces calling its own internal callbacks (e.g. the PR-check button).
  'xyne-spaces': spacesPublicKey,
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      clawService?: { iss: ServiceName; kid: string; jti: string };
    }
  }
}

/** Path the assertion must name: the request path without query string. */
function requestPath(req: Request): string {
  return (req.originalUrl || req.url || '').split('?')[0] ?? '';
}

function unverifiedIssuer(raw: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(raw.split('.')[1] ?? '', 'base64url').toString('utf8')) as { iss?: unknown };
    return typeof payload.iss === 'string' ? payload.iss : undefined;
  } catch {
    return undefined;
  }
}

/** Only the listed services may call this route. Sets req.clawService. */
export function authenticateService(...allow: ServiceName[]) {
  return async function authenticateServiceMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const header = req.headers[SERVICE_ASSERTION_HEADER];
    const raw = (Array.isArray(header) ? header[0] : header) ?? '';
    // The issuer picks which key set to verify with; it is then checked as a signed claim.
    const iss = unverifiedIssuer(raw) as ServiceName | undefined;
    const resolver = iss && allow.includes(iss) ? ISSUER_KEYS[iss] : undefined;
    if (!iss || !resolver) {
      logger.warn('[ServiceAuth] caller not allowed', { iss: iss ?? '(none)', method: req.method, path: requestPath(req) });
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = verifyEs256(raw, resolver, {
      issuer: iss,
      audience: SELF,
      typ: SERVICE_ASSERTION_TYP,
      maxLifetimeSeconds: MAX_LIFETIME_SECONDS,
    });
    if (typeof result === 'string') {
      logger.warn('[ServiceAuth] assertion rejected', { reason: result, iss, method: req.method, path: requestPath(req) });
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { header: h, payload } = result;
    const jti = typeof payload.jti === 'string' ? payload.jti : '';
    if (!jti || payload.htm !== req.method || payload.htu !== requestPath(req)) {
      logger.warn('[ServiceAuth] assertion not bound to this request', { iss, method: req.method, path: requestPath(req) });
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Single use. If Redis can't answer we refuse rather than accept a possible replay.
    let fresh: boolean;
    try {
      fresh = await redisService.set(`service-assertion:${jti}`, '1', REPLAY_TTL_SECONDS, true);
    } catch (error) {
      logger.error('[ServiceAuth] replay check unavailable', { error: error instanceof Error ? error.message : String(error) });
      res.status(503).json({ error: 'Service unavailable' });
      return;
    }
    if (!fresh) {
      logger.warn('[ServiceAuth] assertion replayed', { iss, jti });
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    req.clawService = { iss, kid: String(h.kid), jti };
    next();
  };
}

/** claw-auth only (agent principals, agent tokens, registration). */
export const authenticateClawService = authenticateService('xyne-claw-auth');

/** A one-shot assertion from Spaces to `aud`, or undefined when Spaces has no signing key. */
export function signServiceAssertion(aud: ServiceName, method: string, path: string): string | undefined {
  const now = Math.floor(Date.now() / 1000);
  return signSpacesJwt(
    { iss: SELF, aud, iat: now, exp: now + LIFETIME_SECONDS, jti: randomUUID(), htm: method.toUpperCase(), htu: path.split('?')[0] },
    SERVICE_ASSERTION_TYP
  );
}

/** Headers proving Spaces is calling `url` with `method`. Throws when Spaces can't sign (fail closed). */
export function serviceAuthHeaders(aud: ServiceName, method: string, url: string): Record<string, string> {
  const path = /^https?:\/\//i.test(url) ? new URL(url).pathname : (url.split('?')[0] ?? url);
  const token = signServiceAssertion(aud, method, path);
  if (!token) throw new Error('Spaces signing key not configured (CLAW_DELEGATION_PRIVATE_KEY); cannot call ' + aud);
  return { [SERVICE_ASSERTION_HEADER]: token };
}
