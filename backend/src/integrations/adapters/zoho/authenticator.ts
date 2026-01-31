/**
 * Zoho webhook authenticator
 * Implements RS256 JWT validation for Zoho webhooks using JWK (JSON Web Keys)
 *
 * Based on Haskell implementation at euler-api-dashboard/src-generated/Webhook/Zoho.hs
 * Authentication uses x-zdesk-jwt header with RS256 algorithm
 *
 * SECURITY NOTE - Request Body Integrity:
 * - The JWT only signs the JWT payload (iss, aud, exp, iat), NOT the request body
 * - This means the JWT proves the request came from Zoho, but does NOT guarantee
 *   the request body wasn't tampered with in transit
 * - Potential attack: Replay a valid JWT with a modified request body (within 10 min expiration window)
 * - Mitigations in place:
 *   1. JWT expiration (10 minutes) limits replay window
 *   2. Duplicate detection via externalId in database prevents duplicate processing
 * - TODO: Consider adding additional protections:
 *   1. Track processed JWT IDs (jti claim) in Redis to prevent replay attacks
 *   2. Whitelist Zoho IP addresses at network level
 *   3. Request body hash validation (if Zoho adds support in future)
 * - This limitation matches the Haskell implementation's security model
 */

import jwt from 'jsonwebtoken';
import NodeRSA from 'node-rsa';
import { BaseAuthenticator } from '../../core/baseAuthenticator';
import { AuthResult } from '../../core/types';
import { logger } from '@/utils/logger';

interface JWK {
  kid: string;
  kty: string;
  alg: string;
  n: string;  // RSA modulus
  e: string;  // RSA exponent
  use?: string;
}

interface JWKSet {
  keys: JWK[];
}

interface ZohoJWTPayload {
  iss: string;  // Issuer: orgId:xxxxx
  aud: string;  // Audience: webhookId:xxxxx
  exp: number;  // Expiration timestamp
  iat: number;  // Issued at timestamp
}

export class ZohoAuthenticator extends BaseAuthenticator {

  /**
   * Authenticate Zoho webhook request
   * Validates JWT signature or detects test webhooks
   * @param credentialsJson - Decrypted credentials JSON string containing jwkSet, apiKey, etc.
   */
  async authenticate(
    rawBody: string,
    headers: Record<string, string | string[]>,
    credentialsJson: string,
    _sourceName: string
  ): Promise<AuthResult> {
    try {
      // Check for test webhook
      if (this.isTestWebhook(rawBody)) {
        logger.info('Test webhook detected - skipping processing');
        return {
          authenticated: true,
          skipProcessing: true,
          reason: 'test_webhook'
        };
      }

      if (!credentialsJson) {
        logger.error('jwkSet not found in credentials');
        return { authenticated: false };
      }

      // Extract JWT from header
      const jwtTokenRaw = headers['x-zdesk-jwt'];

      if (!jwtTokenRaw) {
        logger.warn('Zoho webhook missing x-zdesk-jwt header');
        return { authenticated: false };
      }

      // Handle case where header might be an array (take first value)
      const jwtToken = Array.isArray(jwtTokenRaw) ? jwtTokenRaw[0] : jwtTokenRaw;

      if (!jwtToken) {
        logger.warn('Zoho webhook x-zdesk-jwt header is empty');
        return { authenticated: false };
      }

      // Parse JWK Set
      const jwkSet = this.parseJWKSet(credentialsJson);

      if (!jwkSet || jwkSet.keys.length === 0) {
        logger.error('Invalid or empty JWK Set provided');
        return { authenticated: false };
      }

      // Verify JWT
      const isValid = this.verifyJWT(jwtToken, jwkSet);
      return { authenticated: isValid };

    } catch (error) {
      logger.error('Zoho authentication error:', error);
      return { authenticated: false };
    }
  }

