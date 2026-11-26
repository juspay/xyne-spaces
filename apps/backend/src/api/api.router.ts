import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { appsRouter } from './apps/apps.router';
import { activityAliasesRouter } from './activity-aliases/activity-aliases.router';
import { clientEventsRouter } from './client-events/client-events.router';
import { emojisRouter } from './emojis/emojis.router';
import { analyticsRouter } from './analytics/analytics.router';
import { notificationsRouter } from './notifications/notifications.router';
import { messagesRouter } from './messages/messages.router';
import { organizationsRouter } from './organizations/organizations.router';
import { cacConfigRouter } from './cac-config/cac-config.router';
import { subTicketsRouter } from './sub-tickets/sub-tickets.router';
import { conversationLabelsRouter } from './conversation-labels/conversation-labels.router';
import { channelsRouter } from './channels/channels.router';
import { dailyBriefRouter } from './daily-brief/daily-brief.router';

/**
 * `/api`: every typed route, as a tree of routers that mirrors the URL and these folders, over
 * the API table (packages/shared/src/api). Each router lists one entry per name of its table
 * (TypeScript checks none is missing), and passes its defaults (auth, access checks) down to
 * every route under it. Mounted once at startup (app.ts: mountApi(apiRouter)).
 */
export const apiRouter = api.router(API, {}, () => ({
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
}));
