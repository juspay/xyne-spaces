import { RequestHandler, Request, Response, NextFunction } from 'express';
import { AccessType } from '@prisma/client';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

export const BACKFILL_ADMIN_RESOURCE = 'TICKET-MIGRATION';

export const backfillAdminAuth: RequestHandler[] = [
  authMiddleware.authenticate,
  authorize(BACKFILL_ADMIN_RESOURCE, AccessType.ADMIN),
];

function runGuardChain(
  chain: RequestHandler[],
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  let index = 0;
  const advance = (err?: unknown): void => {
    if (err) return next(err as Error);
    const handler = chain[index++];
    if (!handler) return next();
    (handler as (r: Request, s: Response, n: NextFunction) => void)(req, res, advance);
  };
  advance();
}

export const backfillMountGuard: RequestHandler = (req, res, next) => {
  let pathname = req.path;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Malformed encoding never matches a router either; guard on the raw path.
  }
  const segment = (pathname.split('/').filter(Boolean)[0] ?? '').toLowerCase();

  if (!segment.endsWith('-backfill')) {
    return next();
  }

  runGuardChain(backfillAdminAuth, req, res, next);
};
