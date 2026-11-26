import { API, AccessType } from '@xyne/shared';
import { api } from '@/framework/api';
import { activeChannels, activeUsers, currentActiveUsers, filesShared, messagesExchanged, messagesToday, numberOfCalls, numberOfCanvases, numberOfTickets, topUsersByMessages, totalCallsDuration, usersOnboarded } from './analytics.controller';
import { analyticsWorkspace, resourceAccess, routeAcl } from '@/framework/dashboardAccess';

/** `/analytics`: every route runs these checks, in this order: a workspace is present, the route ACL, then ANALYTICS admin (individual access only). */
export const analyticsRouter = api.router(API.analytics, { access: { workspace: analyticsWorkspace(), acl: routeAcl(), analytics: resourceAccess('ANALYTICS', AccessType.ADMIN) } }, (serve) => ({
  messagesExchanged: serve('messagesExchanged', { controller: ({ query, user }) => messagesExchanged({ query, user }) }),
  activeUsers: serve('activeUsers', { controller: ({ query, user }) => activeUsers({ query, user }) }),
  currentActiveUsers: serve('currentActiveUsers', { controller: ({ query, user }) => currentActiveUsers({ query, user }) }),
  activeChannels: serve('activeChannels', { controller: ({ query, user }) => activeChannels({ query, user }) }),
  filesShared: serve('filesShared', { controller: ({ query, user }) => filesShared({ query, user }) }),
  messagesToday: serve('messagesToday', { controller: ({ query, user }) => messagesToday({ query, user }) }),
  numberOfTickets: serve('numberOfTickets', { controller: ({ query, user }) => numberOfTickets({ query, user }) }),
  numberOfCanvases: serve('numberOfCanvases', { controller: ({ query, user }) => numberOfCanvases({ query, user }) }),
  numberOfCalls: serve('numberOfCalls', { controller: ({ query, user }) => numberOfCalls({ query, user }) }),
  totalCallsDuration: serve('totalCallsDuration', { controller: ({ query, user }) => totalCallsDuration({ query, user }) }),
  usersOnboarded: serve('usersOnboarded', { controller: ({ query, user }) => usersOnboarded({ query, user }) }),
  topUsersByMessages: serve('topUsersByMessages', { controller: ({ query, user }) => topUsersByMessages({ query, user }) }),
}));
