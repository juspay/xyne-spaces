import { Router } from 'express';
import { authMiddleware, webhookLimiter } from '../../re-exports';
import { ConfigController } from '../controllers/configController';
import { EventsController } from '../controllers/eventsController';
import { JobsController } from '../controllers/jobsController';
import { UserAuthController } from '../controllers/userAuthController';
import type { GatewayHandler, ProviderServices } from '../types';

const adminAuth = [authMiddleware.authenticate, authMiddleware.requireAdminOrOwner];

/** /api/gateway/<provider id>: events, config, sign-in and failed jobs. Each handler's own routes are mounted beside these. */
export function providerRoutes(services: ProviderServices, handlers: GatewayHandler[]): Router {
  const router = Router();
  const events = new EventsController(services, handlers);
  const config = new ConfigController(services.config, handlers);
  const userAuth = new UserAuthController(services.userAuth);
  const jobs = new JobsController(services.jobs, services.provider.id);

  router.post('/events', webhookLimiter, events.handleEvent); // provider signature, no login

  router.get('/config', adminAuth, config.getConfig);
  router.put('/config', adminAuth, config.saveConfig);
  router.delete('/config', adminAuth, config.removeConfig);

  router.get('/user', authMiddleware.authenticate, userAuth.getStatus);
  router.get('/user/connect', authMiddleware.authenticate, userAuth.connect);
  router.get('/user/callback', userAuth.callback); // the provider's redirect, no login
  router.delete('/user', authMiddleware.authenticate, userAuth.disconnect);

  router.get('/jobs', adminAuth, jobs.listFailed);
  router.post('/jobs/:handler/:id/retry', adminAuth, jobs.retry);
  router.delete('/jobs/:handler/:id', adminAuth, jobs.remove);
  return router;
}
