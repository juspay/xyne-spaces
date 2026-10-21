import type { Router } from 'express';
import type { GatewayHandler, ProviderServices } from '../../core/types';
import { MirrorHandler } from './mirrorHandler';
import { mirrorRoutes } from './mirrorRoutes';
import { InboundService } from './services/inboundService';
import { LinkRequestService } from './services/linkRequestService';
import { LinkService } from './services/linkService';
import { MemberSyncService } from './services/memberSyncService';
import { OutboundService } from './services/outboundService';
import type { MirrorServices } from './types';

/** Builds Mirror on one provider: the handler core calls, and the routes mounted under the provider's path. */
export function createMirror(core: ProviderServices): { handler: GatewayHandler; router: Router } {
  const { provider, config, identity, userAuth } = core;
  const members = new MemberSyncService(provider, identity);
  const links = new LinkService(provider, config, identity, members);
  const services: MirrorServices = {
    links,
    linkRequests: new LinkRequestService(provider, config, links),
    members,
    inbound: new InboundService(provider, identity),
    outbound: new OutboundService(provider, identity, userAuth),
  };
  return { handler: new MirrorHandler(core, services), router: mirrorRoutes(services) };
}
