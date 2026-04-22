import { BaseAuthenticator } from '../../core/baseAuthenticator';
import { AuthResult } from '../../core/types';
import { logger } from '@/utils/logger';
import { OAuth2Client } from 'google-auth-library';
import { GoogleCredentials } from './types';

const TAG = '[GoogleAuthenticator]';
const FAIL: AuthResult = { authenticated: false };
const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000; // 10 min — covers Pub/Sub ack deadline (600s)

export class GoogleAuthenticator extends BaseAuthenticator {
  private oauth2Client = new OAuth2Client();

  async authenticate(
    rawBody: string,
    headers: Record<string, string | string[]>,
    credentialsJson: string,
    sourceName: string
  ): Promise<AuthResult> {
    try {
      const payload = this.parseJSON(rawBody, sourceName);
      if (!payload?.message?.data) {
        return this.fail('Invalid Pub/Sub message structure', { sourceName });
      }

      const credentials = this.parseJSON(credentialsJson, sourceName) as GoogleCredentials | null;
      if (!credentials?.email) {
        return this.fail('Missing or invalid credentials', { sourceName });
      }

      // 1. Staleness check — return 200/skip so Pub/Sub acknowledges and stops retrying
      if (payload.message.publishTime) {
        const age = Date.now() - new Date(payload.message.publishTime).getTime();
        if (age > MAX_MESSAGE_AGE_MS) {
          logger.warn(`${TAG} Message too old (${Math.round(age / 1000)}s), skipping`, { sourceName });
          return { authenticated: true, skipProcessing: true, reason: `Message too old (${Math.round(age / 1000)}s)` };
        }
      }

      // 2. Verify OIDC JWT from Authorization header
      const jwtError = await this.verifyJWT(headers, sourceName);
      if (jwtError) return this.fail(jwtError, { sourceName });

      // 3. Verify email matches credentials
      const emailError = this.verifyEmail(payload.message.data, credentials.email);
      if (emailError) return this.fail(emailError, { sourceName });

      logger.info(`${TAG} Authentication successful`, { sourceName });
      return { authenticated: true };
    } catch (error) {
      logger.error(`${TAG} Unexpected error`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        sourceName,
      });
      return FAIL;
    }
  }

  private async verifyJWT(
    headers: Record<string, string | string[]>,
    sourceName: string
  ): Promise<string | null> {
    const authHeader = headers['authorization'];
    if (!authHeader) return 'Missing Authorization header';

    const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const bearer = token.replace(/^Bearer\s+/i, '').trim();
    if (!bearer) return 'Empty Bearer token';

    const expectedAudience = `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/external-source-sync/${sourceName}/ingest`;

    try {
      const ticket = await this.oauth2Client.verifyIdToken({ idToken: bearer, audience: expectedAudience });
      const email = ticket.getPayload()?.email;
      if (!email || (!email.endsWith('@google.com') && !email.endsWith('.gserviceaccount.com'))) {
        return `JWT not from Google service account: ${email}`;
      }
    } catch (error) {
      return `JWT verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }

    return null;
  }

  private verifyEmail(base64Data: string, expectedEmail: string): string | null {
    try {
      const data = JSON.parse(Buffer.from(base64Data, 'base64').toString('utf-8'));
      if (!data.emailAddress || !data.historyId) return 'Missing emailAddress or historyId in Pub/Sub data';
      if (data.emailAddress !== expectedEmail) return `Email mismatch: expected ${expectedEmail}, got ${data.emailAddress}`;
    } catch {
      return 'Failed to decode Pub/Sub message data';
    }
    return null;
  }

  private parseJSON(raw: string, sourceName: string): any | null {
    try {
      return JSON.parse(raw);
    } catch {
      this.fail('Failed to parse JSON', { sourceName });
      return null;
    }
  }

  private fail(reason: string, context: Record<string, any>): AuthResult {
    logger.error(`${TAG} ${reason}`, context);
    return FAIL;
  }
}
