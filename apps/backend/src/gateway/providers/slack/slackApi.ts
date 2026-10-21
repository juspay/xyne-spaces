import { ErrorCode, WebClient } from '@slack/web-api';
import type { WebAPICallError } from '@slack/web-api';
import { gatewayConfig } from '../../config';
import { BaseApi } from '../../core/base/baseApi';
import { GatewayError } from '../../core/errors';
import type {
  OutboundFile,
  OutboundMessage,
  PostedMessageMatch,
  ProviderChannel,
  ProviderMessage,
  ProviderUser,
  ProviderUserToken,
  ProviderWorkspace,
} from '../../core/types';
import { toProviderMessage } from './slackUtils';
import { SlackMessageSchema } from './types';

const AUTH_ERRORS = new Set([
  'invalid_auth',
  'not_authed',
  'token_revoked',
  'token_expired',
  'account_inactive',
]);
const CHANNEL_GONE_ERRORS = new Set(['channel_not_found', 'is_archived', 'not_in_channel']);
const NOT_AUTHOR_ERRORS = new Set(['cant_update_message', 'cant_delete_message']);
const NOT_PERMITTED_ERRORS = new Set(['missing_scope', 'not_allowed_token_type']);

const CHANNEL_TYPES = 'public_channel,private_channel';
const PAGE_SIZE = 200;
const MAX_PAGES = 10;
const INVITE_BATCH = 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const HISTORY_LIMIT = 15;

/** Same synthetic email self-serve migration gives a Slack user without one, so both map to one Spaces user. */
const fallbackEmail = (slackUserId: string): string => `${slackUserId}@cross-platform.in`;

export class SlackApi extends BaseApi {
  private readonly client: WebClient;

  /** `asUser`: a person's own token, so Slack shows their name and photo and nothing is overridden. */
  constructor(
    token?: string,
    private readonly options: { asUser?: boolean } = {}
  ) {
    super();
    // No SDK retries: BaseApi.call() retries rate limits, and a timed-out post may already be in Slack.
    this.client = new WebClient(token, {
      rejectRateLimitedCalls: true,
      retryConfig: { retries: 0 },
      timeout: REQUEST_TIMEOUT_MS,
    });
  }

  /** `auth.test` has no app id, so it comes from the bot's own record (`bots.info`, `users:read`). */
  async verifyBotToken(): Promise<ProviderWorkspace> {
    const result = await this.call(() => this.client.auth.test());
    const { team_id: teamId, user_id: botUserId, bot_id: botId } = result;
    if (!teamId || !botUserId || !botId) {
      throw new GatewayError('VALIDATION_ERROR', 'The token is not a Slack bot token');
    }
    const { bot } = await this.call(() => this.client.bots.info({ bot: botId }));
    if (!bot?.app_id) {
      throw new GatewayError('VALIDATION_ERROR', 'Slack returned no app for this bot token');
    }
    return {
      externalWorkspaceId: teamId,
      name: result.team ?? teamId,
      botUserId,
      appId: bot.app_id,
    };
  }

  async postMessage(message: OutboundMessage): Promise<string> {
    const result = await this.call(() =>
      this.client.chat.postMessage({
        channel: message.channelId,
        thread_ts: message.threadId,
        text: message.text,
        ...(!this.options.asUser && {
          username: message.senderName,
          icon_url: message.senderAvatarUrl,
          metadata: {
            event_type: 'xyne_mirror',
            event_payload: {
              origin: 'xyne',
              ...(message.originId && { spaces_message_id: message.originId }),
            },
          },
        }),
      })
    );
    if (!result.ts) throw new GatewayError('PROVIDER_ERROR', 'Slack returned no message ts');
    return result.ts;
  }

  /** Trades a sign-in code for the person's own token; this call needs no token on the client. */
  async exchangeUserCode(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string
  ): Promise<ProviderUserToken> {
    const result = await this.call(() =>
      this.client.oauth.v2.access({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      })
    );
    const user = result.authed_user;
    if (!user?.id || !user.access_token || !result.team?.id) {
      throw new GatewayError('VALIDATION_ERROR', 'Slack returned no user token');
    }
    return {
      externalUserId: user.id,
      externalWorkspaceId: result.team.id,
      token: user.access_token,
    };
  }

