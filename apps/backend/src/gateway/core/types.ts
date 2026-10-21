import type { BaseProvider } from './base/baseProvider';
import type { ConfigService } from './services/configService';
import type { IdentityService } from './services/identityService';
import type { InboundService } from '../useCases/mirror/services/inboundService';
import type { LinkService } from '../useCases/mirror/services/linkService';
import type { MemberSyncService } from '../useCases/mirror/services/memberSyncService';
import type { OutboundService } from '../useCases/mirror/services/outboundService';
import type { UserAuthService } from './services/userAuthService';

export type ProviderId = 'slack';
export type PairStatus = 'ACTIVE' | 'PAUSED';

/** One external resource ⇄ one Spaces resource: a PAIR row in ExternalSource, read through PairRepository. */
export interface Pair {
  id: string;
  workspaceId: string;
  provider: ProviderId;
  /** The provider workspace's CONNECTION row. */
  connectionId: string;
  /** The provider's resource, e.g. a Slack channel. */
  externalId: string;
  /** The Spaces resource, e.g. a channel. */
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
}

/** The ExternalSource row that scopes a link's message map. */
export interface MessageSource {
  name: string;
  sourceType: string;
  displayName: string;
  credentials: Record<string, string>;
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
  /** Parent message id, set only on replies. */
  threadId?: string;
  authorId?: string;
  botId?: string;
  appId?: string;
  authorName?: string;
  text: string;
  /** Provider-native rich content, rendered by the transformer. */
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
  /** Shown instead of the bot's own; ignored when posting with a person's own token. */
  senderName?: string;
  senderAvatarUrl?: string;
}

export interface OutboundFile {
  name: string;
  mimeType: string;
  content: Buffer;
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

/** Everything wired for one provider; built once in index.ts. */
export interface ProviderServices {
  provider: BaseProvider;
  config: ConfigService;
  identity: IdentityService;
  userAuth: UserAuthService;
  links: LinkService;
  members: MemberSyncService;
  inbound: InboundService;
  outbound: OutboundService;
}
