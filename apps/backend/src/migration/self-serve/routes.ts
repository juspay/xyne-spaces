import { NextFunction, Request, Response, Router } from 'express';
import { slackMigrationLimiter } from '@/middleware/rateLimiters';
import { Actor, HttpError, SlackMigrationService } from './service';
import { QueueName } from './types';

const ok = (data: unknown) => ({ success: true, data });
const fail = (code: string, message: string) => ({ success: false, error: { code, message } });

interface AuthedUser { id: string; workspaceId: string; name?: string; email?: string; role?: string; orgRole?: string; }

const actorOf = (req: Request): Actor => {
  const u = (req as Request & { user?: AuthedUser }).user;
  if (!u) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
  return { userId: u.id, workspaceId: u.workspaceId, name: u.name, email: u.email };
};

const requireAdmin = (service: SlackMigrationService) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const u = (req as Request & { user?: AuthedUser }).user;
    if (!u) return next(new HttpError(401, 'UNAUTHORIZED', 'Authentication required'));
    if (u.role === 'ADMIN' || u.role === 'OWNER' || u.orgRole === 'OWNER' || u.orgRole === 'ADMIN') return next();
    // Fall back to the TICKET-MIGRATION resource — its admins manage Slack migrations too.
    service.hasMigrationAdminResource(u.id)
      .then((ok) => (ok ? next() : next(new HttpError(403, 'FORBIDDEN', 'Admin access required'))))
      .catch(() => next(new HttpError(403, 'FORBIDDEN', 'Admin access required')));
  };

const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => { fn(req, res).catch(next); };

export function buildRouter(service: SlackMigrationService): Router {
  const router = Router();
  const admin = requireAdmin(service);
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
  // Owner self-service: the submitter can resume/delete their OWN jobs (service asserts ownership) — no admin needed.
  router.post('/mine/:id/resume', wrap(async (req, res) => { res.json(ok(await service.resume(req.params.id, actorOf(req), true))); }));
  router.delete('/mine/:id', wrap(async (req, res) => { await service.remove(req.params.id, actorOf(req), true); res.json(ok({ deleted: true })); }));

  // ── Jobs (admin-gated: list + act on every migration in the workspace) ──────
  router.get('/migration-jobs', admin, wrap(async (req, res) => {
    res.json(ok(await service.listForAdmin(actorOf(req))));
  }));
  router.get('/migration-jobs/export', admin, wrap(async (req, res) => { res.json(ok(await service.listForAdmin(actorOf(req), 1000))); }));

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

  router.post('/migration-jobs/:id/approve', admin, wrap(async (req, res) => { res.json(ok(await service.approve(req.params.id, actorOf(req)))); }));
  router.post('/migration-jobs/:id/stop', admin, wrap(async (req, res) => { res.json(ok(await service.stop(req.params.id, actorOf(req)))); }));
  router.post('/migration-jobs/:id/resume', admin, wrap(async (req, res) => { res.json(ok(await service.resume(req.params.id, actorOf(req)))); }));
  router.delete('/migration-jobs/:id', admin, wrap(async (req, res) => { await service.remove(req.params.id, actorOf(req)); res.json(ok({ deleted: true })); }));
  router.post('/queues/:queue/pause', admin, wrap(async (req, res) => {
    await service.pauseQueue(req.params.queue as QueueName); res.json(ok({ paused: req.params.queue }));
  }));
  router.post('/queues/:queue/resume', admin, wrap(async (req, res) => {
    await service.resumeQueue(req.params.queue as QueueName); res.json(ok({ resumed: req.params.queue }));
  }));

  // Scoped error handler → consistent envelope
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.statusCode).json(fail(err.code, err.message));
    return res.status(500).json(fail('INTERNAL_ERROR', 'Something went wrong'));
  });

  return router;
}
