import type { RequestHandler } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../../../core/middleware/errorHandler';
import type { LinkRequestService } from '../services/linkRequestService';

const SubmitBodySchema = z.object({
  spacesChannelId: z.string().trim().min(1),
  externalChannelId: z.string().trim().min(1),
});
const RequestParamsSchema = z.object({ id: z.string().trim().min(1) });
const RejectBodySchema = z.object({ reason: z.string().trim().min(1).max(500) });
const ListQuerySchema = z.object({
  // Comma-separated, e.g. `PENDING,REJECTED`.
  status: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',') : []))
    .pipe(z.array(z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']))),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  requestedBy: z.string().trim().min(1).optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Channel admins submit and cancel requests; organisation admins list, approve and reject them. */
export class LinkRequestController {
  constructor(private readonly linkRequestService: LinkRequestService) {}

  submitRequest: RequestHandler = asyncRoute(async (req, res) => {
    const body = SubmitBodySchema.parse(req.body);
    const request = await this.linkRequestService.submit(
      req.user!.workspaceId!,
      req.user!.id,
      body
    );
    res.status(201).json({ request });
  });

  cancelRequest: RequestHandler = asyncRoute(async (req, res) => {
    const { id } = RequestParamsSchema.parse(req.params);
    const request = await this.linkRequestService.cancel(req.user!.workspaceId!, req.user!.id, id);
    res.json({ request });
  });

  listRequests: RequestHandler = asyncRoute(async (req, res) => {
    const query = ListQuerySchema.parse(req.query);
    res.json(
      await this.linkRequestService.list(req.user!.workspaceId!, {
        statuses: query.status,
        from: query.from?.getTime(),
        to: query.to?.getTime(),
        requestedBy: query.requestedBy,
        search: query.search,
        limit: query.limit,
        offset: query.offset,
      })
    );
  });

  approveRequest: RequestHandler = asyncRoute(async (req, res) => {
    const { id } = RequestParamsSchema.parse(req.params);
    const request = await this.linkRequestService.approve(req.user!.workspaceId!, req.user!.id, id);
    res.json({ request });
  });

  rejectRequest: RequestHandler = asyncRoute(async (req, res) => {
    const { id } = RequestParamsSchema.parse(req.params);
    const { reason } = RejectBodySchema.parse(req.body);
    const request = await this.linkRequestService.reject(
      req.user!.workspaceId!,
      req.user!.id,
      id,
      reason
    );
    res.json({ request });
  });
}
