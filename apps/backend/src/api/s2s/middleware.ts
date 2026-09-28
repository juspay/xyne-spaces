import type { NextFunction, Request, Response } from 'express';
import { runAsServiceActor } from '@/database/tenant/context';
import { authenticateKey } from '@/serviceAccounts/keys';

/** The rest of the request runs as a service actor scoped to the account's workspace. */
export async function s2sKeyAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    const key = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    const serviceAccount = await authenticateKey(key);
    req.serviceAccount = serviceAccount;
    runAsServiceActor(`service-account:${serviceAccount.id}`, serviceAccount.workspaceId, () => next());
  } catch (err) {
    next(err);
  }
}