  /**
   * Detect Zoho test webhooks
   * Test webhooks have body: {"{}":""}
   */
  private isTestWebhook(rawBody: string): boolean {
    const bodyStr = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
    return bodyStr === '{"{}":""}';
  }

  /**
   * Parse JWK Set from JSON string
   */
  private parseJWKSet(jwkSetJson: string): JWKSet | null {
    try {
      const parsed = JSON.parse(jwkSetJson);

      // Handle both formats:
      // 1. Direct JWK Set: { "keys": [...] }
      // 2. Nested in credentials: { "jwkSet": { "keys": [...] }, "apiKey": "...", ... }
      let jwkSet: any;

      if (parsed.jwkSet && typeof parsed.jwkSet === 'object') {
        // Format 2: Extract jwkSet from credentials object
        jwkSet = parsed.jwkSet;
        logger.info('Using nested jwkSet from credentials');
      } else if (parsed.keys) {
        // Format 1: Direct JWK Set
        jwkSet = parsed;
        logger.info('Using direct JWK Set format');
      } else {
        logger.error('JWK Set must have a "keys" array', {
          actualStructure: Object.keys(parsed),
          hasJwkSet: !!parsed.jwkSet,
          hasKeys: !!parsed.keys
        });
        return null;
      }

      // Validate the JWK Set has keys array
      if (!jwkSet.keys || !Array.isArray(jwkSet.keys)) {
        logger.error('JWK Set must have a "keys" array', {
          jwkSetStructure: Object.keys(jwkSet),
          hasKeys: !!jwkSet.keys
        });
        return null;
      }

      logger.info('JWK Set parsed successfully', {
        keysCount: jwkSet.keys.length
      });

      return jwkSet as JWKSet;
    } catch (error) {
      logger.error('Failed to parse JWK Set:', error);
      return null;
    }
  }

  /**
   * Verify JWT signature using RS256 and JWK Set
   * Matches Haskell implementation: jwtRSHA256Verify
   */
  private verifyJWT(token: string, jwkSet: JWKSet): boolean {
    try {
      // Decode JWT header to get kid (Key ID)
      const decoded = jwt.decode(token, { complete: true });

      if (!decoded || !decoded.header) {
        logger.error('Failed to decode JWT header');
        return false;
      }

      const { kid, alg } = decoded.header;

      // Verify algorithm is RS256
      if (alg !== 'RS256') {
        logger.error(`Unsupported JWT algorithm: ${alg}, expected RS256`);
        return false;
      }

      // Find matching JWK by kid
      const jwk = jwkSet.keys.find(key => key.kid === kid);

      if (!jwk) {
        logger.error(`No JWK found for kid: ${kid}`);
        return false;
      }

      // Convert JWK to PEM format for jsonwebtoken
      const publicKey = this.jwkToPem(jwk);

      // Verify JWT signature and claims
      const payload = jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
      }) as ZohoJWTPayload;

      // Log successful validation with payload info
      logger.debug('Zoho JWT validated successfully', {
        issuer: payload.iss,
        audience: payload.aud,
        exp: new Date(payload.exp * 1000),
      });

      return true;

    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        logger.error('JWT validation failed:', error.message);
      } else if (error instanceof jwt.TokenExpiredError) {
        logger.error('JWT token expired:', error.message);
      } else {
        logger.error('Unexpected JWT verification error:', error);
      }
      return false;
    }
  }

  /**
   * Convert JWK to PEM format for use with jsonwebtoken
   * RS256 uses RSA public key with modulus (n) and exponent (e)
   */
  private jwkToPem(jwk: JWK): string {
    try {
      const key = new NodeRSA();

      // Import from JWK components
      key.importKey({
        n: Buffer.from(jwk.n, 'base64'),
        e: Buffer.from(jwk.e, 'base64'),
      }, 'components-public');

      // Export as PEM
      return key.exportKey('public');

    } catch (error) {
      logger.error('Failed to convert JWK to PEM:', error);
      throw new Error('JWK to PEM conversion failed');
    }
  }
}
