import {
  buildSlackChannelSourceName,
  buildSlackDeskSourceName,
  buildSlackMigrationSourceName,
} from '../../re-exports';
import { BaseProvider } from '../../core/base/baseProvider';
import { GatewayError } from '../../core/errors';
import type {
  IncomingRequest,
  MessageSource,
  ProviderMessage,
  ProviderRequest,
  ProviderUserToken,
  ProviderWorkspace,
} from '../../core/types';
import { SlackApi } from './slackApi';
import { SlackTransformer } from './slackTransformer';
import { buildSlackUserAuthUrl, parseSlackEvent, verifySlackSignature } from './slackUtils';
import { SlackCredentialsSchema, type SlackCredentials } from './types';

export class SlackProvider extends BaseProvider<SlackCredentials> {
  readonly id = 'slack' as const;
  readonly displayName = 'Slack';
  readonly userMetadataKey = 'slackId';
  readonly credentialsSchema = SlackCredentialsSchema;
  readonly transformer = new SlackTransformer();

  async validateCredentials(credentials: SlackCredentials): Promise<ProviderWorkspace> {
    try {
      return await new SlackApi(credentials.botToken).verifyBotToken();
    } catch (error) {
      if (error instanceof GatewayError && error.code === 'PROVIDER_AUTH') {
        throw new GatewayError('VALIDATION_ERROR', 'Slack rejected the bot token');
      }
      throw error;
    }
  }

  verifyRequest(request: IncomingRequest, credentials: SlackCredentials): void {
    if (!verifySlackSignature(request, credentials.signingSecret)) {
      throw new GatewayError('INVALID_SIGNATURE', 'Invalid Slack signature');
    }
  }

  parseEvent(body: unknown): ProviderRequest {
    return parseSlackEvent(body);
  }

  createApi(credentials: SlackCredentials): SlackApi {
    return new SlackApi(credentials.botToken);
  }

  isOwnMessage(message: ProviderMessage, workspace: ProviderWorkspace): boolean {
    return message.appId === workspace.appId || message.authorId === workspace.botUserId;
  }

  /** The channel's shared Slack source, so a migration and Mirror each skip the other's messages. */
  buildMessageSource(
    _externalChannelId: string,
    spacesChannelId: string,
    credentials: SlackCredentials
  ): MessageSource {
    return {
      name: buildSlackChannelSourceName(spacesChannelId),
      sourceType: 'slack',
      displayName: 'Slack Mirror',
      credentials: { botToken: credentials.botToken },
    };
  }

  deskSourceName(externalChannelId: string): string {
    return buildSlackDeskSourceName(externalChannelId);
  }

  buildUserAuthUrl(credentials: SlackCredentials, state: string, redirectUri: string): string {
    return buildSlackUserAuthUrl(credentials.clientId, state, redirectUri);
  }

  async exchangeUserAuthCode(
    credentials: SlackCredentials,
    code: string,
    redirectUri: string
  ): Promise<ProviderUserToken> {
    return await new SlackApi().exchangeUserCode(
      credentials.clientId,
      credentials.clientSecret,
      code,
      redirectUri
    );
  }

  createUserApi(token: string): SlackApi {
    return new SlackApi(token, { asUser: true });
  }

  /** Channels migrated before self-serve (the `/sync` flow) keep their history under these names. */
  legacyMessageSourceNames(externalChannelId: string, spacesChannelId: string): string[] {
    return [
      buildSlackMigrationSourceName(externalChannelId, spacesChannelId),
      buildSlackMigrationSourceName(externalChannelId),
    ];
  }
}
