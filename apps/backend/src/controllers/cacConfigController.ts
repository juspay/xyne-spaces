import { Request, Response } from 'express';
import { CacConfigService, cacContextFromRequest } from '@/services/cacConfigService';

export class CacConfigController {
  getConfig = async (req: Request, res: Response): Promise<void> => {
    const key = req.params.key;
    if (!key) {
      res.status(400).json({ error: 'Config key is required' });
      return;
    }

    const config = await CacConfigService.fetch(key, cacContextFromRequest(req));
    res.json({ key, config });
  };
}
