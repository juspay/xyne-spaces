import {
  MessagesExchangedData,
  CallsBreakdown,
  CallsTimeSeriesPoint,
  CurrentActiveUsersData,
  TimeSeriesDataPoint,
  AnalyticsResponse,
  TimeRangeParams,
  ActiveUsersResponse,
} from '../../services/Analytics/analyticsService';
import { GroupByOption, formatChartDate } from '../../utils/dateRangeUtils';
import { DateRange } from '@juspay/blend-design-system';

export const processNumericMetric = (
  data: number | TimeSeriesDataPoint[] | ActiveUsersResponse | undefined,
  isLoading: boolean,
  error: unknown,
  isAverage = false,
): string => {
  if (isLoading) return 'Loading...';
  if (error) {
    return error instanceof Error ? error.message : 'Error occurred';
  }
  if (data === undefined) return 'N/A';

  // Handle different data types
  let numericValue: number;
  if (Array.isArray(data)) {
    // Sum up all values from time-series data
    numericValue = data.reduce((sum, item) => sum + (item.value || 0), 0);
  } else if (typeof data === 'number') {
    numericValue = data;
  } else if (typeof data === 'object' && data !== null && 'uniqueUsers' in data) {
    // Handle ActiveUsersResponse structure
    numericValue = data.uniqueUsers;
  } else {
    // Handle other unexpected data types
    return 'N/A';
  }

  return isAverage ? numericValue.toFixed(1) : numericValue.toLocaleString();
};

export const processTimeSeriesData = (
  data: TimeSeriesDataPoint[] | undefined,
  groupBy: GroupByOption,
): Array<{ value: number; name: string }> => {
  if (!data || !Array.isArray(data) || groupBy === 'none') return [];

  return data.map(item => ({
    value: item.value || 0,
    name: formatChartDate(item.date, groupBy),
  }));
};

export const processMessagesExchangedData = (
  data: MessagesExchangedData[] | TimeSeriesDataPoint[] | undefined,
  isLoading: boolean,
  error: unknown,
  groupBy: GroupByOption,
): {
  total: number;
  channel: number;
  dm: number;
  groupDm: number;
  totalChartData: Array<{ value: number; name: string }>;
  channelChartData: Array<{ value: number; name: string }>;
  dmChartData: Array<{ value: number; name: string }>;
  groupDmChartData: Array<{ value: number; name: string }>;
  isLoading: boolean;
  error: unknown;
} => {
  if (isLoading) {
    return {
      total: 0,
      channel: 0,
      dm: 0,
      groupDm: 0,
      totalChartData: [],
      channelChartData: [],
      dmChartData: [],
      groupDmChartData: [],
      isLoading: true,
      error: null,
    };
  }

  if (error) {
    return {
      total: 0,
      channel: 0,
      dm: 0,
      groupDm: 0,
      totalChartData: [],
      channelChartData: [],
      dmChartData: [],
      groupDmChartData: [],
      isLoading: false,
      error: error,
    };
  }

  if (!data || !Array.isArray(data)) {
    return {
      total: 0,
      channel: 0,
      dm: 0,
      groupDm: 0,
      totalChartData: [],
      channelChartData: [],
      dmChartData: [],
      groupDmChartData: [],
      isLoading: false,
      error: null,
    };
  }

  let total = 0;
  let channel = 0;
  let dm = 0;
  let groupDm = 0;
  const totalChartData: Array<{ value: number; name: string }> = [];
  const channelChartData: Array<{ value: number; name: string }> = [];
  const dmChartData: Array<{ value: number; name: string }> = [];
  const groupDmChartData: Array<{ value: number; name: string }> = [];

  // Check if we have time-series data
  if (
    groupBy !== 'none' &&
    data.length > 0 &&
    data[0] &&
    typeof data[0] === 'object' &&
    'date' in data[0]
  ) {
    const timeSeriesData = data as TimeSeriesDataPoint[];
    timeSeriesData.forEach(item => {
      total += item.value || 0;
      channel += item.channelMessages || 0;
      dm += item.dmMessages || 0;
      groupDm += item.groupDmMessages || 0;

      const formattedDate = formatChartDate(item.date, groupBy);
      totalChartData.push({ value: item.value || 0, name: formattedDate });
      channelChartData.push({ value: item.channelMessages || 0, name: formattedDate });
      dmChartData.push({ value: item.dmMessages || 0, name: formattedDate });
      groupDmChartData.push({ value: item.groupDmMessages || 0, name: formattedDate });
    });
  }
  // If condition fails (e.g., empty array), variables remain at initialized zeros

  return {
    total,
    channel,
    dm,
    groupDm,
    totalChartData,
    channelChartData,
    dmChartData,
    groupDmChartData,
    isLoading: false,
    error: null,
  };
};

