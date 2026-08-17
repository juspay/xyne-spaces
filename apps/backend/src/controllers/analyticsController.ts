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
   * Get overview statistics
   * GET /api/analytics/overview?timeRange=7d&workflowType=all
   */
  getOverview = async (req: Request, res: Response): Promise<void> => {
    const filters = this.buildWorkspaceFilters(req, {
      workflowType: req.query.workflowType as string
    });
    return this.respond(
      res,
      'Error fetching analytics overview',
      'Failed to fetch analytics overview',
      () => this.analyticsRepository.getOverviewStats(filters),
    );
  };

  /**
   * Get workflow type statistics
   * GET /api/analytics/workflow-types?timeRange=7d&workflowType=all
   */
  getWorkflowTypes = async (req: Request, res: Response): Promise<void> => {
    const filters = this.buildWorkspaceFilters(req, {
      workflowType: req.query.workflowType as string
    });
    return this.respond(
      res,
      'Error fetching workflow types analytics',
      'Failed to fetch workflow types analytics',
      () => this.analyticsRepository.getWorkflowTypeStats(filters),
    );
  };

  /**
   * Get execution status distribution
   * GET /api/analytics/execution-status?timeRange=7d&workflowType=all
   */
  getExecutionStatus = async (req: Request, res: Response): Promise<void> => {
    const filters = this.buildWorkspaceFilters(req, {
      workflowType: req.query.workflowType as string
    });
    return this.respond(
      res,
      'Error fetching execution status analytics',
      'Failed to fetch execution status analytics',
      () => this.analyticsRepository.getExecutionStatusStats(filters),
    );
  };

  /**
   * Get step failure statistics
   * GET /api/analytics/step-failures?timeRange=7d&workflowType=all
   */
  getStepFailures = async (req: Request, res: Response): Promise<void> => {
    const filters = this.buildWorkspaceFilters(req, {
      workflowType: req.query.workflowType as string
    });
    return this.respond(
      res,
      'Error fetching step failures analytics',
      'Failed to fetch step failures analytics',
      () => this.analyticsRepository.getStepFailureStats(filters),
    );
  };

  /**
   * Get recent activity
   * GET /api/analytics/recent-activity?timeRange=7d&workflowType=all
   */
  getRecentActivity = async (req: Request, res: Response): Promise<void> => {
    const filters = this.buildWorkspaceFilters(req, {
      workflowType: req.query.workflowType as string
    });
    return this.respond(
      res,
      'Error fetching recent activity analytics',
      'Failed to fetch recent activity analytics',
      () => this.analyticsRepository.getRecentActivity(filters),
    );
  };

  /**
   * Get step funnel statistics
   * GET /api/analytics/step-funnel?timeRange=7d&workflowType=all
   */
  getStepFunnel = async (req: Request, res: Response): Promise<void> => {
    const filters = this.buildWorkspaceFilters(req, {
      workflowType: req.query.workflowType as string
    });
    return this.respond(
      res,
      'Error fetching step funnel analytics',
      'Failed to fetch step funnel analytics',
      () => this.analyticsRepository.getStepFunnelStats(filters),
    );
  };

  /**
   * Get all analytics data in one call (optional endpoint for efficiency)
   * GET /api/analytics/dashboard?timeRange=7d&workflowType=all
   */
  getDashboard = async (req: Request, res: Response): Promise<void> => {
    const filters = this.buildWorkspaceFilters(req, {
      workflowType: req.query.workflowType as string,
      repoName: req.query.repoName as string,
      userId: req.query.userId as string
    });
    return this.respond(
      res,
      'Error fetching analytics dashboard',
      'Failed to fetch analytics dashboard',
      async () => {
        // Fetch optimized analytics data in parallel
        const [
          executionStats,
          prMetrics
        ] = await Promise.all([
          this.analyticsRepository.getExecutionStats(filters),
          this.analyticsRepository.getPRMetrics(filters)
        ]);
        return {
          executionStats,
          prStats: prMetrics
        };
      },
      { filters },
    );
  };

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
   * Get available workflow types for filter dropdown
   * GET /api/analytics/workflow-types-options
   */
  getWorkflowTypeOptions = async (_req: Request, res: Response): Promise<void> => {
    return this.respond(
      res,
      'Error fetching workflow type options',
      'Failed to fetch workflow type options',
      () => this.analyticsRepository.getAvailableWorkflowTypes(),
    );
  };

  /**
   * Get available repositories for filter dropdown
   * GET /api/analytics/repository-options
   */
  getRepositoryOptions = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = this.getWorkspaceId(req);
    return this.respond(
      res,
      'Error fetching repository options',
      'Failed to fetch repository options',
      () => this.analyticsRepository.getAvailableRepositories(workspaceId),
    );
  };

  /**
   * Get available users for filter dropdown
   * GET /api/analytics/user-options
   */
  getUserOptions = async (req: Request, res: Response): Promise<void> => {
    const workspaceId = this.getWorkspaceId(req);
    return this.respond(
      res,
      'Error fetching user options',
      'Failed to fetch user options',
      () => this.analyticsRepository.getAvailableUsers(workspaceId),
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
    // Returns { uniqueUsers: number, timeSeries: TimeSeriesDataPoint[] }
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
