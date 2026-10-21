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
  /** User metadata key holding the provider user id, e.g. `slackId`. */
  abstract readonly userMetadataKey: string;
  abstract readonly credentialsSchema: z.ZodType<TCredentials>;
  abstract readonly transformer: BaseTransformer<TCredentials>;

  /** Checks the credentials against the provider and returns the workspace they belong to. */
  abstract validateCredentials(credentials: TCredentials): Promise<ProviderWorkspace>;

  /** Throws INVALID_SIGNATURE unless the request really came from the provider. */
  abstract verifyRequest(request: IncomingRequest, credentials: TCredentials): void;

  abstract parseEvent(body: unknown): ProviderRequest;

  abstract createApi(credentials: TCredentials): BaseApi;

  /** Loop guard: true for messages Mirror itself posted. */
  abstract isOwnMessage(message: ProviderMessage, workspace: ProviderWorkspace): boolean;

  abstract buildMessageSource(
    externalChannelId: string,
    spacesChannelId: string,
    credentials: TCredentials
  ): MessageSource;

  /** Name of the desk source that already owns this channel, if desks can use the provider. */
  abstract deskSourceName(externalChannelId: string): string | null;

  /** True when the config can sign people in, so their messages are posted as them. */
  abstract canAuthorizeUsers(credentials: TCredentials): boolean;

  /** The provider's sign-in page for a person's own token. */
  abstract buildUserAuthUrl(credentials: TCredentials, state: string, redirectUri: string): string;

  /** Trades the sign-in code for that person's token. */
  abstract exchangeUserAuthCode(
    credentials: TCredentials,
    code: string,
    redirectUri: string
  ): Promise<ProviderUserToken>;

  /** An API acting as the person who owns the token. */
  abstract createUserApi(token: string): BaseApi;

  /** Names older migrations gave this pair's history; Mirror reads them so no thread is copied twice. */
  legacyMessageSourceNames(_externalChannelId: string, _spacesChannelId: string): string[] {
    return [];
  }

  /** The CONNECTION row's sourceType, e.g. `slack-connection`: one per provider, shared by every use case. */
  get configSourceType(): string {
    return `${this.id}-connection`;
  }

  configSourceName(externalWorkspaceId: string): string {
    return `${this.configSourceType}-${externalWorkspaceId}`;
  }
}
