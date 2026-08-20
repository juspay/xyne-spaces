import { Request, Response } from 'express';
import { AnalyticsRepository, AnalyticsFilters } from '@/database/repositories/analyticsRepository';
import { logger } from '@/utils/logger';

export class AnalyticsController {
  private analyticsRepository = new AnalyticsRepository();

  private buildWorkspaceFilters(
    req: Request,
    extraFilters: Partial<AnalyticsFilters> = {}
  ): AnalyticsFilters {
    return {
      timeRange: req.query.timeRange as string,
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      ...extraFilters,
      workspaceId: req.user!.workspaceId!
    };
  }

  private getWorkspaceId(req: Request): string {
    return req.user!.workspaceId!;
  }

  private groupByParam(req: Request): 'day' | 'hour' | undefined {
    return req.query.groupBy as 'day' | 'hour' | undefined;
  }

  /**
   * Run `produce`, wrap its result in the standard success envelope, and send it.
   * On failure, log with `logLabel` and reply with the standard 500 envelope
   * carrying `errorMessage`. `extra` merges extra top-level keys (e.g. `filters`)
   * between `data` and `timestamp`, preserving the previous response shape.
   */
  private async respond(
    res: Response,
    logLabel: string,
    errorMessage: string,
    produce: () => Promise<unknown>,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const data = await produce();
      res.json({
        success: true,
        data,
        ...(extra ?? {}),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(`${logLabel}:`, error);
      res.status(500).json({
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Endpoints that return per-bucket time-series when `groupBy` is day/hour and
   * an aggregate value otherwise. Preserves the exact branch: time-series only
   * for an explicit day|hour groupBy, aggregate for everything else.
   */
  private async respondCountOrTimeSeries(
    res: Response,
    groupBy: 'day' | 'hour' | undefined,
    logLabel: string,
    errorMessage: string,
    timeSeries: (groupBy: 'day' | 'hour') => Promise<unknown>,
    aggregate: () => Promise<unknown>,
  ): Promise<void> {
    return this.respond(res, logLabel, errorMessage, () =>
      groupBy === 'day' || groupBy === 'hour' ? timeSeries(groupBy) : aggregate()
    );
  }

  /**
   * Get workflow metrics (grouped raw execution statuses)
   * GET /api/analytics/workflow-metrics?timeRange=7d
   */
  getWorkflowMetrics = async (req: Request, res: Response): Promise<void> => {
    const filters = this.buildWorkspaceFilters(req);
    return this.respond(
      res,
      'Error fetching workflow metrics analytics',
      'Failed to fetch workflow metrics analytics',
      () => this.analyticsRepository.getWorkflowMetrics(filters),
    );
  };

  /**
   * Get messages exchanged statistics (returns time-series data)
   * GET /api/analytics/messages-exchanged?timeRange=7d
   */
  getMessagesExchanged = async (req: Request, res: Response): Promise<void> => {
    const groupBy = this.groupByParam(req) ?? 'day';
    const filters = this.buildWorkspaceFilters(req);
    // Always return time-series data for consistency
    return this.respond(
      res,
      'Error fetching messages exchanged analytics',
      'Failed to fetch messages exchanged analytics',
      () => this.analyticsRepository.getMessagesExchanged(filters, groupBy),
    );
  };

  /**
   * Get active users statistics
   * GET /api/analytics/active-users?timeRange=7d (always returns both unique count and time-series in single response)
   */
  getActiveUsers = async (req: Request, res: Response): Promise<void> => {
    const groupBy = this.groupByParam(req) ?? 'day';
    const filters = this.buildWorkspaceFilters(req);
    // Always return both unique count and time-series data in a single response
    // Returns { uniqueUsers: number, timeSeries: { date: string; value: number }[] }
    return this.respond(
      res,
      'Error fetching active users analytics',
      'Failed to fetch active users analytics',
      () => this.analyticsRepository.getActiveUsersWithChart(filters, groupBy),
    );
  };

  /**
   * Get current active users grouped by presence status
   * GET /api/analytics/current-active-users
   */
  getCurrentActiveUsers = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = this.getWorkspaceId(req);
    return this.respond(
      res,
      'Error fetching current active users analytics',
      'Failed to fetch current active users analytics',
      () => this.analyticsRepository.getCurrentActiveUsers(workspaceId),
    );
  };

  /**
   * Get active channels statistics
   * GET /api/analytics/active-channels?timeRange=7d&groupBy=day (uses correct methods for stat vs chart)
   */
  getActiveChannels = async (req: Request, res: Response): Promise<void> => {
    const groupBy = this.groupByParam(req);
    const filters = this.buildWorkspaceFilters(req);
    return this.respondCountOrTimeSeries(
      res,
      groupBy,
      'Error fetching active channels analytics',
      'Failed to fetch active channels analytics',
      // If groupBy is specified, return time-series data for charts
      (gb) => this.analyticsRepository.getActiveChannelsTimeSeries(filters, gb),
      // For stat card: return unique channels count using efficient database aggregation
      () => this.analyticsRepository.getActiveChannels(filters),
    );
  };

  /**
   * Get files shared statistics
   * GET /api/analytics/files-shared?timeRange=7d&groupBy=day (supports time-series for charts)
   */
  getFilesShared = async (req: Request, res: Response): Promise<void> => {
    const groupBy = this.groupByParam(req);
    const filters = this.buildWorkspaceFilters(req);
    return this.respondCountOrTimeSeries(
      res,
      groupBy,
      'Error fetching files shared analytics',
      'Failed to fetch files shared analytics',
      (gb) => this.analyticsRepository.getFilesSharedTimeSeries(filters, gb),
      () => this.analyticsRepository.getFilesShared(filters),
    );
  };

  /**
   * Get messages today statistics
   * GET /api/analytics/messages-today?groupBy=day (supports time-series for hourly chart)
   */
  getMessagesToday = async (req: Request, res: Response): Promise<void> => {
    const groupBy = this.groupByParam(req);
    const workspaceId = this.getWorkspaceId(req);
    return this.respondCountOrTimeSeries(
      res,
      groupBy,
      'Error fetching messages today analytics',
      'Failed to fetch messages today analytics',
      // Time-series is an hourly breakdown for today; groupBy only gates the branch
      () => this.analyticsRepository.getMessagesTodayTimeSeries(workspaceId),
      // Aggregate count scoped to the caller's current workspace
      () => this.analyticsRepository.getMessagesToday(workspaceId),
    );
  };

  /**
   * Get number of tickets statistics
   * GET /api/analytics/number-of-tickets?timeRange=7d&groupBy=day (supports time-series for charts)
   */
  getNumberOfTickets = async (req: Request, res: Response): Promise<void> => {
    const groupBy = this.groupByParam(req);
    const filters = this.buildWorkspaceFilters(req);
    return this.respondCountOrTimeSeries(
      res,
      groupBy,
      'Error fetching number of tickets analytics',
      'Failed to fetch number of tickets analytics',
      (gb) => this.analyticsRepository.getNumberOfTicketsTimeSeries(filters, gb),
      () => this.analyticsRepository.getNumberOfTickets(filters),
    );
  };

  /**
   * Get number of canvases statistics
   * GET /api/analytics/number-of-canvases?timeRange=7d&groupBy=day (supports time-series for charts)
   */
  getNumberOfCanvases = async (req: Request, res: Response): Promise<void> => {
    const groupBy = this.groupByParam(req);
    const filters = this.buildWorkspaceFilters(req);
    return this.respondCountOrTimeSeries(
      res,
      groupBy,
      'Error fetching number of canvases analytics',
      'Failed to fetch number of canvases analytics',
      (gb) => this.analyticsRepository.getNumberOfCanvasesTimeSeries(filters, gb),
      () => this.analyticsRepository.getNumberOfCanvases(filters),
    );
  };

  /**
   * Get number of calls statistics
   * GET /api/analytics/number-of-calls?timeRange=7d&groupBy=day (supports time-series for charts)
   */
  getNumberOfCalls = async (req: Request, res: Response): Promise<void> => {
    const groupBy = this.groupByParam(req);
    const filters = this.buildWorkspaceFilters(req);
    return this.respondCountOrTimeSeries(
      res,
      groupBy,
      'Error fetching number of calls analytics',
      'Failed to fetch number of calls analytics',
      (gb) => this.analyticsRepository.getNumberOfCallsTimeSeries(filters, gb),
      () => this.analyticsRepository.getNumberOfCalls(filters),
    );
  };

  /**
   * Get total duration of calls statistics (in seconds)
   * GET /api/analytics/total-calls-duration?timeRange=7d&groupBy=day (supports time-series for charts)
   */
  getTotalCallsDuration = async (req: Request, res: Response): Promise<void> => {
    const groupBy = this.groupByParam(req);
    const filters = this.buildWorkspaceFilters(req);
    return this.respondCountOrTimeSeries(
      res,
      groupBy,
      'Error fetching total calls duration analytics',
      'Failed to fetch total calls duration analytics',
      (gb) => this.analyticsRepository.getTotalCallsDurationTimeSeries(filters, gb),
      () => this.analyticsRepository.getTotalCallsDuration(filters),
    );
  };

  /**
   * Get top users by message count
   * GET /api/analytics/top-users-by-messages?timeRange=7d&limit=10
   */
  getTopUsersByMessages = async (req: Request, res: Response): Promise<void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
    const filters = this.buildWorkspaceFilters(req);
    return this.respond(
      res,
      'Error fetching top users by messages',
      'Failed to fetch top users by messages',
      () => this.analyticsRepository.getTopUsersByMessages(filters, limit),
    );
  };

  /**
   * Get users onboarded statistics
   * GET /api/analytics/users-onboarded?timeRange=7d&groupBy=day (supports time-series for charts)
   */
  getUsersOnboarded = async (req: Request, res: Response): Promise<void> => {
    const groupBy = req.query.groupBy as 'day' | undefined;
    const filters = this.buildWorkspaceFilters(req);
    // Users-onboarded only supports a daily series, so gate strictly on 'day'
    // (an explicit 'hour' still falls through to the aggregate, as before).
    return this.respond(
      res,
      'Error fetching users onboarded analytics',
      'Failed to fetch users onboarded analytics',
      () => groupBy === 'day'
        ? this.analyticsRepository.getUsersOnboardedTimeSeries(filters)
        : this.analyticsRepository.getUsersOnboarded(filters),
    );
  };

}