  async updateMessage(channelId: string, messageId: string, text: string): Promise<void> {
    await this.call(() => this.client.chat.update({ channel: channelId, ts: messageId, text }));
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    await this.callIgnoring(
      () => this.client.chat.delete({ channel: channelId, ts: messageId }),
      ['message_not_found']
    );
  }

  async uploadFile(file: OutboundFile): Promise<string> {
    const { upload_url: uploadUrl, file_id: fileId } = await this.call(() =>
      this.client.files.getUploadURLExternal({ filename: file.name, length: file.content.length })
    );
    if (!uploadUrl || !fileId) {
      throw new GatewayError('PROVIDER_ERROR', 'Slack returned no upload URL');
    }
    await this.call(async () => {
      const response = await fetch(uploadUrl, {
        method: 'POST',
        body: file.content,
        signal: AbortSignal.timeout(gatewayConfig.fileTimeoutMs),
      });
      if (!response.ok) {
        throw new GatewayError('PROVIDER_ERROR', `Slack file upload returned ${response.status}`);
      }
    });
    return fileId;
  }

  async shareFiles(message: OutboundMessage, fileIds: string[]): Promise<void> {
    const [first, ...rest] = fileIds.map((id) => ({ id }));
    if (!first) return;
    const destination = message.threadId
      ? { channel_id: message.channelId, thread_ts: message.threadId }
      : { channel_id: message.channelId };
    await this.call(() =>
      this.client.files.completeUploadExternal({
        ...destination,
        files: [first, ...rest],
        ...(message.text && { initial_comment: message.text }),
      })
    );
  }

  async findFileMessage(channelId: string, fileId: string): Promise<string | null> {
    const result = await this.callIgnoring(
      () => this.client.files.info({ file: fileId }),
      ['file_not_found', 'file_deleted']
    );
    const shares = result?.file?.shares;
    return shares?.public?.[channelId]?.[0]?.ts ?? shares?.private?.[channelId]?.[0]?.ts ?? null;
  }

  async findPostedMessage(
    channelId: string,
    threadId: string | undefined,
    since: Date,
    match: PostedMessageMatch
  ): Promise<string | null> {
    const window = {
      channel: channelId,
      oldest: (since.getTime() / 1000).toFixed(6),
      limit: HISTORY_LIMIT,
      include_all_metadata: true,
    };
    const { messages } = threadId
      ? await this.call(() => this.client.conversations.replies({ ...window, ts: threadId }))
      : await this.call(() => this.client.conversations.history(window));
    const found = messages?.find(
      (message) =>
        (message.metadata?.event_payload as Record<string, unknown> | undefined)
          ?.spaces_message_id === match.originId ||
        (!!match.authorId && message.user === match.authorId && message.text === match.text)
    );
    return found?.ts ?? null;
  }

  async findThreadParent(channelId: string, threadId: string): Promise<ProviderMessage | null> {
    const result = await this.callIgnoring(
      () =>
        this.client.conversations.replies({
          channel: channelId,
          ts: threadId,
          limit: 1,
          inclusive: true,
        }),
      ['thread_not_found']
    );
    const parent = SlackMessageSchema.safeParse(result?.messages?.[0]);
    return parent.success && parent.data.ts === threadId
      ? toProviderMessage(parent.data, channelId)
      : null;
  }

  async getChannel(channelId: string): Promise<ProviderChannel> {
    const { channel } = await this.call(() =>
      this.client.conversations.info({ channel: channelId })
    );
    return { id: channelId, name: channel?.name ?? channelId, isPrivate: !!channel?.is_private };
  }

  async listSharedChannels(userId: string): Promise<ProviderChannel[]> {
    const [userChannels, botChannels] = await Promise.all([
      this.listChannels(userId),
      this.listChannels(),
    ]);
    const botChannelIds = new Set(botChannels.map((channel) => channel.id));
    return userChannels.filter((channel) => botChannelIds.has(channel.id));
  }

