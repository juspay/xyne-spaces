import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { OrgRole, UserStatus, WorkspaceRole } from '@xyne/shared';
import { loadGuestTokenRows } from '@/bypassAcl/appGuestServices';
import type { AuthenticatedUser } from '@/types/express';

/**
 * The Spaces token an app gets for one of its guests. Its own audience keeps it off every route but
 * /api/sdk, and it is re-checked against the DB on each request so deactivation applies at once.
 */
const AUDIENCE = 'xyne-spaces-token';
const ISSUER = 'xyne';
const TTL_SECONDS = 60 * 60;

export interface GuestTokenClaims {
  sub: string;
  workspaceId: string;
  memberId: string;
  /** The installed app that issued it. */
  app: string;
}

export class GuestTokenError extends Error {
  constructor(message: string, readonly reason: string) {
    super(message);
  }
}

/** Read at call time, never at module load. */
function secret(): string {
  const value = process.env['JWT_SECRET'];
  if (!value) throw new Error('JWT_SECRET environment variable is required');
  return value;
}

export function mintGuestToken(claims: GuestTokenClaims): { token: string; expiresAt: Date } {
  const token = jwt.sign(claims, secret(), { expiresIn: TTL_SECONDS, audience: AUDIENCE, issuer: ISSUER, jwtid: randomUUID() });
  const { exp } = jwt.decode(token) as { exp: number };
  return { token, expiresAt: new Date(exp * 1000) };
}

export function isGuestToken(token: string): boolean {
  const decoded = jwt.decode(token);
  return !!decoded && typeof decoded === 'object' && decoded.aud === AUDIENCE;
}

/** The guest a token acts as: still the app's and active, and the app still installed with guests:write. */
export async function resolveGuestToken(token: string): Promise<AuthenticatedUser> {
  let claims: GuestTokenClaims;
  try {
    claims = jwt.verify(token, secret(), { audience: AUDIENCE, issuer: ISSUER }) as GuestTokenClaims;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw new GuestTokenError('The Spaces token has expired.', 'token_expired');
    throw new GuestTokenError('The Spaces token is invalid.', 'token_invalid');
  }
  if ([claims.sub, claims.workspaceId, claims.memberId, claims.app].some((value) => typeof value !== 'string')) {
    throw new GuestTokenError('The Spaces token is invalid.', 'token_invalid');
  }

  const { user, member, install, bot, permissions } = await loadGuestTokenRows(claims);
  if (
    !user ||
    !member ||
    !install ||
    !bot ||
    user.workspaceId !== claims.workspaceId ||
    bot.workspaceId !== claims.workspaceId ||
    user.orgMemberId !== claims.memberId ||
    user.role !== WorkspaceRole.GUEST ||
    !user.providerUserId.startsWith(`app:${install.id}:`)
  ) {
    throw new GuestTokenError('The Spaces token is invalid.', 'token_invalid');
  }
  if (bot.status !== UserStatus.ACTIVE || !permissions.includes('guests:write')) {
    throw new GuestTokenError('The app that issued this token can no longer manage guests.', 'app_revoked');
  }
  if (user.status !== UserStatus.ACTIVE || user.leftAt || member.leftAt) {
    throw new GuestTokenError('This user is deactivated.', 'user_deactivated');
  }

  return {
    id: user.id,
    googleId: user.providerUserId,
    email: user.email,
    name: user.name,
    displayName: user.displayName,
    workspaceId: user.workspaceId,
    isApiKeyUser: false,
    scopes: [],
    role: user.role,
    orgRole: OrgRole.GUEST,
    memberId: member.memberId,
    authProvider: user.authProvider,
  };
}
