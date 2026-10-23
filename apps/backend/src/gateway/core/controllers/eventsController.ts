import type { RequestHandler } from 'express';
import { logger, type RawBodyRequest } from '../../re-exports';
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

    const { event } = request;
    if (event) {
      const connection = configService.toConnection(config);
      const results = await Promise.allSettled(
        this.handlers.map((handler) => handler.onProviderEvent(connection, event))
      );
      const [firstError, ...otherErrors] = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason as unknown] : []
      );
      for (const error of otherErrors) logger.error('[Gateway] Event handler failed', { error });
      if (firstError) throw firstError;
    }
    res.status(200).json({ ok: true });
  });
}
