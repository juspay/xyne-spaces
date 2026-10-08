/**
 * Pending (pre-workspace-selection) OAuth identity, carried in the httpOnly
 * `google_access_token` cookie as a short-lived signed JWT. Identity ONLY: no provider
 * tokens are requested, stored or verified anywhere any more.
 */
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import type { CookieSameSite } from './types';
import { PENDING_AUTH_COOKIE, PENDING_AUTH_MAX_AGE_MS } from './constants';

export interface PendingAuthIdentity {
  email: string;
  name: string;
  picture?: string;
  /** AuthProvider value (GOOGLE | MICROSOFT | EMAIL). */
  provider: string;
  /**
   * Provider subject; email users use `email-<email>`. Cookies signed before this field existed
   * carry the same value under `googleId`; `readPendingAuth` folds that in, so nothing downstream
   * has to know about the old name.
   */
  providerUserId?: string;
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is required for pending auth cookies');
  return s;
}

export function signPendingAuth(identity: PendingAuthIdentity): string {
  const payload: PendingAuthIdentity = {
    email: identity.email,
    name: identity.name,
    provider: identity.provider,
    ...(identity.picture ? { picture: identity.picture } : {}),
    ...(identity.providerUserId ? { providerUserId: identity.providerUserId } : {}),
  };
  return jwt.sign(payload, secret(), { expiresIn: Math.floor(PENDING_AUTH_MAX_AGE_MS / 1000) });
}

export function setPendingAuthCookie(
  res: Response,
  identity: PendingAuthIdentity,
  sameSite: CookieSameSite,
  secure: boolean = process.env.NODE_ENV === 'production',
): void {
  res.cookie(PENDING_AUTH_COOKIE, signPendingAuth(identity), {
    httpOnly: true,
    secure: secure || sameSite === 'none',
    sameSite,
    path: '/',
    maxAge: PENDING_AUTH_MAX_AGE_MS,
  });
}

/** Verified identity from the pending cookie, or null (missing / invalid / expired). */
export function readPendingAuth(req: Pick<Request, 'cookies'>): PendingAuthIdentity | null {
  const raw = req.cookies?.[PENDING_AUTH_COOKIE];
  if (typeof raw !== 'string' || !raw) return null;
  try {
    // `googleId` is the pre-rename spelling of `providerUserId`: a cookie signed by the previous
    // deploy is still valid for its 10 minutes, so it is read and folded in here, once.
    const decoded = jwt.verify(raw, secret()) as Partial<PendingAuthIdentity> & { provider?: string; googleId?: string };
    if (!decoded || typeof decoded.email !== 'string' || !decoded.email) return null;
    return {
      email: decoded.email,
      name: decoded.name || '',
      picture: decoded.picture || undefined,
      provider: decoded.provider || 'GOOGLE',
      providerUserId: decoded.providerUserId || decoded.googleId || undefined,
    };
  } catch {
    return null;
  }
}

export function clearPendingAuth(res: Response): void {
  res.clearCookie(PENDING_AUTH_COOKIE, { path: '/' });
}
