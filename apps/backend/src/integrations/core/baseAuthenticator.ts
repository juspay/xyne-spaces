import { AuthResult } from './types';

/**
 * Base class for authentication
 * Platform-specific signature/JWT validation
 */
export abstract class BaseAuthenticator {
  /**
   * Authenticate incoming request
   *
   * @param rawBody - Raw request body (string)
   * @param headers - Request headers
   * @param secret - Authentication secret (JWT key, HMAC secret, etc.)
   * @returns AuthResult with authentication status and optional skip flag
   */
  abstract authenticate(
    rawBody: string,
    headers: Record<string, string | string[]>,
    secret: string,
    sourceName: string
  ): Promise<AuthResult>;
}
