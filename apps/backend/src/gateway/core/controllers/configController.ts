import type { RequestHandler } from 'express';
import { asyncRoute } from '../middleware/errorHandler';
import type { ConfigService } from '../services/configService';

/** Workspace admins manage the provider credentials. The body is checked with the provider's own schema. */
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  getConfig: RequestHandler = asyncRoute(async (req, res) => {
    const workspace = await this.configService.getConnectedWorkspace(req.user!.workspaceId!);
    res.json({ workspace });
  });

  saveConfig: RequestHandler = asyncRoute(async (req, res) => {
    const workspace = await this.configService.saveConfig(
      req.user!.workspaceId!,
      req.user!.id,
      req.body
    );
    res.json({ workspace });
  });

  removeConfig: RequestHandler = asyncRoute(async (req, res) => {
    await this.configService.removeConfig(req.user!.workspaceId!);
    res.status(204).send();
  });
}
