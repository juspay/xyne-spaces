import type { NextFunction, Request, Response } from 'express';
import { authenticateKey } from '@/serviceAccounts/keys';

export async function s2sKeyAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    const key = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    req.serviceAccount = await authenticateKey(key);
    next();
  } catch (err) {
    next(err);
  }
}
