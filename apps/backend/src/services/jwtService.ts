import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';
import { config } from '../config/env';
import type { SessionPlatform } from '@/auth/types';

/**
 * Everything a session access JWT carries. Minted ONLY by `mintWorkspaceJwt` (src/auth/sessionIssuer.ts)
 * so every token has the same field set; verified statelessly by the resolver (signature + Redis
 * tombstone on `sid`), so the claims must be enough to build `req.user` and `req.authSession`
 * without a DB read. Readers outside the backend: Zero (`sub`, `email`, `name`, `memberId`,
 * `workspaceId`, `sid`), Electron (`email`), mobile (`sub`, `workspaceId`, `exp`), claw (`sub`,
 * `workspaceId`, `exp`). No `picture`, `provider` or `providerUserId`: nothing reads them.
 */
export interface SessionJwtClaims {
  /** Workspace `users.id`. */
  sub: string;
  email: string;
  name: string;
  workspaceId: string;
  /** `org_members.memberId` — the account (`auth_sessions.accountId`). */
  memberId: string;
  /** `auth_sessions.id` the token was minted from. */
  sid: string;
  /** Workspace role (`users.role`). */
  role: string;
  /** Org role (`org_members.role`). */
  orgRole: string;
  orgId: string;
  platform: SessionPlatform;
}

/** Session claims optional: tokens minted before the session stack carry only the first five. */
export type JwtPayload = Pick<SessionJwtClaims, 'sub' | 'email' | 'name' | 'workspaceId' | 'memberId'> &
  Partial<Pick<SessionJwtClaims, 'sid' | 'role' | 'orgRole' | 'orgId' | 'platform'>> & {
    iat?: number;
    exp?: number;
    iss?: string;
    aud?: string;
  };

/** A token minted from an auth session: carries everything needed for a stateless resolve. */
export function isSessionJwt(payload: JwtPayload): payload is JwtPayload & SessionJwtClaims {
  return (
    typeof payload.sid === 'string' &&
    payload.sid.length > 0 &&
    typeof payload.role === 'string' &&
    typeof payload.orgRole === 'string' &&
    typeof payload.orgId === 'string' &&
    typeof payload.platform === 'string'
  );
}

export class JwtService {
  private readonly secret: string;
  private readonly issuer = 'xyne';
  private readonly audience = 'xyne-user';

  constructor() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET environment variable is required and must be at least 32 characters');
    }
    this.secret = secret;
  }

  /**
   * Sign a session access JWT. Exactly the `SessionJwtClaims` field set, nothing else.
   */
  generateToken(payload: SessionJwtClaims, opts?: { expiresInSeconds?: number }): string {
    try {
      const token = jwt.sign(
        {
          sub: payload.sub,
          email: payload.email,
          name: payload.name,
          workspaceId: payload.workspaceId,
          memberId: payload.memberId,
          sid: payload.sid,
          role: payload.role,
          orgRole: payload.orgRole,
          orgId: payload.orgId,
          platform: payload.platform,
        },
        this.secret,
        {
          expiresIn: opts?.expiresInSeconds ?? config.jwt.expirationSeconds,
          issuer: this.issuer,
          audience: this.audience,
        }
      );

      // Debug: inline refresh mints on ordinary API calls; info would flood the log.
      logger.debug('JWT token generated', { userId: payload.sub, workspaceId: payload.workspaceId, sid: payload.sid });
      return token;
    } catch (error) {
      logger.error('Error generating JWT token:', error);
      throw new Error('Failed to generate JWT token');
    }
  }

  /**
   * Verify and decode a JWT token
   */
  verifyToken(token: string): JwtPayload {
    try {
      const decoded = jwt.verify(token, this.secret, {
        issuer: this.issuer,
        audience: this.audience,
      }) as JwtPayload;

      const forceLogoutBefore = config.jwt.forceLogoutBefore;
      if (forceLogoutBefore && decoded.iat && decoded.iat < forceLogoutBefore) {
        throw new Error('JWT token has expired');
      }

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('JWT token has expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid JWT token');
      } else {
        logger.error('Error verifying JWT token:', error);
        throw new Error('Failed to verify JWT token');
      }
    }
  }

  /**
   * Decode a JWT token without verification (for debugging)
   */
  decodeToken(token: string): JwtPayload | null {
    try {
      return jwt.decode(token) as JwtPayload;
    } catch (error) {
      logger.error('Error decoding JWT token:', error);
      return null;
    }
  }

  /**
   * Check if a token is expired without verification
   */
  isTokenExpired(token: string): boolean {
    try {
      const decoded = this.decodeToken(token);
      if (!decoded || !decoded.exp) {
        return true;
      }

      const now = Math.floor(Date.now() / 1000);
      return decoded.exp < now;
    } catch (error) {
      return true;
    }
  }
}

export const jwtService = new JwtService();
