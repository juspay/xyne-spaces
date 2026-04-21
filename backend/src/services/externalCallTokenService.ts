import jwt from 'jsonwebtoken';
import { logger } from '@/utils/logger';

export interface ExternalCallTokenPayload {
  participantId: string;
  callId: string;
  externalId: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

const ISSUER = 'xyne-external-call';
const AUDIENCE = 'xyne-external-participant';
const MAX_AGE_SECONDS = 24 * 60 * 60; // 24 hours

class ExternalCallTokenService {
  private readonly secret: string;

  constructor() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET environment variable is required and must be at least 32 characters');
    }
    this.secret = secret;
  }

  sign(payload: { participantId: string; callId: string; externalId: string }): string {
    return jwt.sign(
      {
        participantId: payload.participantId,
        callId: payload.callId,
        externalId: payload.externalId,
      },
      this.secret,
      {
        expiresIn: MAX_AGE_SECONDS,
        issuer: ISSUER,
        audience: AUDIENCE,
      },
    );
  }

  verify(token: string): ExternalCallTokenPayload | null {
    try {
      return jwt.verify(token, this.secret, {
        issuer: ISSUER,
        audience: AUDIENCE,
      }) as ExternalCallTokenPayload;
    } catch (err) {
      logger.debug(`[external-call-token] verify failed | error=${err}`);
      return null;
    }
  }
}

export const externalCallTokenService = new ExternalCallTokenService();

export const EXT_CALL_COOKIE_PREFIX = 'ext_call_';
export const EXT_CALL_COOKIE_MAX_AGE_MS = MAX_AGE_SECONDS * 1000;

export function extCallCookieName(externalId: string): string {
  return `${EXT_CALL_COOKIE_PREFIX}${externalId}`;
}

export function extCallCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict' as const,
    path: '/api/call-lobby',
    maxAge: EXT_CALL_COOKIE_MAX_AGE_MS,
  };
}

export function clearExtCallCookie(res: { clearCookie: (name: string, options: object) => void }, externalId: string) {
  res.clearCookie(extCallCookieName(externalId), {
    httpOnly: true,
    path: '/api/call-lobby',
  });
}
