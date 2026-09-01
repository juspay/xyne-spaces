import crypto from 'crypto';
import { logger } from '../utils/logger';

export type OAuthProvider = 'google' | 'microsoft';

interface OAuthState {
  state: string;
  platform: 'web' | 'electron' | 'mobile';
  provider?: OAuthProvider;
  codeChallenge?: string;
  createdAt: number;
  redirectTo?: string;
  isNy?: boolean;
  invitationId?: string;
  enterpriseLogin?: boolean;
  flowId?: string;
}

class OAuthStateService {
  private readonly STATE_PREFIX = 'oauth:state:';
  private readonly CODE_PREFIX = 'oauth:code:';
  private readonly STATE_TTL = 600;
  private readonly CODE_TTL = 600;

  async generateState(
    platform: 'web' | 'electron' | 'mobile',
    codeChallenge?: string,
    redirectTo?: string,
    provider: OAuthProvider = 'google',
    isNy?: boolean,
    invitationId?: string,
    enterpriseLogin?: boolean,
    flowId?: string,
  ): Promise<string> {
    const { redisService } = await import('./redisService');
    const client = redisService.getClient();

    const state = crypto.randomBytes(32).toString('base64url');

    const stateData: OAuthState = {
      state,
      platform,
      provider,
      codeChallenge,
      createdAt: Date.now(),
      ...(redirectTo !== undefined ? { redirectTo } : {}),
      ...(isNy ? { isNy } : {}),
      ...(invitationId ? { invitationId } : {}),
      ...(enterpriseLogin ? { enterpriseLogin } : {}),
      ...(flowId ? { flowId } : {}),
    };

    await client.setex(
      `${this.STATE_PREFIX}${state}`,
      this.STATE_TTL,
      JSON.stringify(stateData)
    );

    logger.info(`OAuth state created: ${state} (platform: ${platform})`);
    return state;
  }

  async validateState(state: string, deleteAfterValidation = true): Promise<OAuthState | null> {
    const { redisService } = await import('./redisService');
    const client = redisService.getClient();
    const key = `${this.STATE_PREFIX}${state}`;

    const data = await client.get(key);

    if (!data) {
      logger.warn(`OAuth state not found or expired: ${state}`);
      return null;
    }

    if (deleteAfterValidation) {
      await client.del(key);
    }

    const stateData = JSON.parse(data) as OAuthState;
    logger.info(`OAuth state validated: ${state} (platform: ${stateData.platform}, deleted: ${deleteAfterValidation})`);
    return stateData;
  }

  async deleteState(state: string): Promise<void> {
    const { redisService } = await import('./redisService');
    const client = redisService.getClient();
    const key = `${this.STATE_PREFIX}${state}`;
    await client.del(key);
    logger.info(`OAuth state deleted: ${state}`);
  }

  async markCodeAsUsed(code: string): Promise<void> {
    const { redisService } = await import('./redisService');
    const client = redisService.getClient();

    await client.setex(
      `${this.CODE_PREFIX}${code}`,
      this.CODE_TTL,
      'used'
    );

    logger.info(`OAuth code marked as used: ${code.substring(0, 10)}...`);
  }

  async isCodeUsed(code: string): Promise<boolean> {
    const { redisService } = await import('./redisService');
    const client = redisService.getClient();

    const exists = await client.exists(`${this.CODE_PREFIX}${code}`);
    return exists === 1;
  }
}

export const oauthStateServiceV2 = new OAuthStateService();
