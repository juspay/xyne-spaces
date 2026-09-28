// Spaces token: a 1-hour JWT. Own audience, so it and a session token can't stand in for each
// other; its `kind` picks the subject that resolves it.
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '@/types/express';
import { SPACES_TOKEN_TTL_SECONDS } from '../constants';
import { ServiceAccountError } from '../errors';
import { serviceAccountGuest } from './subjects/serviceAccountGuest';
import { TokenSubjectKind, type SpacesTokenClaims, type TokenSubject } from './types';

const SUBJECTS: Record<TokenSubjectKind, TokenSubject> = {
  [TokenSubjectKind.SERVICE_ACCOUNT_GUEST]: serviceAccountGuest,
};

export const SPACES_TOKEN_AUDIENCE = 'xyne-spaces-token';
const ISSUER = 'xyne';

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    throw new Error('JWT_SECRET environment variable is required and must be at least 32 characters');
  }
  return value;
}

function invalid(): ServiceAccountError {
  return new ServiceAccountError('unauthenticated', 'The Spaces token is invalid.', { reason: 'token_invalid' });
}

export function signSpacesToken(claims: SpacesTokenClaims): { token: string; expiresAt: Date } {
  const token = jwt.sign(claims, secret(), {
    expiresIn: SPACES_TOKEN_TTL_SECONDS,
    audience: SPACES_TOKEN_AUDIENCE,
    issuer: ISSUER,
    jwtid: randomUUID(),
  });
  const { exp } = jwt.decode(token) as { exp: number };
  return { token, expiresAt: new Date(exp * 1000) };
}

export function isSpacesToken(token: string): boolean {
  const decoded = jwt.decode(token);
  return !!decoded && typeof decoded === 'object' && decoded.aud === SPACES_TOKEN_AUDIENCE;
}

function verify(token: string): SpacesTokenClaims {
  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, secret(), { audience: SPACES_TOKEN_AUDIENCE, issuer: ISSUER });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new ServiceAccountError('unauthenticated', 'The Spaces token has expired.', { reason: 'token_expired' });
    }
    throw invalid();
  }
  if (
    typeof decoded !== 'object' ||
    !Object.values(TokenSubjectKind).includes(decoded.kind) ||
    typeof decoded.sub !== 'string' ||
    typeof decoded.workspaceId !== 'string' ||
    typeof decoded.memberId !== 'string' ||
    typeof decoded.sa !== 'string'
  ) {
    throw invalid();
  }
  return {
    kind: decoded.kind,
    sub: decoded.sub,
    workspaceId: decoded.workspaceId,
    memberId: decoded.memberId,
    sa: decoded.sa,
  };
}

/** The user a Spaces token acts as, re-checked against the DB so deactivation applies at once. */
export async function resolveSpacesToken(token: string): Promise<AuthenticatedUser> {
  const claims = verify(token);
  return SUBJECTS[claims.kind].resolve(claims);
}

export { TokenSubjectKind, type SpacesTokenClaims, type TokenSubject } from './types';