  async listMembers(channelId: string): Promise<string[]> {
    const members: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await this.call(() =>
        this.client.conversations.members({ channel: channelId, limit: PAGE_SIZE, cursor })
      );
      members.push(...(result.members ?? []));
      cursor = result.response_metadata?.next_cursor || undefined;
      if (!cursor) break;
    }
    return members;
  }

  async inviteMembers(channelId: string, userIds: string[]): Promise<void> {
    for (let i = 0; i < userIds.length; i += INVITE_BATCH) {
      const users = userIds.slice(i, i + INVITE_BATCH).join(',');
      await this.callIgnoring(
        () => this.client.conversations.invite({ channel: channelId, users, force: true }),
        ['already_in_channel', 'cant_invite_self']
      );
    }
  }

  async removeMember(channelId: string, userId: string): Promise<void> {
    await this.callIgnoring(
      () => this.client.conversations.kick({ channel: channelId, user: userId }),
      ['not_in_channel', 'cant_kick_self']
    );
  }

  async findUser(userId: string): Promise<ProviderUser | null> {
    const result = await this.callIgnoring(
      () => this.client.users.info({ user: userId }),
      ['user_not_found']
    );
    const user = result?.user;
    if (!user) return null;
    return {
      id: userId,
      name: user.profile?.real_name || user.profile?.display_name || user.name || userId,
      email: user.profile?.email ?? fallbackEmail(userId),
      isBot: !!user.is_bot || userId === 'USLACKBOT',
      botId: user.profile?.bot_id,
      avatarUrl: user.profile?.image_192,
      deleted: !!user.deleted,
    };
  }

  async findUserIdByEmail(email: string): Promise<string | null> {
    const result = await this.callIgnoring(
      () => this.client.users.lookupByEmail({ email }),
      ['users_not_found']
    );
    return result?.user?.id ?? null;
  }

  protected toGatewayError(error: unknown): GatewayError {
    if (!(error instanceof Error)) return new GatewayError('PROVIDER_ERROR', String(error));
    const slack = error as WebAPICallError;
    if (slack.code === ErrorCode.RateLimitedError) {
      return new GatewayError('RATE_LIMITED', 'Slack rate limit', {
        retryAfterMs: slack.retryAfter * 1_000,
      });
    }
    const providerCode = slack.code === ErrorCode.PlatformError ? slack.data.error : undefined;
    if (providerCode && AUTH_ERRORS.has(providerCode)) {
      return new GatewayError('PROVIDER_AUTH', providerCode, { providerCode });
    }
    if (providerCode && CHANNEL_GONE_ERRORS.has(providerCode)) {
      return new GatewayError('CHANNEL_GONE', providerCode, { providerCode });
    }
    if (providerCode && NOT_AUTHOR_ERRORS.has(providerCode)) {
      return new GatewayError('NOT_MESSAGE_AUTHOR', providerCode, { providerCode });
    }
    if (providerCode && NOT_PERMITTED_ERRORS.has(providerCode)) {
      return new GatewayError('NOT_PERMITTED', providerCode, { providerCode });
    }
    return new GatewayError('PROVIDER_ERROR', providerCode ?? error.message, { providerCode });
  }

  private async listChannels(userId?: string): Promise<ProviderChannel[]> {
    const channels: ProviderChannel[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await this.call(() =>
        this.client.users.conversations({
          user: userId,
          types: CHANNEL_TYPES,
          exclude_archived: true,
          limit: PAGE_SIZE,
          cursor,
        })
      );
      for (const channel of result.channels ?? []) {
        if (channel.id)
          channels.push({
            id: channel.id,
            name: channel.name ?? channel.id,
            isPrivate: !!channel.is_private,
          });
      }
      cursor = result.response_metadata?.next_cursor || undefined;
      if (!cursor) break;
    }
    return channels;
  }
}
