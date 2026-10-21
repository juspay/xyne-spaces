import { Router } from 'express';
import { authMiddleware, webhookLimiter } from '../../re-exports';
import { ConfigController } from '../../core/controllers/configController';
import { EventsController } from '../../core/controllers/eventsController';
import { JobsController } from '../../core/controllers/jobsController';
import { UserAuthController } from '../../core/controllers/userAuthController';
import type { GatewayHandler, ProviderServices } from '../../core/types';

const adminAuth = [authMiddleware.authenticate, authMiddleware.requireAdminOrOwner];

/** /api/gateway/slack: events, config, sign-in and failed jobs. Each handler's own routes are mounted beside these. */
export function slackRoutes(services: ProviderServices, handlers: GatewayHandler[]): Router {
  const router = Router();
  const events = new EventsController(services, handlers);
  const config = new ConfigController(services.config);
  const userAuth = new UserAuthController(services.userAuth);
  const jobs = new JobsController(services.jobs, services.provider.id);

  router.post('/events', webhookLimiter, events.handleEvent); // Slack signature, no login

  router.get('/config', adminAuth, config.getConfig);
  router.put('/config', adminAuth, config.saveConfig);
  router.delete('/config', adminAuth, config.removeConfig);

  router.get('/user', authMiddleware.authenticate, userAuth.getStatus);
  router.get('/user/connect', authMiddleware.authenticate, userAuth.connect);
  router.get('/user/callback', userAuth.callback); // Slack's redirect, no login
  router.delete('/user', authMiddleware.authenticate, userAuth.disconnect);

  router.get('/jobs', adminAuth, jobs.listFailed);
  router.post('/jobs/:handler/:id/retry', adminAuth, jobs.retry);
  router.delete('/jobs/:handler/:id', adminAuth, jobs.remove);
  return router;
}
