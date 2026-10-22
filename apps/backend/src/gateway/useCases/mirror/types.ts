import type {
  BaseApi,
  ChannelApi,
  DirectoryApi,
  FileApi,
  MessagingApi,
} from '../../core/base/baseApi';
import type {
  Pair,
  ProviderChannel,
  ProviderId,
  ProviderConnection,
  SpacesMessageChange,
} from '../../core/types';
import type { InboundService, MessageEvent } from './services/inboundService';
import type { LinkRequestService } from './services/linkRequestService';
import type { LinkService } from './services/linkService';
import type { MemberSyncService } from './services/memberSyncService';
import type { OutboundService } from './services/outboundService';

/** Mirror's services for one provider; built by `createMirror`. */
export interface MirrorServices {
  links: LinkService;
  linkRequests: LinkRequestService;
  members: MemberSyncService;
  inbound: InboundService;
  outbound: OutboundService;
}

/** Mirror's links are PAIR rows with sourceType `<provider id><suffix>`, e.g. `slack-mirror`. */
export const MIRROR_SOURCE_SUFFIX = '-mirror';

export const mirrorSourceType = (provider: ProviderId): string =>
  `${provider}${MIRROR_SOURCE_SUFFIX}`;

export const MIRROR_ORIGIN_TYPE = 'xyne_mirror';

export type MirrorApi = BaseApi & MessagingApi & FileApi & ChannelApi & DirectoryApi;

export type MirrorConnection = ProviderConnection<MirrorApi>;

/** A Mirror link: one provider channel (`externalId`) ⇄ one Spaces channel (`spacesId`). */
export type MirrorLink = Pair;

/** The ExternalSource row that scopes a link's message map. */
export interface MessageSource {
  name: string;
  sourceType: string;
  displayName: string;
}

export type MirrorJobType = 'outbound' | 'inbound';

export interface OutboundJobPayload {
  linkId: string;
  change: SpacesMessageChange;
}

export interface InboundJobPayload {
  linkId: string;
  event: MessageEvent;
}

export const outboundJobId = (messageId: string): string => `out:${messageId}`;

export const inboundJobId = (linkId: string, externalId: string): string =>
  `in:${linkId}:${externalId}`;

export type SyncRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** A channel admin's request to sync a Spaces channel with a provider channel; approving it creates the link. */
export interface SyncRequest {
  id: string;
  workspaceId: string;
  connectionId: string;
  externalId: string;
  externalName: string;
  spacesId: string;
  requestedBy: string;
  requestedAt: Date;
  status: SyncRequestStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  reason: string | null;
}

/** What a Spaces channel's sync card shows. */
export interface ChannelSyncStatus {
  connected: boolean;
  appName: string | null;
  link: MirrorLink | null;
  externalChannel: ProviderChannel | null;
  request: SyncRequest | null;
  canRequest: boolean;
  canManage: boolean;
}

/** A request as the admin's list shows it. */
export interface SyncRequestView extends SyncRequest {
  spacesChannelName: string | null;
  requesterName: string | null;
  deciderName: string | null;
}
