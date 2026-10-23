import { randomBytes } from 'crypto';
import { decrypt, encrypt, redisService, runWithContext } from '../../re-exports';
import type { BaseApi } from '../base/baseApi';
import type { BaseProvider } from '../base/baseProvider';
import { GatewayError } from '../errors';
import { UserTokenRepository } from '../repositories/userTokenRepository';
import type { ConfigService } from './configService';

const STATE_TTL_SECONDS = 10 * 60;
const stateKey = (state: string): string => `gateway:user-auth:${state}`;

/** Who started a sign-in, and where the dashboard returns them afterwards. */
export interface UserAuthSession {
  userId: string;
  workspaceId: string;
  returnTo: string;
  platform: 'web' | 'electron';
}

export interface UserAuthStatus {
  connected: boolean;
  connectedAt: Date | null;
}

/** An API acting as one Spaces user. */
export interface UserApi<TApi extends BaseApi = BaseApi> {
  api: TApi;
  spacesUserId: string;
  externalUserId: string;
}

/**
 * Lets a person sign in with the provider, so what they send from Spaces is posted as them.
 * Tokens belong to the provider's CONNECTION, so every use case on it can use them.
 */
export class UserAuthService<TApi extends BaseApi = BaseApi> {
  private readonly tokens = new UserTokenRepository();

  constructor(
    private readonly provider: BaseProvider<unknown, TApi>,
    private readonly config: ConfigService
  ) {}

  async getStatus(userId: string): Promise<UserAuthStatus> {
    const token = await this.tokens.findByUser(userId, this.tokenProvider);
    return { connected: !!token, connectedAt: token?.connectedAt ?? null };
  }

  async buildConnectUrl(session: UserAuthSession, redirectUri: string): Promise<string> {
    const config = await this.config.getConfigByWorkspace(session.workspaceId);
    const state = randomBytes(24).toString('hex');
    await redisService.set(stateKey(state), JSON.stringify(session), STATE_TTL_SECONDS);
    return this.provider.buildUserAuthUrl(config.credentials, state, redirectUri);
  }

  /** Reads a sign-in's session once; null when it expired or was already used. */
  async takeSession(state: string): Promise<UserAuthSession | null> {
    const raw = await redisService.get(stateKey(state));
    if (!raw) return null;
    await redisService.del(stateKey(state));
    return JSON.parse(raw) as UserAuthSession;
  }

  /** Saves the signed-in person's token, refusing one from a provider workspace other than the configured one. */
  async saveUserToken(session: UserAuthSession, code: string, redirectUri: string): Promise<void> {
    const principal = { userId: session.userId, workspaceId: session.workspaceId };
    await runWithContext(principal, async () => {
      const config = await this.config.getConfigByWorkspace(session.workspaceId);
      const token = await this.provider.exchangeUserAuthCode(config.credentials, code, redirectUri);
      if (token.externalWorkspaceId !== config.workspace.externalWorkspaceId) {
        throw new GatewayError(
          'VALIDATION_ERROR',
          `That ${this.provider.displayName} account is in a different ${this.provider.displayName} workspace`
        );
      }
      await this.tokens.save({
        userId: session.userId,
        workspaceId: session.workspaceId,
        provider: this.tokenProvider,
        providerUserId: token.externalUserId,
        encryptedToken: encrypt(token.token),
      });
    });
  }

  async disconnect(userId: string): Promise<void> {
    await this.tokens.deleteByUser(userId, this.tokenProvider);
  }

  async findUserApi(spacesUserId: string): Promise<UserApi<TApi> | null> {
    const token = await this.tokens.findByUser(spacesUserId, this.tokenProvider);
    if (!token?.providerUserId) return null;
    return {
      api: this.provider.createUserApi(decrypt(token.encryptedToken)),
      spacesUserId,
      externalUserId: token.providerUserId,
    };
  }

  /** Runs a call with a person's token; null means the token was rejected and dropped. */
  async callAsUser<T>(
    user: UserApi<TApi>,
    fn: (api: TApi) => Promise<T>
  ): Promise<{ value: T } | null> {
    try {
      return { value: await fn(user.api) };
    } catch (error) {
      if (!(error instanceof GatewayError)) throw error;
      if (error.code === 'PROVIDER_AUTH') {
        await this.tokens.deleteByUser(user.spacesUserId, this.tokenProvider);
        return null;
      }
      throw error;
    }
  }

  private get tokenProvider(): string {
    return this.provider.configSourceType;
  }
}
