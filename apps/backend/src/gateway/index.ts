import express, { Router } from 'express';
import type { RawBodyRequest } from './re-exports';
import type { BaseApi } from './core/base/baseApi';
import type { BaseProvider } from './core/base/baseProvider';
import { SpacesHooks } from './core/hooks/spacesHooks';
import { gatewayErrorHandler } from './core/middleware/errorHandler';
import { GatewayQueue } from './core/queue/gatewayQueue';
import { providerRoutes } from './core/routes/providerRoutes';
import { ConfigService } from './core/services/configService';
import { IdentityService } from './core/services/identityService';
import { UserAuthService } from './core/services/userAuthService';
import type { GatewayHandler, ProviderServices } from './core/types';
import { SlackProvider } from './providers/slack/slackProvider';
import { createMirror } from './useCases/mirror';
import type { MirrorApi } from './useCases/mirror/types';

// The gateway's entry point: wires each provider and Mirror on it. Only gatewayRouter, gatewayHooks and gatewayJobs leave the module.

const providers: BaseProvider<unknown, MirrorApi>[] = [new SlackProvider()];

const jobs = new GatewayQueue();

function createServices<TApi extends BaseApi>(
  provider: BaseProvider<unknown, TApi>
): ProviderServices<TApi> {
  const config = new ConfigService(provider);
  return {
    provider,
    config,
    identity: new IdentityService(provider),
    userAuth: new UserAuthService(provider, config),
    jobs,
  };
}

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

const handlers: GatewayHandler[] = [];
for (const provider of providers) {
  const services = createServices(provider);
  const mirror = createMirror(services);
  handlers.push(mirror.handler);
  gatewayRouter.use(`/${provider.id}`, providerRoutes(services, [mirror.handler]), mirror.router);
}
gatewayRouter.use(gatewayErrorHandler); // last: one error shape for every provider
jobs.register(handlers);

export const gatewayHooks = new SpacesHooks(handlers);

export const gatewayJobs = {
  startProcessing: (handlers: string[]): void => jobs.startProcessing(handlers),
  close: (): Promise<void> => jobs.close(),
};
