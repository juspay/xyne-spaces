import { defineAuth, route } from '../enc-contracts/api-route.js';
import { apps } from './apps/index.js';
import { activityAliases } from './activity-aliases/index.js';
import { clientEvents } from './client-events/index.js';
import { emojis } from './emojis/index.js';
import { analytics } from './analytics/index.js';
import { notifications } from './notifications/index.js';
import { messages } from './messages/index.js';
import { organizations } from './organizations/index.js';
import { cacConfig } from './cac-config/index.js';
import { subTickets } from './sub-tickets/index.js';
import { conversationLabels } from './conversation-labels/index.js';
import { channels } from './channels/index.js';
import { dailyBrief } from './daily-brief/index.js';

/**
 * The API: every typed REST route, as a tree that mirrors the URL and the folders of this
 * directory (one folder per hop). Mounted under `/api`: `api.apps.channel.info` is
 * `GET /api/apps/channel/info`. Each folder's index.ts holds its contracts, written in front of
 * their names, and its nested routes.
 */
export const api = route('', {
  apps,
  activityAliases,
  clientEvents,
  emojis,
  analytics,
  notifications,
  messages,
  organizations,
  cacConfig,
  subTickets,
  conversationLabels,
  channels,
  dailyBrief,
});

/**
 * The login every route needs: a session (`session`), a Xyne App's bot token (`app`), a
 * Slack-compatible bot token (`slack-app`), or none (`public`). One login may cover a whole
 * area, but never `public`: a public route says so itself. Every route must be covered (a
 * missing one is a type error); the backend reads each route's login from here.
 */
export const auth = defineAuth(api, {
  apps: {
    botChannels: 'session',
    calls: 'app',
    channel: {
      commands: 'session',
      deskChannelConfig: 'app',
      info: 'app',
      list: 'app',
      openDm: 'app',
      update: 'app',
    },
    chat: 'app',
    commands: 'session',
    commandsCreate: 'session',
    commandsDelete: 'session',
    commandsUpdate: 'session',
    configureWebhook: 'session',
    create: 'session',
    files: 'app',
    guests: 'app',
    incomingWebhooks: 'session',
    install: 'session',
    installed: 'session',
    orgNames: 'session',
    permissions: 'session',
    projectBoards: 'session',
    promote: 'session',
    regenerateJwt: 'session',
    signingSecret: 'session',
    slack: 'slack-app',
    ticket: 'app',
    user: 'app',
    usergroups: 'app',
  },
  activityAliases: 'session',
  clientEvents: 'session',
  emojis: 'session',
  analytics: 'session',
  notifications: 'session',
  messages: 'session',
  organizations: 'session',
  cacConfig: 'session',
  subTickets: 'session',
  conversationLabels: 'session',
  channels: 'session',
  dailyBrief: 'session',
});
