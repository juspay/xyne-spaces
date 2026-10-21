import type { z } from 'zod';
import type { BaseApi } from './baseApi';
import type { BaseTransformer } from './baseTransformer';
import type {
  IncomingRequest,
  MessageSource,
  ProviderId,
  ProviderMessage,
  ProviderRequest,
  ProviderUserToken,
  ProviderWorkspace,
} from '../types';

/** Everything core needs to know about one provider. */
export abstract class BaseProvider<TCredentials = unknown> {
  abstract readonly id: ProviderId;
  abstract readonly displayName: string;
  abstract readonly userMetadataKey: string;
  abstract readonly credentialsSchema: z.ZodType<TCredentials>;
  abstract readonly transformer: BaseTransformer<TCredentials>;

  abstract validateCredentials(credentials: TCredentials): Promise<ProviderWorkspace>;

  abstract verifyRequest(request: IncomingRequest, credentials: TCredentials): void;

  abstract parseEvent(body: unknown): ProviderRequest;

  abstract createApi(credentials: TCredentials): BaseApi;

  /** Loop guard: true for messages the app itself posted. */
  abstract isOwnMessage(message: ProviderMessage, workspace: ProviderWorkspace): boolean;

  abstract buildMessageSource(
    externalChannelId: string,
    spacesChannelId: string,
    credentials: TCredentials
  ): MessageSource;

  /** Name of the desk source that already owns this channel, if desks can use the provider. */
  abstract deskSourceName(externalChannelId: string): string | null;

  abstract buildUserAuthUrl(credentials: TCredentials, state: string, redirectUri: string): string;

  abstract exchangeUserAuthCode(
    credentials: TCredentials,
    code: string,
    redirectUri: string
  ): Promise<ProviderUserToken>;

  abstract createUserApi(token: string): BaseApi;

  /** Names older migrations gave this pair's history; Mirror reads them so no thread is copied twice. */
  legacyMessageSourceNames(_externalChannelId: string, _spacesChannelId: string): string[] {
    return [];
  }

  get configSourceType(): string {
    return `${this.id}-connection`;
  }

  configSourceName(externalWorkspaceId: string): string {
    return `${this.configSourceType}-${externalWorkspaceId}`;
  }
}
