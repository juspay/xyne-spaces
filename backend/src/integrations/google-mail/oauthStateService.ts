import crypto from 'crypto';
import { logger } from '@/utils/logger';
import type { GoogleMailOAuthState } from './types';

class GoogleMailOAuthStateService {
  private readonly STATE_PREFIX = 'google-mail:oauth:state:';
  private readonly CODE_PREFIX = 'google-mail:oauth:code:';
  private readonly STATE_TTL_SECONDS = 600;
  private readonly CODE_TTL_SECONDS = 600;

  async createState(sourceId: string, userId: string): Promise<string> {
    const { redisService } = await import('@/services/redisService');
    const client = redisService.getClient();
    const state = crypto.randomBytes(32).toString('base64url');

    const data: GoogleMailOAuthState = {
      state,
      sourceId,
      userId,
      createdAt: Date.now(),
    };

    await client.setex(
      `${this.STATE_PREFIX}${state}`,
      this.STATE_TTL_SECONDS,
      JSON.stringify(data)
    );

    logger.info(`[GOOGLE_MAIL] OAuth state created for source ${sourceId}`);
    return state;
  }

  async validateState(
    state: string,
    deleteAfterValidation: boolean = true
  ): Promise<GoogleMailOAuthState | null> {
    const { redisService } = await import('@/services/redisService');
    const client = redisService.getClient();
    const key = `${this.STATE_PREFIX}${state}`;
    const raw = await client.get(key);

    if (!raw) {
      return null;
    }

    if (deleteAfterValidation) {
      await client.del(key);
    }

    return JSON.parse(raw) as GoogleMailOAuthState;
  }

  async deleteState(state: string): Promise<void> {
    const { redisService } = await import('@/services/redisService');
    const client = redisService.getClient();
    await client.del(`${this.STATE_PREFIX}${state}`);
  }

  async isCodeUsed(code: string): Promise<boolean> {
    const { redisService } = await import('@/services/redisService');
    const client = redisService.getClient();
    const exists = await client.exists(`${this.CODE_PREFIX}${code}`);
    return exists === 1;
  }

  async markCodeAsUsed(code: string): Promise<void> {
    const { redisService } = await import('@/services/redisService');
    const client = redisService.getClient();
    await client.setex(`${this.CODE_PREFIX}${code}`, this.CODE_TTL_SECONDS, 'used');
  }
}

export const googleMailOAuthStateService = new GoogleMailOAuthStateService();
