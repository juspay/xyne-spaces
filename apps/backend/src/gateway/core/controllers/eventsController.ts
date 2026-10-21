import type { RequestHandler } from 'express';
import type { RawBodyRequest } from '../../re-exports';
import { GatewayError } from '../errors';
import { asyncRoute } from '../middleware/errorHandler';
import type { GatewayHandler, ProviderServices } from '../types';

/** Provider webhooks: parse → find config → verify → hand to each handler → respond. */
export class EventsController {
  constructor(
    private readonly services: ProviderServices,
    private readonly handlers: GatewayHandler[]
  ) {}

  handleEvent: RequestHandler = asyncRoute(async (req, res) => {
    const { provider, config: configService } = this.services;
    const request = provider.parseEvent(req.body);
    if (request.kind === 'challenge') {
      res.json(request.response);
      return;
    }

    // No tenant is known until the config row is found, so this lookup runs unscoped, like desk's.
    const config = await configService.findConfigByExternalWorkspace(request.externalWorkspaceId);
    if (!config)
      throw new GatewayError('NOT_CONFIGURED', `${provider.displayName} workspace is not set up`);
    provider.verifyRequest(
      { rawBody: (req as RawBodyRequest).rawBody ?? '', headers: req.headers },
      config.credentials
    );

    if (request.event) {
      for (const handler of this.handlers) await handler.onProviderEvent(config, request.event);
    }
    res.status(200).json({ ok: true });
  });
}
