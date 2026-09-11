import { apiInstance } from '../clients/apiClient';

export interface TimeRangeParams {
  timeRange: string;
  startDate?: string;
  endDate?: string;
  groupBy: 'hour' | 'day' | 'week' | 'month';
}

export interface AnalyticsResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

export interface MessagesExchangedData {
  channelType: string;
  totalMessages: number;
}

export interface CurrentActiveUsersData {
  userStatus: string;
  userCount: number;
  percentage: number;
}

export interface TimeSeriesDataPoint {
  date: string;
  value: number;
  channelMessages?: number;
  dmMessages?: number;
  groupDmMessages?: number;
}

/** Calls and recordings come from the same table, split by callType (HEADLESS = recording) */
export interface CallsBreakdown {
  calls: number;
  recordings: number;
}

/** A /number-of-calls bucket - call and recording counts for that bucket */
export interface CallsTimeSeriesPoint {
  date: string;
  calls: number;
  recordings: number;
}

export interface ActiveUsersResponse {
  uniqueUsers: number;
  timeSeries: TimeSeriesDataPoint[];
}

export interface NumericWithChartResponse {
  total: number;
  timeSeries: TimeSeriesDataPoint[];
}

export interface PermissionCheck {
  hasAccess: boolean;
}

export interface WorkflowMetricGroup {
  workflowType: string | null;
  status: string;
  _count: {
    id: number;
  };
}

class AnalyticsService {
  async getMessagesExchanged(
    params: TimeRangeParams,
  ): Promise<AnalyticsResponse<TimeSeriesDataPoint[]>> {
    const response = await apiInstance.get<AnalyticsResponse<TimeSeriesDataPoint[]>>(
      '/analytics/messages-exchanged',
      { params },
    );
    return response.data;
  }

  async getWorkflowMetrics(
    params: TimeRangeParams,
  ): Promise<AnalyticsResponse<WorkflowMetricGroup[]>> {
    const response = await apiInstance.get<AnalyticsResponse<WorkflowMetricGroup[]>>(
      '/tickets/workflow-metrics',
      { params },
    );
    return response.data;
  }

  async getActiveUsers(params: TimeRangeParams): Promise<AnalyticsResponse<ActiveUsersResponse>> {
    const response = await apiInstance.get<AnalyticsResponse<ActiveUsersResponse>>(
      '/analytics/active-users',
      { params },
    );
    return response.data;
  }

  async getCurrentActiveUsers(): Promise<AnalyticsResponse<CurrentActiveUsersData[]>> {
    const response = await apiInstance.get<AnalyticsResponse<CurrentActiveUsersData[]>>(
      '/analytics/current-active-users',
    );
    return response.data;
  }

  async getActiveChannels(
    params: TimeRangeParams,
  ): Promise<AnalyticsResponse<number | TimeSeriesDataPoint[]>> {
    const response = await apiInstance.get<AnalyticsResponse<number | TimeSeriesDataPoint[]>>(
      '/analytics/active-channels',
      { params },
    );
    return response.data;
  }

  async getFilesShared(
    params: TimeRangeParams,
  ): Promise<AnalyticsResponse<number | TimeSeriesDataPoint[]>> {
    const response = await apiInstance.get<AnalyticsResponse<number | TimeSeriesDataPoint[]>>(
      '/analytics/files-shared',
      { params },
    );
    return response.data;
  }

  async getUsersOnboarded(
    params: TimeRangeParams,
  ): Promise<AnalyticsResponse<number | TimeSeriesDataPoint[]>> {
    const response = await apiInstance.get<AnalyticsResponse<number | TimeSeriesDataPoint[]>>(
      '/analytics/users-onboarded',
      { params },
    );
    return response.data;
  }

  async getMessagesToday(
    params: TimeRangeParams,
  ): Promise<AnalyticsResponse<number | TimeSeriesDataPoint[]>> {
    const response = await apiInstance.get<AnalyticsResponse<number | TimeSeriesDataPoint[]>>(
      '/analytics/messages-today',
      { params },
    );
    return response.data;
  }

  async getNumberOfTickets(
    params: TimeRangeParams,
  ): Promise<AnalyticsResponse<number | TimeSeriesDataPoint[]>> {
    const response = await apiInstance.get<AnalyticsResponse<number | TimeSeriesDataPoint[]>>(
      '/analytics/number-of-tickets',
      { params },
    );
    return response.data;
  }

  async getNumberOfCanvases(
    params: TimeRangeParams,
  ): Promise<AnalyticsResponse<number | TimeSeriesDataPoint[]>> {
    const response = await apiInstance.get<AnalyticsResponse<number | TimeSeriesDataPoint[]>>(
      '/analytics/number-of-canvases',
      { params },
    );
    return response.data;
  }

  /** Returns calls and recordings together - they differ only by callType (HEADLESS = recording) */
  async getNumberOfCalls(
    params: TimeRangeParams,
  ): Promise<AnalyticsResponse<CallsBreakdown | CallsTimeSeriesPoint[]>> {
    const response = await apiInstance.get<
      AnalyticsResponse<CallsBreakdown | CallsTimeSeriesPoint[]>
    >('/analytics/number-of-calls', { params });
    return response.data;
  }

  async getTotalCallsDuration(
    params: TimeRangeParams,
  ): Promise<AnalyticsResponse<number | TimeSeriesDataPoint[]>> {
    const response = await apiInstance.get<AnalyticsResponse<number | TimeSeriesDataPoint[]>>(
      '/analytics/total-calls-duration',
      { params },
    );
    return response.data;
  }

  async getTopUsersByMessages(
    params: TimeRangeParams,
    limit: number = 10,
  ): Promise<AnalyticsResponse<{ userId: string; userName: string; messageCount: number }[]>> {
    const response = await apiInstance.get<
      AnalyticsResponse<{ userId: string; userName: string; messageCount: number }[]>
    >('/analytics/top-users-by-messages', {
      params: { ...params, limit },
    });
    return response.data;
  }

  /**
   * Check if the current user has access to analytics
   */
  async checkAnalyticsAccess(): Promise<PermissionCheck> {
    try {
      const response = await apiInstance.get<AnalyticsResponse<MessagesExchangedData[]>>(
        '/analytics/messages-exchanged',
        {
          params: { timeRange: 'today' },
          // Don't throw on 4xx status codes for permission check
          validateStatus: status => status < 500,
        },
      );

      // If request succeeds, user has access
      return { hasAccess: response.status === 200 };
    } catch {
      // Network or other errors - assume no access for security
      return { hasAccess: false };
    }
  }
}

export const analyticsService = new AnalyticsService();
