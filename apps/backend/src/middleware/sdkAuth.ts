// /api/sdk: an app guest's Spaces token, or else the dashboard session as before.
import type { NextFunction, Request, Response } from 'express';
import { SdkApiError } from '@/api/sdk/errors';
import { GuestTokenError, isGuestToken, resolveGuestToken } from '@/apps/core/guestToken';
import { authMiddleware } from './auth';

export async function authenticateSdk(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token || !isGuestToken(token)) {
    return authMiddleware.authenticate(req, res, next);
  }

  try {
    req.user = await resolveGuestToken(token);
    next();
  } catch (err) {
    next(
      err instanceof GuestTokenError
        ? new SdkApiError('unauthenticated', err.message, { reason: err.reason, cause: err })
        : err,
    );
  }
}
