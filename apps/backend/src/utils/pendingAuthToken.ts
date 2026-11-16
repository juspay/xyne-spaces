import jwt from 'jsonwebtoken';
import { config } from '@/config/env';

// Shares JWT_SECRET with session JWTs (aud=xyne-user); the distinct audience keeps either from passing as the other.
const ISSUER = 'xyne';
const AUDIENCE = 'xyne-pending-auth';
const TTL = '10m';

export interface PendingAuthClaims {
  email?: string;
  name?: string;
  picture?: string;
  googleId?: string;
  providerUserId?: string;
  provider?: string;
  refreshToken?: string | null;
  accessToken?: string | null;
  accessTokenExpiry?: string | null;
  tokenKey?: string;
}

export function signPendingAuthToken(claims: PendingAuthClaims): string {
  return jwt.sign(claims, config.jwt.secret, {
    expiresIn: TTL,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: 'HS256',
  });
}

/** Claims of a valid pending-auth token, or null for anything else (including session JWTs). */
export function verifyPendingAuthToken(token: string): PendingAuthClaims | null {
  try {
    return jwt.verify(token, config.jwt.secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    }) as PendingAuthClaims;
  } catch {
    return null;
  }
}
