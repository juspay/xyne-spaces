import { RequestHandler, Request, Response, NextFunction } from 'express';
import { AccessType } from '@prisma/client';
import { authMiddleware } from '@/middleware/auth';
import { authorize } from '@/middleware/authorize';

/**
 * Shared guard for migration / backfill admin endpoints.
 *
 * Every backfill and migration route mutates production data in bulk and must
 * only be reachable by an authenticated caller who holds ADMIN on the
 * `TICKET-MIGRATION` resource. Using one shared array (instead of re-declaring
 * `authMiddleware.authenticate` + `authorize(...)` in every route file) removes
 * the copy-paste drift that historically left some backfill routes
 * authenticated-only or fully open.
 *
 * Usage:
 *   import { backfillAdminAuth } from '@/middleware/backfillAdminAuth';
 *   router.post('/', ...backfillAdminAuth, Controller.triggerBackfill);
 *
 * Order matters: `authenticate` populates `req.user`, which `authorize` reads.
 */
export const BACKFILL_ADMIN_RESOURCE = 'TICKET-MIGRATION';

export const backfillAdminAuth: RequestHandler[] = [
  authMiddleware.authenticate,
  authorize(BACKFILL_ADMIN_RESOURCE, AccessType.ADMIN),
];

/**
 * Mount-layer defence-in-depth for `*-backfill` admin routes.
 *
 * `backfillMountGuard` is registered ONCE at the `/api/admin` and
 * `/migrate/api/admin` mount points (see app.ts), ahead of the individual
 * backfill routers. Any first path segment that ends in `-backfill` is gated
 * with `backfillAdminAuth` BY DEFAULT — so a newly-added `*-backfill` router
 * that forgets its in-file guard is still protected at the mount, instead of
 * relying on every author remembering the convention. This is what turns
 * "admin-guarded by convention" into "admin-guarded by default".
 *
 * A small set of backfills intentionally authorize against a DIFFERENT resource
 * than the `TICKET-MIGRATION` default (e.g. Vespa reindex -> `VESPA`, app
 * backfills -> `XYNE-APPS`). Those self-authorize inside their own router and
 * are listed in `SELF_GUARDED_BACKFILLS` so the mount guard does not double-gate
 * them with an unrelated resource (which would wrongly tighten access for a
 * caller who legitimately holds only the route's own resource). The
 * guard-coverage test still asserts every one of those files carries its own
 * admin `authorize(...)`.
 */
export const SELF_GUARDED_BACKFILLS = new Set<string>([
  'vespa-backfill', // authorize('VESPA', WRITE)
  'app-permissions-backfill', // authorize('XYNE-APPS', ADMIN)
  'app-signing-secret-backfill', // authorize('XYNE-APPS', ADMIN)
  'installed-app-commands-backfill', // authorize('XYNE-APPS', ADMIN)
  'form-field-sequence-backfill', // authorize('FORMS', ADMIN)
  'ticket-duplicate-backfill', // authorize('TICKETS', ADMIN)
]);

/**
 * Run an ordered array of Express middlewares as a single composed handler,
 * short-circuiting the moment one of them ends the request (sends a response)
 * or forwards an error. On clean completion it calls the outer `next()` so the
 * request continues to the matched backfill router.
 */
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
    // Express RequestHandler signature - safe to invoke with (req, res, advance).
    (handler as (r: Request, s: Response, n: NextFunction) => void)(req, res, advance);
  };
  advance();
}

export const backfillMountGuard: RequestHandler = (req, res, next) => {
  // `req.path` here is relative to the mount (`/api/admin` or
  // `/migrate/api/admin`), so the first non-empty segment is the router name.
  const segment = req.path.split('/').filter(Boolean)[0] ?? '';

  if (!segment.endsWith('-backfill') || SELF_GUARDED_BACKFILLS.has(segment)) {
    return next();
  }

  runGuardChain(backfillAdminAuth, req, res, next);
};
