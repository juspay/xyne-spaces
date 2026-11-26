import { defineRouter } from '../enc-contracts/api-route.js';
import { appsRouter } from './apps/apps.router.js';
import { activityAliasesRouter } from './activity-aliases/activity-aliases.router.js';
import { clientEventsRouter } from './client-events/client-events.router.js';
import { emojisRouter } from './emojis/emojis.router.js';
import { analyticsRouter } from './analytics/analytics.router.js';
import { notificationsRouter } from './notifications/notifications.router.js';
import { messagesRouter } from './messages/messages.router.js';
import { organizationsRouter } from './organizations/organizations.router.js';
import { cacConfigRouter } from './cac-config/cac-config.router.js';
import { subTicketsRouter } from './sub-tickets/sub-tickets.router.js';
import { conversationLabelsRouter } from './conversation-labels/conversation-labels.router.js';
import { channelsRouter } from './channels/channels.router.js';
import { dailyBriefRouter } from './daily-brief/daily-brief.router.js';

/**
 * The API table: every typed REST route, as a tree of routers that mirrors the URL (and the
 * folders of this directory). Mounted under `/api`: `API.apps.channel.info` is
 * `GET /api/apps/channel/info`. The backend's router tree (apps/backend/src/api) gives one
 * route per entry, checked by TypeScript, so none can be left out.
 */
export const API = defineRouter('', {
  apps: appsRouter,
  activityAliases: activityAliasesRouter,
  clientEvents: clientEventsRouter,
  emojis: emojisRouter,
  analytics: analyticsRouter,
  notifications: notificationsRouter,
  messages: messagesRouter,
  organizations: organizationsRouter,
  cacConfig: cacConfigRouter,
  subTickets: subTicketsRouter,
  conversationLabels: conversationLabelsRouter,
  channels: channelsRouter,
  dailyBrief: dailyBriefRouter,
});
