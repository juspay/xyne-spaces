import express, { Router } from 'express';
import type { RawBodyRequest } from './re-exports';
import type { BaseProvider } from './core/base/baseProvider';
import { SpacesHooks } from './core/hooks/spacesHooks';
import { gatewayErrorHandler } from './core/middleware/errorHandler';
import { ConfigService } from './core/services/configService';
import { IdentityService } from './core/services/identityService';
import { UserAuthService } from './core/services/userAuthService';
import type { ProviderServices } from './core/types';
import { SlackProvider } from './providers/slack/slackProvider';
import { slackRoutes } from './providers/slack/slackRoutes';
import { createMirror } from './useCases/mirror';

// The gateway's entry point: wires each provider and Mirror on it. Only gatewayRouter and gatewayHooks leave the module.

function createServices(provider: BaseProvider): ProviderServices {
  const config = new ConfigService(provider);
  return {
    provider,
    config,
    identity: new IdentityService(provider),
    userAuth: new UserAuthService(provider, config),
  };
}

const slack = createServices(new SlackProvider());
const slackMirror = createMirror(slack);

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
gatewayRouter.use('/slack', slackRoutes(slack, [slackMirror.handler]));
gatewayRouter.use('/slack', slackMirror.router);
gatewayRouter.use(gatewayErrorHandler); // last: one error shape for every provider

export const gatewayHooks = new SpacesHooks([slackMirror.handler]);
