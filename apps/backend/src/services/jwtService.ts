import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';
import { config } from '../config/env';

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  workspaceId: string;
  memberId: string;
  providerUserId?: string;
  provider?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

export class JwtService {
  private readonly secret: string;
  private readonly issuer = 'xyne';
  private readonly audience = 'xyne-user';

  constructor() {
    const secret = config.jwt.secret;
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET environment variable is required and must be at least 32 characters');
    }
    this.secret = secret;
  }

  /**
   * Seconds a JWT may live: the configured lifetime, but never past `sessionExpiry`.
   * Pass the result to both generateToken and the token cookie's maxAge so the two always match.
   * Zero or negative once the session has expired: the JWT is born expired, the cookie deleted.
   */
  getAccessTokenLifetimeSeconds(sessionExpiry?: Date): number {
    if (!sessionExpiry) return config.jwt.expirationSeconds;

    const secondsUntilSessionExpiry = Math.floor((sessionExpiry.getTime() - Date.now()) / 1000);
    return Math.min(config.jwt.expirationSeconds, secondsUntilSessionExpiry);
  }

  /**
   * Generate a JWT token with the specified payload.
   * @param expiresInSeconds From getAccessTokenLifetimeSeconds when renewing an existing session.
   */
  generateToken(
    payload: Omit<JwtPayload, 'iat' | 'exp' | 'iss' | 'aud'>,
    expiresInSeconds: number = config.jwt.expirationSeconds
  ): string {
    try {
      const token = jwt.sign(
        {
          sub: payload.sub,
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
          workspaceId: payload.workspaceId,
          memberId: payload.memberId,
          providerUserId: payload.providerUserId,
          provider: payload.provider,
        },
        this.secret,
        {
          expiresIn: expiresInSeconds,
          issuer: this.issuer,
          audience: this.audience,
        }
      );

      logger.info(`JWT token generated for user: ${payload.email}`);
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
