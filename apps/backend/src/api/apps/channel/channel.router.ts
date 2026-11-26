import { api } from '@xyne/shared';
import { router } from '@/framework/api';
import { channelInfo, deskChannelConfig, listChannels, openDm, updateChannel } from './channel.controller';
import { listChannelCommands } from './commands.controller';
import { appPermission, botChannel } from '@/apps/access';

/** `/apps/channel`: channels for bots (bot token), and a channel's commands for the dashboard (session). */
export const channelRouter = router(api.apps.channel, { auth: 'app' }, (serve) => ({
  // The workspace comes from the verified token, never the body: an app installed in workspace
  // A cannot open a DM in workspace B.
  openDm: serve('openDm', {
    access: { permission: appPermission('im:write') },
    controller: ({ body, user }) => openDm({ body, user }),
  }),
  info: serve('info', {
    access: { permission: appPermission('channels:read'), channel: botChannel({ allowDm: false }) },
    controller: ({ body }) => channelInfo({ body }),
  }),
  deskChannelConfig: serve('deskChannelConfig', {
    access: { permission: appPermission('desk:read'), channel: botChannel({ allowDm: false }) },
    controller: ({ body }) => deskChannelConfig({ body }),
  }),
  list: serve('list', {
    access: { permission: appPermission('channels:read') },
    controller: ({ query, user }) => listChannels({ query, user }),
  }),
  update: serve('update', {
    access: { permission: appPermission('channels:write') },
    controller: ({ body, user, app }) => updateChannel({ body, user, app }),
  }),
  // The dashboard's command picker: a dashboard login, not the bot token.

  // Commands (user auth) — the commands available in a channel; login only.
  commands: serve('commands', { auth: 'session', controller: ({ params, query }) => listChannelCommands({ params, query }) }),
}));
