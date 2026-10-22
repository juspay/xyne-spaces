import type { RequestHandler } from 'express';
import { getBackendUrl } from '../../re-exports';
import { asyncRoute } from '../middleware/errorHandler';
import type { ConfigService } from '../services/configService';

/** Workspace admins manage the provider credentials. The body is checked with the provider's own schema. */
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  /** What is connected, if anything, and the two URLs the admin pastes into the provider app. */
  getConfig: RequestHandler = asyncRoute(async (req, res) => {
    const config = await this.configService.findConfigByWorkspace(req.user!.workspaceId!);
    const base = `${getBackendUrl(req)}${req.baseUrl}`;
    res.json({
      workspace: config?.workspace ?? null,
      appName: config?.appName ?? null,
      description: config?.description ?? null,
      urls: { events: `${base}/events`, userSignInRedirect: `${base}/user/callback` },
    });
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
