import { Router } from 'express';
import { authMiddleware, webhookLimiter } from '../../re-exports';
import { ConfigController } from '../../core/controllers/configController';
import { EventsController } from '../../core/controllers/eventsController';
import { LinkController } from '../../useCases/mirror/controllers/linkController';
import { UserAuthController } from '../../core/controllers/userAuthController';
import { requireChannelMember } from '../../useCases/mirror/middleware/requireChannelMember';
import type { ProviderServices } from '../../core/types';

const adminAuth = [authMiddleware.authenticate, authMiddleware.requireAdminOrOwner];
const memberAuth = [authMiddleware.authenticate, requireChannelMember];

/** /api/gateway/slack — wiring only. */
export function slackRoutes(services: ProviderServices): Router {
  const router = Router();
  const events = new EventsController(services);
  const config = new ConfigController(services.config);
  const links = new LinkController(services.links);
  const userAuth = new UserAuthController(services.userAuth);

  router.post('/events', webhookLimiter, events.handleEvent); // Slack signature, no login

  router.get('/config', adminAuth, config.getConfig);
  router.put('/config', adminAuth, config.saveConfig);
  router.delete('/config', adminAuth, config.removeConfig);

  router.get('/links', memberAuth, links.getLink);
  router.get('/links/candidates', memberAuth, links.listLinkableChannels);
  router.post('/links', memberAuth, links.linkChannel);
  router.post('/links/:id/pause', memberAuth, links.pauseLink);
  router.post('/links/:id/resume', memberAuth, links.resumeLink);
  router.delete('/links/:id', memberAuth, links.unlinkChannel);

  router.get('/user', authMiddleware.authenticate, userAuth.getStatus);
  router.get('/user/connect', authMiddleware.authenticate, userAuth.connect);
  router.get('/user/callback', userAuth.callback); // Slack's redirect, no login
  router.delete('/user', authMiddleware.authenticate, userAuth.disconnect);
  return router;
}