/**
 * Unpacks the /number-of-calls payload into its two cards - calls and note taker
 * recordings - which the backend returns together since they share the calls table
 */
export const processCallsData = (
  data: CallsBreakdown | CallsTimeSeriesPoint[] | undefined,
  isLoading: boolean,
  error: unknown,
  groupBy: GroupByOption,
): {
  calls: number;
  recordings: number;
  callsChartData: Array<{ value: number; name: string }>;
  recordingsChartData: Array<{ value: number; name: string }>;
  isLoading: boolean;
  error: unknown;
} => {
  const empty = {
    calls: 0,
    recordings: 0,
    callsChartData: [],
    recordingsChartData: [],
  };

  if (isLoading) return { ...empty, isLoading: true, error: null };
  if (error) return { ...empty, isLoading: false, error };
  if (!data) return { ...empty, isLoading: false, error: null };

  // Aggregate payload - returned when no time-series groupBy was requested
  if (!Array.isArray(data)) {
    return {
      ...empty,
      calls: data.calls || 0,
      recordings: data.recordings || 0,
      isLoading: false,
      error: null,
    };
  }

  let calls = 0;
  let recordings = 0;
  const callsChartData: Array<{ value: number; name: string }> = [];
  const recordingsChartData: Array<{ value: number; name: string }> = [];

  if (groupBy !== 'none') {
    data.forEach(item => {
      calls += item.calls || 0;
      recordings += item.recordings || 0;

      const formattedDate = formatChartDate(item.date, groupBy);
      callsChartData.push({ value: item.calls || 0, name: formattedDate });
      recordingsChartData.push({ value: item.recordings || 0, name: formattedDate });
    });
  }

  return { calls, recordings, callsChartData, recordingsChartData, isLoading: false, error: null };
};

export const processCurrentActiveUsersData = (
  data: CurrentActiveUsersData[] | undefined,
  isLoading: boolean,
  error: unknown,
): {
  chartData: Array<{
    name: string;
    data: Record<string, { primary: { label: string; val: number } }>;
  }>;
  hasError: boolean;
  errorMessage: string;
} => {
  if (isLoading) {
    return {
      chartData: [{ name: 'Currently Online Users', data: {} }],
      hasError: false,
      errorMessage: '',
    };
  }

  if (error) {
    const errorMessage = error instanceof Error ? error.message : 'Error occurred';
    return {
      chartData: [{ name: 'Currently Online Users', data: {} }],
      hasError: true,
      errorMessage,
    };
  }

  if (!data || !Array.isArray(data)) {
    return {
      chartData: [{ name: 'Currently Online Users', data: {} }],
      hasError: true,
      errorMessage: 'No data available',
    };
  }

  const chartData: Record<string, { primary: { label: string; val: number } }> = {};
  data.forEach(item => {
    const status = item.userStatus || 'Unknown';
    chartData[status] = {
      primary: {
        label: `Currently ${status.toLowerCase()} users`,
        val: item.userCount || 0,
      },
    };
  });

  return {
    chartData: [{ name: '', data: chartData }],
    hasError: false,
    errorMessage: '',
  };
};

export const calculateMessagesPerUser = (
  processedMessages: {
    total: number;
    totalChartData: Array<{ value: number; name: string }>;
    isLoading: boolean;
    error: unknown;
  },
  usersData: AnalyticsResponse<ActiveUsersResponse> | undefined,
  usersChartData: AnalyticsResponse<ActiveUsersResponse> | undefined,
  usersLoading: boolean,
  messagesLoading: boolean,
  usersError: unknown,
  messagesError: unknown,
  groupBy: GroupByOption,
): {
  value: number;
  chartData: Array<{ value: number; name: string }>;
  isLoading: boolean;
  error: unknown;
} => {
  // Handle loading states
  if (messagesLoading || usersLoading || processedMessages.isLoading) {
    return { value: 0, chartData: [], isLoading: true, error: null };
  }

  // Handle error states
  if (messagesError || usersError || processedMessages.error) {
    const error = messagesError || usersError || processedMessages.error;
    return { value: 0, chartData: [], isLoading: false, error };
  }

  // Calculate overall Messages Per User (Active Messages / Active Users)
  const totalMessages = processedMessages.total;

  // Handle the structured ActiveUsersResponse type
  let totalUsers = 0;
  if (usersData?.data) {
    totalUsers = usersData.data.uniqueUsers;
  }

  const avgMessagesPerUser = totalUsers > 0 ? totalMessages / totalUsers : 0;

  // Calculate chart data (daily messages per user from time series)
  const chartData: Array<{ value: number; name: string }> = [];
  if (processedMessages.totalChartData.length > 0 && usersChartData?.data?.timeSeries) {
    const timeSeriesUsers = usersChartData.data.timeSeries;

    if (timeSeriesUsers.length > 0) {
      // Create a Map for O(1) lookups to optimize performance from O(n*m) to O(n+m)
      const userMap = new Map(timeSeriesUsers.map(u => [formatChartDate(u.date, groupBy), u]));

      // Match up daily messages with daily users using the optimized Map lookup
      processedMessages.totalChartData.forEach(messagePoint => {
        const userPoint = userMap.get(messagePoint.name);

        if (userPoint && userPoint.value > 0) {
          const dailyAvg = messagePoint.value / userPoint.value;
          chartData.push({
            value: Math.round(dailyAvg * 10) / 10, // Round to 1 decimal
            name: messagePoint.name,
          });
        } else {
          chartData.push({
            value: 0,
            name: messagePoint.name,
          });
        }
      });
    }
  }

  return {
    value: avgMessagesPerUser,
    chartData: chartData,
    isLoading: false,
    error: null,
  };
};

