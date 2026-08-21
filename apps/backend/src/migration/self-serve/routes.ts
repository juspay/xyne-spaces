import { NextFunction, Request, Response, Router } from 'express';
import { slackMigrationLimiter } from '@/middleware/rateLimiters';
import { Actor, HttpError, SlackMigrationService } from './service';
import { QueueName } from './types';

const ok = (data: unknown) => ({ success: true, data });
const fail = (code: string, message: string) => ({ success: false, error: { code, message } });

interface AuthedUser { id: string; workspaceId: string; name?: string; email?: string; role?: string; }

const actorOf = (req: Request): Actor => {
  const u = (req as Request & { user?: AuthedUser }).user;
  if (!u) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
  return { userId: u.id, workspaceId: u.workspaceId, name: u.name, email: u.email };
};

const requireAdmin = (req: Request, _res: Response, next: NextFunction): void => {
  const role = (req as Request & { user?: AuthedUser }).user?.role;
  if (role !== 'ADMIN') return next(new HttpError(403, 'FORBIDDEN', 'Admin access required'));
  next();
};

const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => { fn(req, res).catch(next); };

export function buildRouter(service: SlackMigrationService): Router {
  const router = Router();
  router.use(slackMigrationLimiter); // per-user throttle — this feature runs on one pod


  // ── Member ────────────────────────────────────────────────────────────────
  router.post('/dm', wrap(async (req, res) => {
    res.status(202).json(ok(await service.submitDm(actorOf(req), req.body?.token)));
  }));
  router.post('/channel', wrap(async (req, res) => {
    res.status(202).json(ok(await service.submitChannel(actorOf(req), {
      slackChannelId: req.body?.slackChannelId,
      xyneChannelId: req.body?.xyneChannelId,
      startDate: req.body?.startDate,
      announceInSlack: !!req.body?.announceInSlack,
    })));
  }));
  router.get('/mine', wrap(async (req, res) => { res.json(ok(await service.getMineList(actorOf(req)))); }));

  // ── Jobs (admin-gated: list + act on every migration in the workspace) ──────
  router.get('/migration-jobs', requireAdmin, wrap(async (req, res) => {
    res.json(ok(await service.listForAdmin(Math.min(Number(req.query.limit) || 50, 200), Number(req.query.offset) || 0)));
  }));
  router.get('/migration-jobs/export', requireAdmin, wrap(async (_req, res) => { res.json(ok(await service.listForAdmin(1000, 0))); }));

  // ── Ingestion control — gated by SLACK-MIGRATION-INGEST, not the admin role.
  //    `approve` only stages jobs; these start/stop the worker.
  router.get('/ingestion', wrap(async (req, res) => {
    res.json(ok(await service.ingestionStatus(actorOf(req).userId)));
  }));
  router.post('/ingestion/start', wrap(async (req, res) => {
    res.json(ok(await service.startIngestion(actorOf(req).userId)));
  }));
  router.post('/ingestion/stop', wrap(async (req, res) => {
    res.json(ok(await service.stopIngestion(actorOf(req).userId)));
  }));

  router.post('/migration-jobs/:id/approve', requireAdmin, wrap(async (req, res) => { res.json(ok(await service.approve(req.params.id))); }));
  router.post('/migration-jobs/:id/stop', requireAdmin, wrap(async (req, res) => { res.json(ok(await service.stop(req.params.id))); }));
  router.post('/migration-jobs/:id/resume', requireAdmin, wrap(async (req, res) => { res.json(ok(await service.resume(req.params.id))); }));
  router.delete('/migration-jobs/:id', requireAdmin, wrap(async (req, res) => { await service.remove(req.params.id); res.json(ok({ deleted: true })); }));
  router.post('/queues/:queue/pause', requireAdmin, wrap(async (req, res) => {
    await service.pauseQueue(req.params.queue as QueueName); res.json(ok({ paused: req.params.queue }));
  }));
  router.post('/queues/:queue/resume', requireAdmin, wrap(async (req, res) => {
    await service.resumeQueue(req.params.queue as QueueName); res.json(ok({ resumed: req.params.queue }));
  }));

  // Scoped error handler → consistent envelope
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.statusCode).json(fail(err.code, err.message));
    return res.status(500).json(fail('INTERNAL_ERROR', 'Something went wrong'));
  });

  return router;
}
