import { Request, Response } from 'express';
import { AnalyticsRepository, AnalyticsFilters } from '@/database/repositories/analyticsRepository';
import { messageCountService } from '@/services/messageCountService';
import { userCountService } from '@/services/userCountService';
import { callCountService } from '@/services/callCountService';
import { logger } from '@/utils/logger';

export class AnalyticsController {
  private analyticsRepository = new AnalyticsRepository();

  /**
   * Get overview statistics
   * GET /api/analytics/overview?timeRange=7d&workflowType=all
   */
  getOverview = async (req: Request, res: Response): Promise<void> => {
    try {
      const filters: AnalyticsFilters = {
        timeRange: req.query.timeRange as string,
        workflowType: req.query.workflowType as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string
      };

      const overview = await this.analyticsRepository.getOverviewStats(filters);

      res.json({
        success: true,
        data: overview,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error fetching analytics overview:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch analytics overview',
        timestamp: new Date().toISOString()
      });
    }
  };

  /**
   * Get workflow type statistics
   * GET /api/analytics/workflow-types?timeRange=7d&workflowType=all
   */
  getWorkflowTypes = async (req: Request, res: Response): Promise<void> => {
    try {
      const filters: AnalyticsFilters = {
        timeRange: req.query.timeRange as string,
        workflowType: req.query.workflowType as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string
      };

      const workflowTypes = await this.analyticsRepository.getWorkflowTypeStats(filters);

      res.json({
        success: true,
        data: workflowTypes,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error fetching workflow types analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch workflow types analytics',
        timestamp: new Date().toISOString()
      });
    }
  };

  /**
   * Get execution status distribution
   * GET /api/analytics/execution-status?timeRange=7d&workflowType=all
   */
  getExecutionStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const filters: AnalyticsFilters = {
        timeRange: req.query.timeRange as string,
        workflowType: req.query.workflowType as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string
      };

      const executionStatus = await this.analyticsRepository.getExecutionStatusStats(filters);

