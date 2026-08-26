/**
 * SDK JWT Service - Generates and validates JWT tokens for SDK authentication.
 *
 * SDK JWTs are distinct from user session JWTs:
 * - Different issuer: 'xyne-sdk' vs 'xyne'
 * - Different audience: 'xyne-sdk-api' vs 'xyne-user'
 * - Longer expiry: 30/60/90 days (like API keys)
 * - Contains jti (JWT ID) for potential revocation
 * - Prefixed with 'xyne_sso_' for easy identification
 *
 * SDK JWTs and API keys are interchangeable auth methods for the SDK.
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { logger } from '@/utils/logger';

/** Prefix for SDK SSO JWT tokens */
export const SDK_SSO_TOKEN_PREFIX = 'xyne_sso_';

/** TTL choices for SDK tokens (in days) */
export const SDK_TOKEN_TTL_CHOICES = [1] as const;
export type SdkTokenTtlDays = (typeof SDK_TOKEN_TTL_CHOICES)[number];

/** Payload stored in an SDK JWT */
export interface SdkJwtPayload {
  sub: string;              // userId
  email: string;
  name: string;
  displayName?: string;
  workspaceId: string;
  orgId: string;
  memberId: string;
  jti: string;              // Unique JWT ID for revocation
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

/** Identity info needed to generate an SDK JWT */
export interface SdkJwtIdentity {
  userId: string;
  email: string;
  name: string;
  displayName?: string;
  workspaceId: string;
  orgId: string;
  memberId: string;
}

class SdkJwtService {
  private readonly secret: string;
  private readonly issuer = 'xyne-sdk';
  private readonly audience = 'xyne-sdk-api';

  constructor() {
    // Use the same JWT_SECRET as the main JWT service
    // In production, you might want a separate SDK_JWT_SECRET
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET environment variable is required and must be at least 32 characters');
    }
    this.secret = secret;
  }

  /**
   * Generate an SDK JWT token.
   * Returns the token prefixed with 'xyne_sso_' for easy identification.
   */
  generateToken(identity: SdkJwtIdentity, ttlDays: SdkTokenTtlDays): { token: string; expiresAt: number } {
    const jti = crypto.randomUUID();
    const expiresIn = ttlDays * 24 * 60 * 60; // Convert days to seconds
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

    const payload: Omit<SdkJwtPayload, 'iat' | 'exp' | 'iss' | 'aud'> = {
      sub: identity.userId,
      email: identity.email,
      name: identity.name,
      displayName: identity.displayName,
      workspaceId: identity.workspaceId,
      orgId: identity.orgId,
      memberId: identity.memberId,
      jti,
    };

    const rawToken = jwt.sign(payload, this.secret, {
      expiresIn,
      issuer: this.issuer,
      audience: this.audience,
    });

    // Prefix the token so it's easily identifiable
    const token = `${SDK_SSO_TOKEN_PREFIX}${rawToken}`;

    logger.info(`[SDK-JWT] Token generated for user: ${identity.email}`, {
      userId: identity.userId,
      workspaceId: identity.workspaceId,
      ttlDays,
      jti,
    });

    return { token, expiresAt: expiresAt * 1000 }; // Return expiresAt in milliseconds
  }

  /**
   * Verify and decode an SDK JWT token.
   * Accepts token with or without the 'xyne_sso_' prefix.
   */
  verifyToken(token: string): SdkJwtPayload {
    // Strip prefix if present
    const rawToken = token.startsWith(SDK_SSO_TOKEN_PREFIX)
      ? token.slice(SDK_SSO_TOKEN_PREFIX.length)
      : token;

    try {
      const decoded = jwt.verify(rawToken, this.secret, {
        issuer: this.issuer,
        audience: this.audience,
      }) as SdkJwtPayload;

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('SDK token has expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid SDK token');
      } else {
        logger.error('[SDK-JWT] Error verifying token:', error);
        throw new Error('Failed to verify SDK token');
      }
    }
  }

  /**
   * Decode an SDK JWT token without verification (for debugging/logging).
   */
  decodeToken(token: string): SdkJwtPayload | null {
    const rawToken = token.startsWith(SDK_SSO_TOKEN_PREFIX)
      ? token.slice(SDK_SSO_TOKEN_PREFIX.length)
      : token;

    try {
      return jwt.decode(rawToken) as SdkJwtPayload;
    } catch (error) {
      logger.error('[SDK-JWT] Error decoding token:', error);
      return null;
    }
  }

  /**
   * Check if a token is an SDK SSO token (by prefix).
   */
  isSdkSsoToken(token: string): boolean {
    return token.startsWith(SDK_SSO_TOKEN_PREFIX);
  }

  /**
   * Get token expiration date for a given TTL.
   */
  getExpirationDate(ttlDays: SdkTokenTtlDays, now: Date = new Date()): Date {
    return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
  }
}

export const sdkJwtService = new SdkJwtService();
