// /api/sdk: a Spaces token, or else the dashboard session as before.
import type { NextFunction, Request, Response } from 'express';
import { SdkApiError } from '@/api/sdk/errors';
import { ServiceAccountError } from '@/serviceAccounts/errors';
import { isSpacesToken, resolveSpacesToken } from '@/serviceAccounts/tokens';
import { authMiddleware } from './auth';

export async function authenticateSdk(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token || !isSpacesToken(token)) {
    return authMiddleware.authenticate(req, res, next);
  }

  try {
    const { user, claims } = await resolveSpacesToken(token);
    req.user = user;
    req.spacesToken = { kind: claims.kind, serviceAccountId: claims.sa };
    next();
  } catch (err) {
    next(
      err instanceof ServiceAccountError
        ? new SdkApiError('unauthenticated', err.message, { reason: err.reason, cause: err })
        : err,
    );
  }
}
