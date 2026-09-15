import { Request, Response } from 'express';
import { LotusCacService } from '@/services/lotusCac';

export class LotusCacConfigController {
  /** GET / — resolve all lotus CAC keys for the request dimensions. */
  getAllConfigs = async (req: Request, res: Response): Promise<void> => {
    const result = await LotusCacService.fetchAll(
      req.query as Record<string, unknown>,
      req.user?.email
    );

    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.json({ configs: result.configs });
  };

  /** GET /:key — resolve a single lotus CAC key. */
  getConfig = async (req: Request, res: Response): Promise<void> => {
    const key = req.params.key;
    if (!key) {
      res.status(400).json({ error: 'Config key is required' });
      return;
    }

    const result = await LotusCacService.fetch(
      key,
      req.query as Record<string, unknown>,
      req.user?.email
    );

    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.json({ key: result.key, config: result.config });
  };
}
