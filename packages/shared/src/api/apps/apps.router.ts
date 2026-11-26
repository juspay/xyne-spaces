import { defineRouter } from '../../enc-contracts/api-route.js';
import { chatRouter } from './chat/chat.router.js';
import { filesRouter } from './files/files.router.js';
import { channelRouter } from './channel/channel.router.js';
import { userRouter } from './user/user.router.js';
import { usergroupsRouter } from './usergroups/usergroups.router.js';
import { guestsRouter } from './guests/guests.router.js';
import { installedRouter } from './installed/installed.router.js';
import { incomingWebhooksRouter } from './incoming-webhooks/incoming-webhooks.router.js';
import { permissionsRouter } from './permissions/permissions.router.js';
import { callsRouter } from './calls/calls.router.js';
import { ticketRouter } from './ticket/ticket.router.js';
import { slackRouter } from './slack/slack.router.js';
import { appsBotChannels, appsConfigureWebhook, appsCreate, appsInstall, appsOrgNames, appsProjectBoards, appsPromote, appsRegenerateJwt, appsSigningSecret } from './apps.contracts.js';
import { appsCommands, appsCommandsCreate, appsCommandsDelete, appsCommandsUpdate } from './commands.contracts.js';

/** `/apps`: Xyne Apps. The bot API (chat, channel, slack...) and the dashboard side (app setup, installs, permissions, commands). `/:appId/commands` last: it must not capture a literal path above. Key order is the mount order. */
export const appsRouter = defineRouter('/apps', {
  chat: chatRouter,
  files: filesRouter,
  channel: channelRouter,
  user: userRouter,
  usergroups: usergroupsRouter,
  guests: guestsRouter,
  create: appsCreate,
  install: appsInstall,
  promote: appsPromote,
  configureWebhook: appsConfigureWebhook,
  regenerateJwt: appsRegenerateJwt,
  signingSecret: appsSigningSecret,
  botChannels: appsBotChannels,
  projectBoards: appsProjectBoards,
  orgNames: appsOrgNames,
  installed: installedRouter,
  incomingWebhooks: incomingWebhooksRouter,
  permissions: permissionsRouter,
  calls: callsRouter,
  ticket: ticketRouter,
  slack: slackRouter,
  commands: appsCommands,
  commandsCreate: appsCommandsCreate,
  commandsUpdate: appsCommandsUpdate,
  commandsDelete: appsCommandsDelete,
});