      res.json({
        success: true,
        data: executionStatus,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error fetching execution status analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch execution status analytics',
        timestamp: new Date().toISOString()
      });
    }
  };

  /**
   * Get step failure statistics
   * GET /api/analytics/step-failures?timeRange=7d&workflowType=all
   */
  getStepFailures = async (req: Request, res: Response): Promise<void> => {
    try {
      const filters: AnalyticsFilters = {
        timeRange: req.query.timeRange as string,
        workflowType: req.query.workflowType as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string
      };

      const stepFailures = await this.analyticsRepository.getStepFailureStats(filters);

      res.json({
        success: true,
        data: stepFailures,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error fetching step failures analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch step failures analytics',
        timestamp: new Date().toISOString()
      });
    }
  };

  /**
   * Get recent activity
   * GET /api/analytics/recent-activity?timeRange=7d&workflowType=all
   */
  getRecentActivity = async (req: Request, res: Response): Promise<void> => {
    try {
      const filters: AnalyticsFilters = {
        timeRange: req.query.timeRange as string,
        workflowType: req.query.workflowType as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string
      };

      const recentActivity = await this.analyticsRepository.getRecentActivity(filters);

      res.json({
        success: true,
        data: recentActivity,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error fetching recent activity analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch recent activity analytics',
        timestamp: new Date().toISOString()
      });
    }
  };

  /**
   * Get step funnel statistics
   * GET /api/analytics/step-funnel?timeRange=7d&workflowType=all
   */
  getStepFunnel = async (req: Request, res: Response): Promise<void> => {
    try {
      const filters: AnalyticsFilters = {
        timeRange: req.query.timeRange as string,
        workflowType: req.query.workflowType as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string
      };

      const stepFunnel = await this.analyticsRepository.getStepFunnelStats(filters);

      res.json({
        success: true,
        data: stepFunnel,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error fetching step funnel analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch step funnel analytics',
        timestamp: new Date().toISOString()
      });
    }
  };

  /**
   * Get all analytics data in one call (optional endpoint for efficiency)
   * GET /api/analytics/dashboard?timeRange=7d&workflowType=all
   */
  getDashboard = async (req: Request, res: Response): Promise<void> => {
    try {
      const filters: AnalyticsFilters = {
        timeRange: req.query.timeRange as string,
        workflowType: req.query.workflowType as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        repoName: req.query.repoName as string,
        userId: req.query.userId as string
      };

      // Fetch optimized analytics data in parallel
      const [
        executionStats,
        prMetrics
      ] = await Promise.all([
        this.analyticsRepository.getExecutionStats(filters),
        this.analyticsRepository.getPRMetrics(filters)
      ]);

      res.json({
        success: true,
        data: {
          executionStats,
          prStats: prMetrics
        },
        filters,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error fetching analytics dashboard:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch analytics dashboard',
        timestamp: new Date().toISOString()
      });
    }
  };

  /**
   * Get available workflow types for filter dropdown
   * GET /api/analytics/workflow-types-options
   */
  getWorkflowTypeOptions = async (_req: Request, res: Response): Promise<void> => {
    try {
      const workflowTypes = await this.analyticsRepository.getAvailableWorkflowTypes();

      res.json({
        success: true,
        data: workflowTypes,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error fetching workflow type options:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch workflow type options',
        timestamp: new Date().toISOString()
      });
    }
  };

  /**
   * Get available repositories for filter dropdown
   * GET /api/analytics/repository-options
   */
  getRepositoryOptions = async (_req: Request, res: Response): Promise<void> => {
    try {
      const repositories = await this.analyticsRepository.getAvailableRepositories();

      res.json({
        success: true,
        data: repositories,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error fetching repository options:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch repository options',
        timestamp: new Date().toISOString()
      });
    }
  };

  /**
   * Get available users for filter dropdown
   * GET /api/analytics/user-options
   */
  getUserOptions = async (_req: Request, res: Response): Promise<void> => {
    try {
      const users = await this.analyticsRepository.getAvailableUsers();

      res.json({
        success: true,
        data: users,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error fetching user options:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch user options',
        timestamp: new Date().toISOString()
      });
    }
  };

  /**
   * Get messages exchanged statistics (returns time-series data)
   * GET /api/analytics/messages-exchanged?timeRange=7d
   */
  getMessagesExchanged = async (req: Request, res: Response): Promise<void> => {
    try {
      const filters: AnalyticsFilters = {
        timeRange: req.query.timeRange as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      };

      // Always return time-series data for consistency
      const messagesExchanged = await this.analyticsRepository.getMessagesExchanged(filters);
      
      res.json({
        success: true,
        data: messagesExchanged,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error fetching messages exchanged analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch messages exchanged analytics',
        timestamp: new Date().toISOString(),
      });
    }
  };

  /**
   * Get active users statistics  
   * GET /api/analytics/active-users?timeRange=7d (always returns both unique count and time-series in single response)
   */
  getActiveUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const filters: AnalyticsFilters = {
        timeRange: req.query.timeRange as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      };

      // Always return both unique count and time-series data in a single response
      const result = await this.analyticsRepository.getActiveUsersWithChart(filters);
      
      res.json({
        success: true,
        data: result, // Returns { uniqueUsers: number, timeSeries: TimeSeriesDataPoint[] }
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error fetching active users analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch active users analytics',
        timestamp: new Date().toISOString(),
      });
    }
  };


  /**
   * Get current active users grouped by presence status
   * GET /api/analytics/current-active-users
   */
  getCurrentActiveUsers = async (_req: Request, res: Response): Promise<void> => {
    try {
      const currentActiveUsers = await this.analyticsRepository.getCurrentActiveUsers();

      res.json({
        success: true,
        data: currentActiveUsers,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error fetching current active users analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch current active users analytics',
        timestamp: new Date().toISOString(),
      });
    }
  };

  /**
   * Get active channels statistics
   * GET /api/analytics/active-channels?timeRange=7d&groupBy=day (uses correct methods for stat vs chart)
   */
  getActiveChannels = async (req: Request, res: Response): Promise<void> => {
    try {
      const groupBy = req.query.groupBy as 'day' | undefined;
      
      const filters: AnalyticsFilters = {
        timeRange: req.query.timeRange as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      };

      // If groupBy is specified, return time-series data for charts
      if (groupBy === 'day') {
        const activeChannelsTimeSeries = await this.analyticsRepository.getActiveChannelsTimeSeries(filters);
        
        res.json({
          success: true,
          data: activeChannelsTimeSeries,
          timestamp: new Date().toISOString(),
        });
      } else {
        // For stat card: return unique channels count using efficient database aggregation
        const uniqueActiveChannels = await this.analyticsRepository.getActiveChannels(filters);
        
        res.json({
          success: true,
          data: uniqueActiveChannels,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error('Error fetching active channels analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch active channels analytics',
        timestamp: new Date().toISOString(),
      });
    }
  };

  /**
   * Get files shared statistics
   * GET /api/analytics/files-shared?timeRange=7d&groupBy=day (supports time-series for charts)
   */
  getFilesShared = async (req: Request, res: Response): Promise<void> => {
    try {
      const groupBy = req.query.groupBy as 'day' | undefined;
      
      const filters: AnalyticsFilters = {
        timeRange: req.query.timeRange as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      };

      // If groupBy is specified, return time-series data for charts
      if (groupBy === 'day') {
        const filesSharedTimeSeries = await this.analyticsRepository.getFilesSharedTimeSeries(filters);
        
        res.json({
          success: true,
          data: filesSharedTimeSeries,
          timestamp: new Date().toISOString(),
        });
      } else {
        // Otherwise, return aggregate count
        const filesShared = await this.analyticsRepository.getFilesShared(filters);
        
        res.json({
          success: true,
          data: filesShared,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error('Error fetching files shared analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch files shared analytics',
        timestamp: new Date().toISOString(),
      });
    }
  };

  /**
   * Get messages today statistics
   * GET /api/analytics/messages-today?groupBy=day (supports time-series for hourly chart)
   */
  getMessagesToday = async (req: Request, res: Response): Promise<void> => {
    try {
      const groupBy = req.query.groupBy as 'day' | undefined;

      // If groupBy is specified, return time-series data (hourly breakdown)
      if (groupBy === 'day') {
        const messagesTodayTimeSeries = await this.analyticsRepository.getMessagesTodayTimeSeries();
        
        res.json({
          success: true,
          data: messagesTodayTimeSeries,
          timestamp: new Date().toISOString(),
        });
      } else {
        // Otherwise, return aggregate count from Redis cache
        const messagesToday = await messageCountService.getTodayCount();
        
        res.json({
          success: true,
          data: messagesToday,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error('Error fetching messages today analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch messages today analytics',
        timestamp: new Date().toISOString(),
      });
    }
  };

  /**
   * Get number of tickets statistics
   * GET /api/analytics/number-of-tickets?timeRange=7d&groupBy=day (supports time-series for charts)
   */
  getNumberOfTickets = async (req: Request, res: Response): Promise<void> => {
    try {
      const groupBy = req.query.groupBy as 'day' | undefined;
      
      const filters: AnalyticsFilters = {
        timeRange: req.query.timeRange as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      };

      // If groupBy is specified, return time-series data for charts
      if (groupBy === 'day') {
        const ticketsTimeSeries = await this.analyticsRepository.getNumberOfTicketsTimeSeries(filters);
        
        res.json({
          success: true,
          data: ticketsTimeSeries,
          timestamp: new Date().toISOString(),
        });
      } else {
        // Otherwise, return aggregate count
        const ticketsCount = await this.analyticsRepository.getNumberOfTickets(filters);
        
        res.json({
          success: true,
          data: ticketsCount,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error('Error fetching number of tickets analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch number of tickets analytics',
        timestamp: new Date().toISOString(),
      });
    }
  };

  /**
   * Get number of canvases statistics
   * GET /api/analytics/number-of-canvases?timeRange=7d&groupBy=day (supports time-series for charts)
   */
  getNumberOfCanvases = async (req: Request, res: Response): Promise<void> => {
    try {
      const groupBy = req.query.groupBy as 'day' | undefined;
      
      const filters: AnalyticsFilters = {
        timeRange: req.query.timeRange as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      };

      // If groupBy is specified, return time-series data for charts
      if (groupBy === 'day') {
        const canvasesTimeSeries = await this.analyticsRepository.getNumberOfCanvasesTimeSeries(filters);
        
        res.json({
          success: true,
          data: canvasesTimeSeries,
          timestamp: new Date().toISOString(),
        });
      } else {
        // Otherwise, return aggregate count
        const canvasesCount = await this.analyticsRepository.getNumberOfCanvases(filters);
        
        res.json({
          success: true,
          data: canvasesCount,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error('Error fetching number of canvases analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch number of canvases analytics',
        timestamp: new Date().toISOString(),
      });
    }
  };

  /**
   * Get number of calls statistics
   * GET /api/analytics/number-of-calls?timeRange=7d&groupBy=day (supports time-series for charts)
   */
  getNumberOfCalls = async (req: Request, res: Response): Promise<void> => {
    try {
      const groupBy = req.query.groupBy as 'day' | undefined;
      
      const filters: AnalyticsFilters = {
        timeRange: req.query.timeRange as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      };

      // If groupBy is specified, return time-series data for charts
      if (groupBy === 'day') {
        const callsTimeSeries = await this.analyticsRepository.getNumberOfCallsTimeSeries(filters);
        
        res.json({
          success: true,
          data: callsTimeSeries,
          timestamp: new Date().toISOString(),
        });
      } else {
        // Otherwise, return aggregate count
        const callsCount = await this.analyticsRepository.getNumberOfCalls(filters);
        
        res.json({
          success: true,
          data: callsCount,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error('Error fetching number of calls analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch number of calls analytics',
        timestamp: new Date().toISOString(),
      });
    }
  };

  /**
   * Get total duration of calls statistics (in seconds)
   * GET /api/analytics/total-calls-duration?timeRange=7d&groupBy=day (supports time-series for charts)
   */
  getTotalCallsDuration = async (req: Request, res: Response): Promise<void> => {
    try {
      const groupBy = req.query.groupBy as 'day' | undefined;
      
      const filters: AnalyticsFilters = {
        timeRange: req.query.timeRange as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      };

      // If groupBy is specified, return time-series data for charts
      if (groupBy === 'day') {
        const durationTimeSeries = await this.analyticsRepository.getTotalCallsDurationTimeSeries(filters);
        
        res.json({
          success: true,
          data: durationTimeSeries,
          timestamp: new Date().toISOString(),
        });
      } else {
        // Otherwise, return aggregate total duration
        const totalDuration = await this.analyticsRepository.getTotalCallsDuration(filters);
        
        res.json({
          success: true,
          data: totalDuration,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error('Error fetching total calls duration analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch total calls duration analytics',
        timestamp: new Date().toISOString(),
      });
    }
  };

  /**
   * Get top users by message count
   * GET /api/analytics/top-users-by-messages?timeRange=7d&limit=10
   */
  getTopUsersByMessages = async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
      
      const filters: AnalyticsFilters = {
        timeRange: req.query.timeRange as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      };

      const topUsers = await this.analyticsRepository.getTopUsersByMessages(filters, limit);
      
      res.json({
        success: true,
        data: topUsers,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error fetching top users by messages:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch top users by messages',
        timestamp: new Date().toISOString(),
      });
    }
  };

  /**
   * Get users onboarded statistics
   * GET /api/analytics/users-onboarded?timeRange=7d&groupBy=day (supports time-series for charts)
   */
  getUsersOnboarded = async (req: Request, res: Response): Promise<void> => {
    try {
      const groupBy = req.query.groupBy as 'day' | undefined;
      
      const filters: AnalyticsFilters = {
        timeRange: req.query.timeRange as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      };

      // If groupBy is specified, return time-series data for charts
      if (groupBy === 'day') {
        const usersOnboardedTimeSeries = await this.analyticsRepository.getUsersOnboardedTimeSeries(filters);
        
        res.json({
          success: true,
          data: usersOnboardedTimeSeries,
          timestamp: new Date().toISOString(),
        });
      } else {
        // Otherwise, return aggregate count
        const usersOnboarded = await this.analyticsRepository.getUsersOnboarded(filters);
        
        res.json({
          success: true,
          data: usersOnboarded,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      logger.error('Error fetching users onboarded analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch users onboarded analytics',
        timestamp: new Date().toISOString(),
      });
    }
  };

  /**
   * Get all metrics bar data in a single endpoint
   * GET /api/analytics/metrics-bar
   * Returns: messages (today/allTime), users (today/allTime), calls (today/allTime), callDuration (today/allTime)
   */
  getMetricsBar = async (_req: Request, res: Response): Promise<void> => {
    try {
      // Fetch all metrics in parallel for better performance
      const [
        messagesToday,
        messagesAllTime,
        usersToday,
        usersAllTime,
        callsToday,
        callsAllTime,
        callsDurationToday,
        callsDurationAllTime,
      ] = await Promise.all([
        messageCountService.getTodayCount(),
        messageCountService.getAllTimeCount(),
        userCountService.getTodayCount(),
        userCountService.getAllTimeCount(),
        callCountService.getTodayCount(),
        callCountService.getAllTimeCount(),
        callCountService.getTodayDuration(),
        callCountService.getAllTimeDuration(),
      ]);

      res.json({
        success: true,
        data: {
          messages: {
            today: messagesToday,
            allTime: messagesAllTime,
          },
          users: {
            today: usersToday,
            allTime: usersAllTime,
          },
          calls: {
            today: callsToday,
            allTime: callsAllTime,
          },
          callsDuration: {
            today: callsDurationToday,
            allTime: callsDurationAllTime,
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error fetching metrics bar analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch metrics bar analytics',
        timestamp: new Date().toISOString(),
      });
    }
  };
}