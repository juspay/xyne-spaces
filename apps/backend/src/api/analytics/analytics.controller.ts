import { AnalyticsRepository, type AnalyticsFilters } from '@/database/repositories/analyticsRepository';
import { ContractError } from '@/framework/api';
import type { AuthenticatedUser } from '@/types/express';
import { logger } from '@/utils/logger';

/**
 * The workspace analytics API on the typed framework (routes/analytics.ts): no req/res, same
 * numbers and answers as the AnalyticsController methods they replace. The route's access
 * checks (workspace present, route ACL, ANALYTICS admin) have run, so `workspaceId` is set.
 */

const repo = new AnalyticsRepository();

type Query = { timeRange?: string; startDate?: string; endDate?: string; groupBy?: string; limit?: string };
type Input = { query: Query; user: AuthenticatedUser | undefined };

const workspaceOf = (user: AuthenticatedUser | undefined) => user!.workspaceId!;

const filtersOf = ({ query, user }: Input): AnalyticsFilters => ({
  timeRange: query.timeRange as string,
  startDate: query.startDate as string,
  endDate: query.endDate as string,
  workspaceId: workspaceOf(user),
});

const hourOrDay = (value: string | undefined): 'day' | 'hour' | undefined =>
  value === 'day' || value === 'hour' ? value : undefined;

/** Runs one analytics read: the number, the way the controller wrapped it, or its 500. */
async function answer<T>(label: string, read: () => Promise<T>, suffix = ' analytics') {
  try {
    return { success: true as const, data: await read(), timestamp: new Date().toISOString() };
  } catch (error) {
    logger.error(`Error fetching ${label}${suffix}:`, error);
    throw new ContractError(500, {
      success: false,
      error: `Failed to fetch ${label}${suffix}`,
      timestamp: new Date().toISOString(),
    });
  }
}

/** A count that becomes a time series when `groupBy` is `day` or `hour`. */
const countOrSeries = <C, S>(
  label: string,
  count: (filters: AnalyticsFilters) => Promise<C>,
  series: (filters: AnalyticsFilters, groupBy: 'day' | 'hour') => Promise<S>,
) =>
  (input: Input) =>
    answer<C | S>(label, () => {
      const groupBy = hourOrDay(input.query.groupBy);
      return groupBy ? series(filtersOf(input), groupBy) : count(filtersOf(input));
    });

export const messagesExchanged = (input: Input) =>
  answer('messages exchanged', () => repo.getMessagesExchanged(filtersOf(input), (input.query.groupBy as 'day' | 'hour' | undefined) ?? 'day'));

export const activeUsers = (input: Input) =>
  answer('active users', () => repo.getActiveUsersWithChart(filtersOf(input), (input.query.groupBy as 'day' | 'hour' | undefined) ?? 'day'));

export const currentActiveUsers = (input: Input) =>
  answer('current active users', () => repo.getCurrentActiveUsers(workspaceOf(input.user)));

export const activeChannels = countOrSeries(
  'active channels',
  (f) => repo.getActiveChannels(f),
  (f, g) => repo.getActiveChannelsTimeSeries(f, g),
);
export const filesShared = countOrSeries(
  'files shared',
  (f) => repo.getFilesShared(f),
  (f, g) => repo.getFilesSharedTimeSeries(f, g),
);
export const numberOfTickets = countOrSeries(
  'number of tickets',
  (f) => repo.getNumberOfTickets(f),
  (f, g) => repo.getNumberOfTicketsTimeSeries(f, g),
);
export const numberOfCanvases = countOrSeries(
  'number of canvases',
  (f) => repo.getNumberOfCanvases(f),
  (f, g) => repo.getNumberOfCanvasesTimeSeries(f, g),
);
export const numberOfCalls = countOrSeries(
  'number of calls',
  (f) => repo.getNumberOfCalls(f),
  (f, g) => repo.getNumberOfCallsTimeSeries(f, g),
);
export const totalCallsDuration = countOrSeries(
  'total calls duration',
  (f) => repo.getTotalCallsDuration(f),
  (f, g) => repo.getTotalCallsDurationTimeSeries(f, g),
);

/** Messages today is the caller's workspace only, whatever the time range. */
export const messagesToday = (input: Input) =>
  answer<number | { date: string; value: number }[]>('messages today', () => {
    const workspaceId = workspaceOf(input.user);
    return hourOrDay(input.query.groupBy) ? repo.getMessagesTodayTimeSeries(workspaceId) : repo.getMessagesToday(workspaceId);
  });

/** Users onboarded: only `groupBy=day` makes a series. */
export const usersOnboarded = (input: Input) =>
  answer<number | { date: string; value: number }[]>('users onboarded', () =>
    input.query.groupBy === 'day' ? repo.getUsersOnboardedTimeSeries(filtersOf(input)) : repo.getUsersOnboarded(filtersOf(input)),
  );

export const topUsersByMessages = (input: Input) =>
  answer('top users by messages', () =>
    repo.getTopUsersByMessages(filtersOf(input), input.query.limit ? parseInt(input.query.limit, 10) : 10), '');