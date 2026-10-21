import { Router } from 'express';
import { authMiddleware } from '../../re-exports';
import { LinkController } from './controllers/linkController';
import { LinkRequestController } from './controllers/linkRequestController';
import {
  requireChannelAdmin,
  requireChannelMember,
  requireLinkManager,
  requireRequestChannelAdmin,
} from './middleware/channelGuards';
import type { MirrorServices } from './types';

const adminAuth = [authMiddleware.authenticate, authMiddleware.requireAdminOrOwner];
const memberAuth = [authMiddleware.authenticate, requireChannelMember];
const channelAdminAuth = [authMiddleware.authenticate, requireChannelAdmin];
const requestAdminAuth = [authMiddleware.authenticate, requireRequestChannelAdmin];
const linkManagerAuth = [authMiddleware.authenticate, requireLinkManager];

/** Mirror's endpoints, mounted under each provider's path, e.g. /api/gateway/slack. Wiring only. */
export function mirrorRoutes(mirror: MirrorServices): Router {
  const router = Router();
  const links = new LinkController(mirror.links, mirror.linkRequests);
  const requests = new LinkRequestController(mirror.linkRequests);

  router.get('/links', memberAuth, links.getChannelStatus);
  router.get('/links/candidates', channelAdminAuth, links.listLinkableChannels);
  router.post('/links/:id/pause', linkManagerAuth, links.pauseLink);
  router.post('/links/:id/resume', linkManagerAuth, links.resumeLink);
  router.delete('/links/:id', linkManagerAuth, links.unlinkChannel);

  router.post('/link-requests', channelAdminAuth, requests.submitRequest);
  router.post('/link-requests/:id/cancel', requestAdminAuth, requests.cancelRequest);
  router.get('/link-requests', adminAuth, requests.listRequests);
  router.post('/link-requests/:id/approve', adminAuth, requests.approveRequest);
  router.post('/link-requests/:id/reject', adminAuth, requests.rejectRequest);
  return router;
}
