import { api, AccessType } from '@xyne/shared';
import { router } from '@/framework/api';
import { appSigningSecret, botChannels, configureAppWebhook, createApp, installAppHandler, orgNames, projectBoards, promoteApp, regenerateAppJwt } from './apps.controller';
import { createAppCommand, deleteAppCommand, listAppCommands, updateAppCommand } from './commands.controller';
import { xyneApps } from '@/api/apps/xyne-apps.access';
import { chatRouter } from './chat/chat.router';
import { filesRouter } from './files/files.router';
import { channelRouter } from './channel/channel.router';
import { userRouter } from './user/user.router';
import { usergroupsRouter } from './usergroups/usergroups.router';
import { guestsRouter } from './guests/guests.router';
import { installedRouter } from './installed/installed.router';
import { incomingWebhooksRouter } from './incoming-webhooks/incoming-webhooks.router';
import { permissionsRouter } from './permissions/permissions.router';
import { callsRouter } from './calls/calls.router';
import { ticketRouter } from './ticket/ticket.router';
import { slackRouter } from './slack/slack.router';

/** `/apps`: Xyne Apps. The bot API (bot token, set by each child router) and the dashboard side (dashboard login + XYNE-APPS access). The order is the table's (packages/shared/src/api/apps/apps.router.ts). */
export const appsRouter = router(api.apps, {}, (serve) => ({
  create: serve('create', { ...xyneApps(AccessType.WRITE), successStatus: 201, controller: ({ body, user }) => createApp({ body, user }) }),
  install: serve('install', { ...xyneApps(AccessType.ADMIN), successStatus: 201, controller: ({ params, user }) => installAppHandler({ params, user }) }),
  promote: serve('promote', { ...xyneApps(AccessType.ADMIN), controller: ({ params, user }) => promoteApp({ params, user }) }),
  configureWebhook: serve('configureWebhook', {
    ...xyneApps(AccessType.WRITE),
    controller: ({ params, body, user }) => configureAppWebhook({ params, body, user }),
  }),
  regenerateJwt: serve('regenerateJwt', { ...xyneApps(AccessType.WRITE), controller: ({ params, user }) => regenerateAppJwt({ params, user }) }),
  signingSecret: serve('signingSecret', { ...xyneApps(AccessType.WRITE), controller: ({ params, user }) => appSigningSecret({ params, user }) }),
  botChannels: serve('botChannels', { ...xyneApps(AccessType.READ), controller: ({ params, user }) => botChannels({ params, user }) }),
  projectBoards: serve('projectBoards', { ...xyneApps(AccessType.READ), controller: ({ params, user }) => projectBoards({ params, user }) }),
  orgNames: serve('orgNames', { ...xyneApps(AccessType.READ), controller: ({ body }) => orgNames({ body }) }),

  // Commands (user auth), per app: last, so `/:appId/commands` never captures a literal path above.
  commands: serve('commands', { ...xyneApps(AccessType.READ), controller: ({ params, query }) => listAppCommands({ params, query }) }),
  commandsCreate: serve('commandsCreate', {
    ...xyneApps(AccessType.WRITE),
    successStatus: 201,
    controller: ({ params, body, user }) => createAppCommand({ params, body, user }),
  }),
  commandsUpdate: serve('commandsUpdate', {
    ...xyneApps(AccessType.WRITE),
    controller: ({ params, body, user }) => updateAppCommand({ params, body, user }),
  }),
  commandsDelete: serve('commandsDelete', {
    ...xyneApps(AccessType.WRITE),
    controller: ({ params, query, user }) => deleteAppCommand({ params, query, user }),
  }),
  chat: chatRouter,
  files: filesRouter,
  channel: channelRouter,
  user: userRouter,
  usergroups: usergroupsRouter,
  guests: guestsRouter,
  installed: installedRouter,
  incomingWebhooks: incomingWebhooksRouter,
  permissions: permissionsRouter,
  calls: callsRouter,
  ticket: ticketRouter,
  slack: slackRouter,
}));
