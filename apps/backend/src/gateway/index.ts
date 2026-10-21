import express, { Router } from 'express';
import type { RawBodyRequest } from './re-exports';
import type { BaseProvider } from './core/base/baseProvider';
import { SpacesHooks } from './core/hooks/spacesHooks';
import { gatewayErrorHandler } from './core/middleware/errorHandler';
import { ConfigService } from './core/services/configService';
import { IdentityService } from './core/services/identityService';
import { InboundService } from './useCases/mirror/services/inboundService';
import { LinkService } from './useCases/mirror/services/linkService';
import { MemberSyncService } from './useCases/mirror/services/memberSyncService';
import { OutboundService } from './useCases/mirror/services/outboundService';
import { UserAuthService } from './core/services/userAuthService';
import type { ProviderServices } from './core/types';
import { SlackProvider } from './providers/slack/slackProvider';
import { slackRoutes } from './providers/slack/slackRoutes';

// The gateway's entry point: wires each provider's services. Only gatewayRouter and gatewayHooks leave the module.

function createServices(provider: BaseProvider): ProviderServices {
  const config = new ConfigService(provider);
  const identity = new IdentityService(provider);
  const userAuth = new UserAuthService(provider, config);
  const members = new MemberSyncService(provider, identity);
  return {
    provider,
    config,
    identity,
    userAuth,
    members,
    links: new LinkService(provider, config, identity, members),
    inbound: new InboundService(provider, identity),
    outbound: new OutboundService(provider, identity, userAuth),
  };
}

const slack = createServices(new SlackProvider());
const servicesByProvider = new Map<string, ProviderServices>([[slack.provider.id, slack]]);

export const gatewayRouter = Router();
gatewayRouter.use(
  express.json({
    limit: '1mb',
    // Provider signatures are computed over the exact bytes received.
    verify: (req: RawBodyRequest, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);
gatewayRouter.use('/slack', slackRoutes(slack));
gatewayRouter.use(gatewayErrorHandler); // last: one error shape for every provider

export const gatewayHooks = new SpacesHooks((provider) => servicesByProvider.get(provider));
