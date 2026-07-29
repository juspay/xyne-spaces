import { Request, Response } from 'express';
import { CacConfigService } from '@/services/cacConfigService';

export class CacConfigController {
  getConfig = async (req: Request, res: Response): Promise<void> => {
    const key = req.params.key;
    if (!key) {
      res.status(400).json({ error: 'Config key is required' });
      return;
    }

    const userEmail = req.user?.email;
    const config = await CacConfigService.fetch(key, userEmail ? { email: userEmail } : undefined);
    res.json({ key, config });
  };
}