// Create time range parameters for analytics queries
export const createTimeRangeParams = (dateRange: DateRange): TimeRangeParams => {
  const rangeDuration = dateRange.endDate.getTime() - dateRange.startDate.getTime();
  const hours = rangeDuration / (1000 * 60 * 60);

  const params: TimeRangeParams = {
    timeRange: 'custom',
    groupBy: hours < 48 ? 'hour' : 'day',
  };

  if (dateRange.startDate) {
    params.startDate = dateRange.startDate.toISOString();
  }

  if (dateRange.endDate) {
    params.endDate = dateRange.endDate.toISOString();
  }

  return params;
};

// Create React Query configuration for analytics queries
export const createQueryConfig = (
  user: unknown,
): {
  enabled: boolean;
  staleTime: number;
  retry: boolean | number;
  refetchOnWindowFocus: boolean;
  refetchInterval: number;
} => ({
  enabled: Boolean(user),
  staleTime: 0, // No cache for live updates
  retry: 2, // Retry up to 2 times for all errors
  refetchOnWindowFocus: false,
  refetchInterval: 1 * 60 * 1000, // Refetch every 1 minute for live updates
});

// Pie chart configuration
export const getPieChartConfig = (): { colors: string[] } => ({
  colors: ['#44cd42ff', '#2B7FFF', '#ff0707ff'],
});

/**
 * Format duration in minutes to a human-readable format (hours or minutes)
 * - If >= 60 minutes, show in hours with 1 decimal place
 * - If < 60 minutes, show in minutes
 */
export const formatDuration = (totalMinutes: number): { value: string; unit: 'hrs' | 'mins' } => {
  if (totalMinutes >= 60) {
    const hours = totalMinutes / 60;
    return {
      value: hours.toFixed(1),
      unit: 'hrs',
    };
  }
  return {
    value: Math.round(totalMinutes).toLocaleString(),
    unit: 'mins',
  };
};

/**
 * Process duration metric for display
 * Returns formatted value and unit label based on total duration
 */
export const processDurationMetric = (
  data: number | TimeSeriesDataPoint[] | undefined,
  isLoading: boolean,
  error: unknown,
  groupBy: GroupByOption,
): { value: string; unit: 'hrs' | 'mins'; chartData: Array<{ value: number; name: string }> } => {
  if (isLoading) {
    return { value: 'Loading...', unit: 'mins', chartData: [] };
  }
  if (error) {
    return {
      value: error instanceof Error ? error.message : 'Error occurred',
      unit: 'mins',
      chartData: [],
    };
  }
  if (data === undefined) {
    return { value: 'N/A', unit: 'mins', chartData: [] };
  }

  // Calculate total minutes from data
  let totalMinutes: number;
  let chartData: Array<{ value: number; name: string }> = [];

  if (Array.isArray(data)) {
    totalMinutes = data.reduce((sum, item) => sum + (item.value || 0), 0);
    // Process chart data - keep in original units (minutes) for chart
    chartData = data.map(item => ({
      value: item.value || 0,
      name: formatChartDate(item.date, groupBy),
    }));
  } else if (typeof data === 'number') {
    totalMinutes = data;
  } else {
    return { value: 'N/A', unit: 'mins', chartData: [] };
  }

  const formatted = formatDuration(totalMinutes);
  return {
    value: formatted.value,
    unit: formatted.unit,
    chartData,
  };
};
