import { Request, Response } from 'express';
import { CacConfigService } from '@/services/cacConfigService';

export class CacConfigController {
  getConfig = async (req: Request, res: Response): Promise<void> => {
    const key = req.params.key;
    if (!key) {
      res.status(400).json({ error: 'Config key is required' });
      return;
    }

    const userEmail = req.user?.email?.trim();
    const workspaceId = req.user?.workspaceId;
    const isPlayground = req.get('x-route-env')?.trim().toLowerCase() === 'playground';
    const context = userEmail || workspaceId || isPlayground
      ? {
          ...(userEmail ? { email: userEmail } : {}),
          ...(workspaceId ? { workspaceId } : {}),
          ...(isPlayground ? { environment: 'playground' } : {}),
        }
      : undefined;

    const config = await CacConfigService.fetch(key, context);
    res.json({ key, config });
  };
}
