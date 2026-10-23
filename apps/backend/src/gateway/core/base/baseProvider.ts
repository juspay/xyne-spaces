import type { z } from 'zod';
import type { BaseApi } from './baseApi';
import type { BaseTransformer } from './baseTransformer';
import type {
  IncomingRequest,
  ProviderId,
  ProviderMessage,
  ProviderRequest,
  ProviderUserToken,
  ProviderWorkspace,
} from '../types';

/** Everything core needs to know about one provider. */
export abstract class BaseProvider<TCredentials = unknown, TApi extends BaseApi = BaseApi> {
  abstract readonly id: ProviderId;
  abstract readonly displayName: string;
  abstract readonly userMetadataKey: string;
  abstract readonly credentialsSchema: z.ZodType<TCredentials>;
  abstract readonly transformer: BaseTransformer<TCredentials>;

  abstract validateCredentials(credentials: TCredentials): Promise<ProviderWorkspace>;

  abstract verifyRequest(request: IncomingRequest, credentials: TCredentials): void;

  abstract parseEvent(body: unknown): ProviderRequest;

  abstract createApi(credentials: TCredentials): TApi;

  /** Loop guard: true for messages the app itself posted. */
  abstract isOwnMessage(message: ProviderMessage, workspace: ProviderWorkspace): boolean;

  abstract buildUserAuthUrl(credentials: TCredentials, state: string, redirectUri: string): string;

  abstract exchangeUserAuthCode(
    credentials: TCredentials,
    code: string,
    redirectUri: string
  ): Promise<ProviderUserToken>;

  abstract createUserApi(token: string): TApi;

  get configSourceType(): string {
    return `${this.id}-connection`;
  }

  configSourceName(externalWorkspaceId: string): string {
    return `${this.configSourceType}-${externalWorkspaceId}`;
  }
}
