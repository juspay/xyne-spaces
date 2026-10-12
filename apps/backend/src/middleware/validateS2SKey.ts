import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Constant-time comparison of a supplied S2S key against an expected key.
 *
 * Plain `!==` and `Array.prototype.includes` short-circuit at the first
 * differing byte, leaking a prefix-match timing side channel to network
 * callers. The S2S key gates internal endpoints that act on behalf of
 * arbitrary users (internalCanvas view routes, /api/internal/postAsUser and
 * friends), so the comparison must not be observable through timing. Mirrors
 * the existing timingSafeEqual usage in verifySlackRequest.ts,
 * passwordUtils.ts and sdlcInteractiveGrant.ts.
 */
export function s2sKeyMatches(supplied: string, expected: string): boolean {
  const suppliedBuf = Buffer.from(supplied, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  // Length is checked first because timingSafeEqual throws on mismatched
  // lengths; key length is not treated as secret.
  return suppliedBuf.length === expectedBuf.length && timingSafeEqual(suppliedBuf, expectedBuf);
}

/**
 * Constant-time check of a supplied S2S key against any of the accepted keys
 * (e.g. INTERNAL_S2S_KEY plus a service-specific key). Falsy entries are
 * ignored; returns false when no accepted key is configured.
 */
export function anyS2sKeyMatches(supplied: string, accepted: ReadonlyArray<string | undefined>): boolean {
  return accepted.some(
    (key) => typeof key === 'string' && key.length > 0 && s2sKeyMatches(supplied, key),
  );
}

/**
 * Service-to-service key validation middleware.
 * Checks the x-s2s-key header against INTERNAL_S2S_KEY env var.
 * Used to protect endpoints that should only be callable by internal
 * services (e.g. xyne-claw MCP tools).
 */
export const validateS2SKey = (req: Request, res: Response, next: NextFunction): void => {
  const s2sKey = process.env['INTERNAL_S2S_KEY'];
  const supplied = req.headers['x-s2s-key'];
  if (!s2sKey || typeof supplied !== 'string' || !s2sKeyMatches(supplied, s2sKey)) {
    res.status(401).json({ error: 'Invalid or missing S2S key' });
    return;
  }
  next();
};
