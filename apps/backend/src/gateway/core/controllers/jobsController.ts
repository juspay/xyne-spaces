import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../middleware/errorHandler';
import type { GatewayQueue, JobScope } from '../queue/gatewayQueue';
import type { ProviderId } from '../types';

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export class JobsController {
  constructor(
    private readonly jobs: GatewayQueue,
    private readonly provider: ProviderId
  ) {}

  listFailed: RequestHandler = asyncRoute(async (req, res) => {
    res.json(await this.jobs.listFailed(this.scope(req), ListQuerySchema.parse(req.query)));
  });

  retry: RequestHandler = asyncRoute(async (req, res) => {
    await this.jobs.retryFailed(this.scope(req), req.params.handler!, req.params.id!);
    res.status(204).send();
  });

  remove: RequestHandler = asyncRoute(async (req, res) => {
    await this.jobs.removeFailed(this.scope(req), req.params.handler!, req.params.id!);
    res.status(204).send();
  });

  private scope(req: Request): JobScope {
    return { workspaceId: req.user!.workspaceId!, provider: this.provider };
  }
}
