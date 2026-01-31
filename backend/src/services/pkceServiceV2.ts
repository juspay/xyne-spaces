import crypto from 'crypto';
import { logger } from '../utils/logger';

class PKCEService {
  private readonly VERIFIER_PREFIX = 'pkce:verifier:';
  private readonly VERIFIER_TTL = 600;

  generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  generateCodeChallenge(codeVerifier: string): string {
    return crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
  }

  async storeVerifier(state: string, codeVerifier: string): Promise<void> {
    const { redisService } = await import('./redisService');
    const client = redisService.getClient();

    await client.setex(
      `${this.VERIFIER_PREFIX}${state}`,
      this.VERIFIER_TTL,
      codeVerifier
    );

    logger.info(`PKCE verifier stored for state: ${state}`);
  }

  async getAndDeleteVerifier(state: string): Promise<string | null> {
    const { redisService } = await import('./redisService');
    const client = redisService.getClient();
    const key = `${this.VERIFIER_PREFIX}${state}`;

    const verifier = await client.get(key);

    if (verifier) {
      await client.del(key);
      logger.info(`PKCE verifier retrieved and deleted for state: ${state}`);
    }

    return verifier;
  }

  async verifyChallenge(state: string, providedVerifier: string): Promise<boolean> {
    const storedVerifier = await this.getAndDeleteVerifier(state);

    if (!storedVerifier) {
      logger.warn(`PKCE verifier not found for state: ${state}`);
      return false;
    }

    const expectedChallenge = this.generateCodeChallenge(storedVerifier);
    const providedChallenge = this.generateCodeChallenge(providedVerifier);

    const isValid = expectedChallenge === providedChallenge;

    if (isValid) {
      logger.info(`PKCE challenge verified for state: ${state}`);
    } else {
      logger.warn(`PKCE challenge verification failed for state: ${state}`);
    }

    return isValid;
  }
}

export const pkceServiceV2 = new PKCEService();
