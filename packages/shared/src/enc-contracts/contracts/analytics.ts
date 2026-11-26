import { z } from 'zod';
import { defineRoute } from '../api-route.js';

// ─── Workspace analytics (/analytics/...): counts and time series, dashboard login, ──────
// ─── then the route ACL and ANALYTICS admin (individual access only) ─────────────────
// Numbers only: nothing encrypted. Query values are passed through as the controller took
// them (an unknown `groupBy` means "the plain count"; a bad `limit` is not an error).

const analyticsQuery = z.object({
  timeRange: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  groupBy: z.string().optional(),
  limit: z.string().optional(),
});

const analyticsResponse = z.object({ success: z.literal(true), data: z.unknown(), timestamp: z.string() });

const analytics = <P extends string>(path: P) =>
  defineRoute({ method: 'GET', path: `/analytics/${path}` as `/analytics/${P}`, query: analyticsQuery, response: analyticsResponse });

export const analyticsMessagesExchanged = analytics('messages-exchanged');
export const analyticsActiveUsers = analytics('active-users');
export const analyticsCurrentActiveUsers = analytics('current-active-users');
export const analyticsActiveChannels = analytics('active-channels');
export const analyticsFilesShared = analytics('files-shared');
export const analyticsMessagesToday = analytics('messages-today');
export const analyticsNumberOfTickets = analytics('number-of-tickets');
export const analyticsNumberOfCanvases = analytics('number-of-canvases');
export const analyticsNumberOfCalls = analytics('number-of-calls');
export const analyticsTotalCallsDuration = analytics('total-calls-duration');
export const analyticsUsersOnboarded = analytics('users-onboarded');
export const analyticsTopUsersByMessages = analytics('top-users-by-messages');
