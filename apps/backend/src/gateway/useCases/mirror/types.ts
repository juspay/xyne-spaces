import type { Pair, ProviderChannel } from '../../core/types';
import type { InboundService } from './services/inboundService';
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

/** A Mirror link: one provider channel (`externalId`) ⇄ one Spaces channel (`spacesId`). */
export type MirrorLink = Pair;

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
