import type { RequestHandler } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../../../core/middleware/errorHandler';
import type { LinkService } from '../services/linkService';

const ChannelQuerySchema = z.object({ channelId: z.string().trim().min(1) });
const LinkChannelBodySchema = z.object({
  spacesChannelId: z.string().trim().min(1),
  externalChannelId: z.string().trim().min(1),
});
const LinkParamsSchema = z.object({ id: z.string().trim().min(1) });

export class LinkController {
  constructor(private readonly linkService: LinkService) {}

  getLink: RequestHandler = asyncRoute(async (req, res) => {
    const { channelId } = ChannelQuerySchema.parse(req.query);
    const view = await this.linkService.findChannelLink(channelId);
    res.json(view ?? { link: null, externalChannel: null });
  });

  listLinkableChannels: RequestHandler = asyncRoute(async (req, res) => {
    ChannelQuerySchema.parse(req.query);
    const channels = await this.linkService.listLinkableChannels(
      req.user!.workspaceId!,
      req.user!.id
    );
    res.json({ channels });
  });

  linkChannel: RequestHandler = asyncRoute(async (req, res) => {
    const body = LinkChannelBodySchema.parse(req.body);
    const link = await this.linkService.linkChannel(req.user!.workspaceId!, req.user!.id, body);
    res.status(201).json({ link });
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
