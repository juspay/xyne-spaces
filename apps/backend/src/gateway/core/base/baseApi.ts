import { GatewayError } from '../errors';
import type {
  OutboundFile,
  OutboundMessage,
  PostedMessageMatch,
  ProviderChannel,
  ProviderMessage,
  ProviderUser,
} from '../types';

const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_AFTER_MS = 1_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A provider's API, bound to one workspace's credentials. Every call fails as a GatewayError. */
export abstract class BaseApi {
  /** Runs a provider call, mapping any failure. Only RATE_LIMITED is retried: nothing was written. */
  protected async call<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const gatewayError = error instanceof GatewayError ? error : this.toGatewayError(error);
        if (gatewayError.code !== 'RATE_LIMITED' || attempt === MAX_RATE_LIMIT_RETRIES)
          throw gatewayError;
        await sleep(gatewayError.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS);
      }
    }
  }

  /** Like call(), but answers null for the given provider error codes. */
  protected async callIgnoring<T>(
    fn: () => Promise<T>,
    providerCodes: string[]
  ): Promise<T | null> {
    try {
      return await this.call(fn);
    } catch (error) {
      if (
        error instanceof GatewayError &&
        error.providerCode &&
        providerCodes.includes(error.providerCode)
      )
        return null;
      throw error;
    }
  }

  protected abstract toGatewayError(error: unknown): GatewayError;
}

export interface MessagingApi {
  /** Posts a message and returns its provider id. */
  postMessage(message: OutboundMessage): Promise<string>;
  updateMessage(channelId: string, messageId: string, text: string): Promise<void>;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  findPostedMessage(
    channelId: string,
    threadId: string | undefined,
    since: Date,
    match: PostedMessageMatch
  ): Promise<string | null>;
  findThreadParent(channelId: string, threadId: string): Promise<ProviderMessage | null>;
}

export interface FileApi {
  downloadFile(url: string): Promise<Buffer>;
  uploadFile(file: OutboundFile): Promise<string>;
  shareFiles(message: OutboundMessage, fileIds: string[]): Promise<void>;
  findFileMessage(channelId: string, fileId: string): Promise<string | null>;
}

export interface ChannelApi {
  getChannel(channelId: string): Promise<ProviderChannel>;
  /** Channels the user and the bot are both in. */
  listSharedChannels(userId: string): Promise<ProviderChannel[]>;
  listMembers(channelId: string): Promise<string[]>;
  inviteMembers(channelId: string, userIds: string[]): Promise<void>;
  removeMember(channelId: string, userId: string): Promise<void>;
}

export interface DirectoryApi {
  findUser(userId: string): Promise<ProviderUser | null>;
  findUserIdByEmail(email: string): Promise<string | null>;
}
