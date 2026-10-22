import type { BaseApi } from './base/baseApi';
import type { BaseProvider } from './base/baseProvider';
import type { GatewayQueue } from './queue/gatewayQueue';
import type { ConfigService } from './services/configService';
import type { IdentityService } from './services/identityService';
import type { UserAuthService } from './services/userAuthService';

export type ProviderId = 'slack';
export type PairStatus = 'ACTIVE' | 'PAUSED';

/** One external resource ⇄ one Spaces resource: a PAIR row in ExternalSource, read through PairRepository. */
export interface Pair {
  id: string;
  workspaceId: string;
  connectionId: string;
  externalId: string;
  spacesId: string;
  status: PairStatus;
  statusReason: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** The provider workspace a bot token belongs to. */
export interface ProviderWorkspace {
  externalWorkspaceId: string;
  name: string;
  botUserId: string;
  appId: string;
}

export interface ProviderConnection<TApi extends BaseApi = BaseApi> {
  sourceId: string;
  workspaceId: string;
  workspace: ProviderWorkspace;
  appName: string | null;
  description: string | null;
  api: TApi;
  toSpaces(message: ProviderMessage): Promise<string>;
}

/** A person's own provider token, from signing in with the provider. */
export interface ProviderUserToken {
  externalUserId: string;
  externalWorkspaceId: string;
  token: string;
}

export interface ProviderConfig<TCredentials = unknown> {
  sourceId: string;
  workspaceId: string;
  workspace: ProviderWorkspace;
  credentials: TCredentials;
  appName: string | null;
  description: string | null;
}

export interface IncomingRequest {
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface ProviderFile {
  name: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface ProviderMessage {
  channelId: string;
  id: string;
  threadId?: string;
  authorId?: string;
  botId?: string;
  appId?: string;
  authorName?: string;
  text: string;
  attachments?: unknown[];
  files: ProviderFile[];
  createdAt: Date;
  replyBroadcast: boolean;
}

export type ProviderEvent =
  | { type: 'message_created'; message: ProviderMessage }
  | { type: 'message_edited'; message: ProviderMessage }
  | { type: 'message_deleted'; channelId: string; messageId: string }
  | { type: 'member_joined'; channelId: string; userId: string }
  | { type: 'member_left'; channelId: string; userId: string };

export type ProviderRequest =
  | { kind: 'challenge'; response: unknown }
  | { kind: 'event'; externalWorkspaceId: string; event: ProviderEvent | null };

export interface ProviderChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}

export interface ProviderUser {
  id: string;
  name: string;
  email: string;
  isBot: boolean;
  botId?: string;
  avatarUrl?: string;
  deleted: boolean;
}

export interface OutboundMessage {
  channelId: string;
  threadId?: string;
  text: string;
  senderName?: string;
  senderAvatarUrl?: string;
  origin?: MessageOrigin;
}

export interface MessageOrigin {
  type: string;
  id: string;
}

export interface MessageUpdate {
  text: string;
  senderName?: string;
  hasFiles?: boolean;
}

export interface OutboundFile {
  id: string;
  name: string;
  mimeType: string;
  content: Buffer;
}

export interface PostedMessageMatch {
  origin: MessageOrigin;
  authorId?: string;
  text: string;
}

/** A Spaces message change, as the messages side-effect handler reports it. */
export interface SpacesMessageChange {
  operation: 'insert' | 'update' | 'delete' | 'upsert';
  messageId: string;
  channelId: string;
  previousContent?: string;
}

export interface SpacesMemberChange {
  type: 'added' | 'removed';
  channelId: string;
  userId: string;
}

/** What every use of the gateway shares for one provider; built once in index.ts. */
export interface ProviderServices<TApi extends BaseApi = BaseApi> {
  provider: BaseProvider<unknown, TApi>;
  config: ConfigService<TApi>;
  identity: IdentityService;
  userAuth: UserAuthService<TApi>;
  jobs: GatewayQueue;
}

export interface GatewayJob {
  handler: string;
  type: string;
  provider: ProviderId;
  workspaceId: string;
  refs: Record<string, string>;
  payload: unknown;
  progress?: Record<string, unknown>;
}

export interface JobContext {
  lastAttempt: boolean;
  getProgress<T>(key: string): T | undefined;
  setProgress(key: string, value: unknown): Promise<void>;
}

/** What core hands verified provider events and Spaces changes to, e.g. Mirror. Core never imports it. */
export interface GatewayHandler {
  readonly name: string;
  onProviderEvent(connection: ProviderConnection, event: ProviderEvent): Promise<void>;
  onSpacesMessageChanged?(change: SpacesMessageChange): Promise<void>;
  onSpacesMemberChanged?(change: SpacesMemberChange): Promise<void>;
  runJob?(job: GatewayJob, context: JobContext): Promise<void>;
  onConnectionRemoved?(connectionId: string): Promise<void>;
}
