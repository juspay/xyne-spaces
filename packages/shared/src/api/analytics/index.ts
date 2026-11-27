import { defineRoute, route } from '../../enc-contracts/api-route.js';
import { z } from 'zod';

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

const analyticsContract = <P extends string, T extends z.ZodType>(path: P, data: T) =>
  defineRoute({ method: 'GET', path: `/${path}` as `/${P}`, query: analyticsQuery, response: wrap(data) });

/** `/analytics`: workspace analytics. Key order is the mount order. */
export const analytics = route('/analytics', {
  messagesExchanged: analyticsContract(
    'messages-exchanged',
    z.array(z.object({ date: z.string(), value: z.number(), channelMessages: z.number(), dmMessages: z.number(), groupDmMessages: z.number() })),
  ),
  activeUsers: analyticsContract('active-users', z.object({ uniqueUsers: z.number(), timeSeries: z.array(point) })),
  currentActiveUsers: analyticsContract(
    'current-active-users',
    z.array(z.object({ userStatus: z.string(), userCount: z.number(), percentage: z.number() })),
  ),
  activeChannels: analyticsContract('active-channels', countOrSeries),
  filesShared: analyticsContract('files-shared', countOrSeries),
  messagesToday: analyticsContract('messages-today', countOrSeries),
  numberOfTickets: analyticsContract('number-of-tickets', countOrSeries),
  numberOfCanvases: analyticsContract('number-of-canvases', countOrSeries),
  /** Calls: the totals (`calls`, `recordings`), or per bucket when grouped. */
  numberOfCalls: analyticsContract(
    'number-of-calls',
    z.union([
      z.object({ calls: z.number(), recordings: z.number() }),
      z.array(z.object({ date: z.string(), calls: z.number(), recordings: z.number() })),
    ]),
  ),
  totalCallsDuration: analyticsContract('total-calls-duration', countOrSeries),
  usersOnboarded: analyticsContract('users-onboarded', countOrSeries),
  topUsersByMessages: analyticsContract(
    'top-users-by-messages',
    z.array(z.object({ userId: z.string(), userName: z.string(), messageCount: z.number() })),
  ),
});
