import type { RequestHandler } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../../../core/middleware/errorHandler';
import { isOrgAdmin } from '../middleware/channelGuards';
import type { LinkRequestService } from '../services/linkRequestService';
import type { LinkService } from '../services/linkService';

const ChannelQuerySchema = z.object({ channelId: z.string().trim().min(1) });
const LinkParamsSchema = z.object({ id: z.string().trim().min(1) });

/** A channel's sync card. Links are made by approving a request, so there is no endpoint to create one. */
export class LinkController {
  constructor(
    private readonly linkService: LinkService,
    private readonly linkRequestService: LinkRequestService
  ) {}

  getChannelStatus: RequestHandler = asyncRoute(async (req, res) => {
    const { channelId } = ChannelQuerySchema.parse(req.query);
    res.json(
      await this.linkRequestService.getChannelStatus(
        req.user!.workspaceId!,
        req.user!.id,
        channelId,
        isOrgAdmin(req.user!)
      )
    );
  });

  listSyncedChannels: RequestHandler = asyncRoute(async (req, res) => {
    const channelIds = await this.linkService.listSyncedChannelIds(
      req.user!.workspaceId!,
      req.user!.id
    );
    res.json({ channelIds });
  });

  listLinkableChannels: RequestHandler = asyncRoute(async (req, res) => {
    ChannelQuerySchema.parse(req.query);
    const channels = await this.linkService.listLinkableChannels(
      req.user!.workspaceId!,
      req.user!.id
    );
    res.json({ channels });
  });

  pauseLink: RequestHandler = asyncRoute(async (req, res) => {
    const { id } = LinkParamsSchema.parse(req.params);
    const link = await this.linkService.pauseLink(req.user!.workspaceId!, id);
    res.json({ link });
  });

  resumeLink: RequestHandler = asyncRoute(async (req, res) => {
    const { id } = LinkParamsSchema.parse(req.params);
    const link = await this.linkService.resumeLink(req.user!.workspaceId!, id);
    res.json({ link });
  });

  unlinkChannel: RequestHandler = asyncRoute(async (req, res) => {
    const { id } = LinkParamsSchema.parse(req.params);
    await this.linkService.unlinkChannel(req.user!.workspaceId!, id);
    res.status(204).send();
  });
}
