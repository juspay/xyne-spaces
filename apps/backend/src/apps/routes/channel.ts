import { Router } from 'express';
import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { requirePermission } from '@/middleware/requirePermission';
import { AppChannelController } from '../controllers/appChannelController';
import { appPermission, botChannel } from '../access';
import { channelInfo, deskChannelConfig, listChannels, openDm, updateChannel } from '../handlers/channels';

const router = Router();
const appChannelController = new AppChannelController();

// ─── Typed routes (contracts in @xyne/shared, API.apps.channel) ────────────────
// Served by the API router behind the contract gate; handlers in apps/handlers/channels.ts.
api.routes(API.apps.channel, (serve) => ({
  // The workspace comes from the verified token, never the body: an app installed in workspace
  // A cannot open a DM in workspace B.
  openDm: serve('openDm', {
    auth: 'app',
    access: { permission: appPermission('im:write') },
    handle: ({ body, user }) => openDm({ body, user }),
  }),
  info: serve('info', {
    auth: 'app',
    access: { permission: appPermission('channels:read'), channel: botChannel({ allowDm: false }) },
    handle: ({ body }) => channelInfo({ body }),
  }),
  deskChannelConfig: serve('deskChannelConfig', {
    auth: 'app',
    access: { permission: appPermission('desk:read'), channel: botChannel({ allowDm: false }) },
    handle: ({ body }) => deskChannelConfig({ body }),
  }),
  list: serve('list', {
    auth: 'app',
    access: { permission: appPermission('channels:read') },
    handle: ({ query, user }) => listChannels({ query, user }),
  }),
  update: serve('update', {
    auth: 'app',
    access: { permission: appPermission('channels:write') },
    handle: ({ body, user, app }) => updateChannel({ body, user, app }),
  }),
}));

// ─── Untyped (create calls the dashboard controller with the request: not moved yet) ──
router.post('/create', requirePermission('channels:write'), appChannelController.create);

export default router;
