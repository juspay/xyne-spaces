import { z } from 'zod';
import { defineRoute } from '../../enc-contracts/api-route.js';

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

const wrap = <T extends z.ZodType>(data: T) => z.object({ success: z.literal(true), data, timestamp: z.string() });
const point = z.object({ date: z.string(), value: z.number() });
/** A count, or a time series of it when `groupBy` is `day` or `hour`. */
const countOrSeries = z.union([z.number(), z.array(point)]);

const analytics = <P extends string, T extends z.ZodType>(path: P, data: T) =>
  defineRoute({ method: 'GET', path: `/${path}` as `/${P}`, query: analyticsQuery, response: wrap(data) });

export const analyticsMessagesExchanged = analytics(
  'messages-exchanged',
  z.array(z.object({ date: z.string(), value: z.number(), channelMessages: z.number(), dmMessages: z.number(), groupDmMessages: z.number() })),
);
export const analyticsActiveUsers = analytics('active-users', z.object({ uniqueUsers: z.number(), timeSeries: z.array(point) }));
export const analyticsCurrentActiveUsers = analytics(
  'current-active-users',
  z.array(z.object({ userStatus: z.string(), userCount: z.number(), percentage: z.number() })),
);
export const analyticsActiveChannels = analytics('active-channels', countOrSeries);
export const analyticsFilesShared = analytics('files-shared', countOrSeries);
export const analyticsMessagesToday = analytics('messages-today', countOrSeries);
export const analyticsNumberOfTickets = analytics('number-of-tickets', countOrSeries);
export const analyticsNumberOfCanvases = analytics('number-of-canvases', countOrSeries);
/** Calls: the totals (`calls`, `recordings`), or per bucket when grouped. */
export const analyticsNumberOfCalls = analytics(
  'number-of-calls',
  z.union([
    z.object({ calls: z.number(), recordings: z.number() }),
    z.array(z.object({ date: z.string(), calls: z.number(), recordings: z.number() })),
  ]),
);
export const analyticsTotalCallsDuration = analytics('total-calls-duration', countOrSeries);
export const analyticsUsersOnboarded = analytics('users-onboarded', countOrSeries);
export const analyticsTopUsersByMessages = analytics(
  'top-users-by-messages',
  z.array(z.object({ userId: z.string(), userName: z.string(), messageCount: z.number() })),
);