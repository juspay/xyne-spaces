import { ReactElement, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { analyticsService } from '../../services/Analytics/analyticsService';
import { getDateRange, formatDateRangeForDisplay } from '../../utils/dateRangeUtils';
import {
  StatCard,
  StatCardVariant,
  DateRangePicker,
  DateRange,
  Charts,
  ChartType,
  ChartLegendPosition,
} from '@juspay/blend-design-system';
import {
  processNumericMetric,
  processTimeSeriesData,
  processMessagesExchangedData,
  processCurrentActiveUsersData,
  calculateMessagesPerUser,
  createTimeRangeParams,
  createQueryConfig,
  getPieChartConfig,
  processDurationMetric,
} from './AnalyticsScreen.utils';

const AnalyticsScreen = (): ReactElement => {
  const [dateRange, setDateRange] = useState<DateRange>(() => getDateRange('today'));

  const { user } = useAuth();

  // Create time range parameters from selected date range
  const timeRangeParams = useMemo(() => {
    return createTimeRangeParams(dateRange);
  }, [dateRange]);

  // Query configuration using utility function (refetchInterval handles live updates)
  const queryConfig = createQueryConfig(user);

  // Individual useQuery calls with stable query keys
  const {
    isLoading: messagesLoading,
    data: messagesData,
    error: messagesError,
  } = useQuery({
    queryKey: ['analytics', 'messagesExchanged', timeRangeParams],
    queryFn: () => analyticsService.getMessagesExchanged(timeRangeParams),
    ...queryConfig,
  });

  // Active Users - single call gets both stat display and chart data
  const {
    isLoading: usersLoading,
    data: usersData,
    error: usersError,
  } = useQuery({
    queryKey: ['analytics', 'activeUsers', timeRangeParams],
    queryFn: () => analyticsService.getActiveUsers(timeRangeParams),
    ...queryConfig,
  });

  const {
    isLoading: currentUsersLoading,
    data: currentUsersData,
    error: currentUsersError,
  } = useQuery({
    queryKey: ['analytics', 'currentActiveUsers'],
    queryFn: () => analyticsService.getCurrentActiveUsers(),
    ...queryConfig,
  });

  const {
    isLoading: channelsLoading,
    data: channelsData,
    error: channelsError,
  } = useQuery({
    queryKey: ['analytics', 'activeChannels', timeRangeParams],
    queryFn: () => analyticsService.getActiveChannels(timeRangeParams),
    ...queryConfig,
  });

  const latestChannelValue = useMemo(() => {
    const safeData = channelsData?.data as Array<{ value: number }> | undefined;
    if (Array.isArray(safeData) && safeData.length > 0) {
      return Math.max(...safeData.map(d => d.value));
    }
    return 0;
  }, [channelsData]);

  const {
    isLoading: filesLoading,
    data: filesData,
    error: filesError,
  } = useQuery({
    queryKey: ['analytics', 'filesShared', timeRangeParams],
    queryFn: () => analyticsService.getFilesShared(timeRangeParams),
    ...queryConfig,
  });

  // Users Onboarded - commented out, replaced by Total Calls Duration
  // const {
  //   isLoading: usersOnboardedLoading,
  //   data: usersOnboardedData,
  //   error: usersOnboardedError,
  // } = useQuery({
  //   queryKey: ['analytics', 'usersOnboarded', timeRangeParams],
  //   queryFn: () => analyticsService.getUsersOnboarded(timeRangeParams),
  //   ...queryConfig,
  // });

  const {
    isLoading: totalCallsDurationLoading,
    data: totalCallsDurationData,
    error: totalCallsDurationError,
  } = useQuery({
    queryKey: ['analytics', 'totalCallsDuration', timeRangeParams],
    queryFn: () => analyticsService.getTotalCallsDuration(timeRangeParams),
    ...queryConfig,
  });

  const {
    isLoading: messagesTodayLoading,
    data: messagesTodayData,
    error: messagesTodayError,
  } = useQuery({
    queryKey: ['analytics', 'messagesToday', timeRangeParams],
    queryFn: () => analyticsService.getMessagesToday(timeRangeParams),
    ...queryConfig,
  });

  const {
    isLoading: ticketsLoading,
    data: ticketsData,
    error: ticketsError,
  } = useQuery({
    queryKey: ['analytics', 'numberOfTickets', timeRangeParams],
    queryFn: () => analyticsService.getNumberOfTickets(timeRangeParams),
    ...queryConfig,
  });

  const {
    isLoading: canvasesLoading,
    data: canvasesData,
    error: canvasesError,
  } = useQuery({
    queryKey: ['analytics', 'numberOfCanvases', timeRangeParams],
    queryFn: () => analyticsService.getNumberOfCanvases(timeRangeParams),
    ...queryConfig,
  });

  const {
    isLoading: callsLoading,
    data: callsData,
    error: callsError,
  } = useQuery({
    queryKey: ['analytics', 'numberOfCalls', timeRangeParams],
    queryFn: () => analyticsService.getNumberOfCalls(timeRangeParams),
    ...queryConfig,
  });

  const {
    isLoading: topUsersLoading,
    data: topUsersData,
    error: topUsersError,
  } = useQuery({
    queryKey: ['analytics', 'topUsersByMessages', timeRangeParams],
    queryFn: () => analyticsService.getTopUsersByMessages(timeRangeParams, 10),
    ...queryConfig,
  });

  const subtitle = useMemo(() => formatDateRangeForDisplay(dateRange), [dateRange]);

  // Process data using helper functions - always use day grouping
  const processedMessages = processMessagesExchangedData(
    messagesData?.data,
    messagesLoading,
    messagesError,
    'day',
  );

  // Calculate Messages Per User from existing data (Active Messages / Active Users)
  const messagesPerUser = calculateMessagesPerUser(
    processedMessages,
    usersData,
    usersData, // Same data source for both aggregate and chart data
    usersLoading,
    messagesLoading,
    usersError,
    messagesError,
  );

  const pieChartResult = processCurrentActiveUsersData(
    currentUsersData?.data,
    currentUsersLoading,
    currentUsersError,
  );

  const { colors: pieChartColors } = getPieChartConfig();

  return (
    <div
      id='analytics-screen'
      data-component='AnalyticsScreen'
      className='flex overflow-y-auto no-scrollbar flex-col gap-4 md:gap-6 p-4 md:p-6 h-full bg-white rounded-2xl'
    >
      {/* Header Section */}
      <div
        id='analytics-header'
        className='flex flex-col lg:flex-row lg:items-center justify-between gap-4'
      >
        {/* Title and Subtext */}
        <div id='analytics-title-section' className='flex flex-col gap-1'>
          <h1 className='text-xl font-semibold text-gray-800'>Analytics</h1>
          <p className='text-sm text-gray-600'>
            Track and analyze your workspace performance metrics
          </p>
        </div>

        {/* Filters */}
        <div
          id='analytics-filters'
          className='flex flex-col sm:flex-row items-stretch sm:items-center gap-3'
        >
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      {/* Content Section */}
      <div id='analytics-content' className='flex flex-col gap-4 md:gap-6'>
        {/* First Content Section */}
        <div id='analytics-section-1' className='rounded-lg border border-gray-200 overflow-hidden'>
          <div id='analytics-section-1-container' className='flex flex-col lg:flex-row min-h-80'>
            {/* Left Column - Vertical Layout */}
            <div
              id='analytics-section-1-left'
              className='flex flex-col flex-1 lg:border-r border-gray-200'
            >
              {/* Top Row - Active Messages and DM Messages */}
              <div className='flex flex-col sm:flex-row flex-1 border-b border-gray-200'>
                <div className='flex-1'>
                  <StatCard
                    title='Active Messages'
                    value={processNumericMetric(
                      processedMessages.total,
                      processedMessages.isLoading,
                      processedMessages.error,
                    )}
                    subtitle={subtitle}
                    variant={StatCardVariant.LINE}
                    {...(processedMessages.totalChartData.length > 0
                      ? { chartData: processedMessages.totalChartData }
                      : {})}
                  />
                </div>
                <div className='hidden sm:block border-r border-gray-200'></div>
                <div className='border-t sm:border-t-0 border-gray-200 sm:border-gray-0'></div>
                <div className='flex-1'>
                  <StatCard
                    title='DM Messages'
                    value={processNumericMetric(
                      processedMessages.dm,
                      processedMessages.isLoading,
                      processedMessages.error,
                    )}
                    subtitle={subtitle}
                    variant={StatCardVariant.LINE}
                    {...(processedMessages.dmChartData.length > 0
                      ? { chartData: processedMessages.dmChartData }
                      : {})}
                  />
                </div>
              </div>
              {/* Bottom - Channel Messages and Group DM Messages */}
              <div
                id='analytics-section-1-bottom-row'
                className='flex flex-col sm:flex-row flex-wrap flex-1'
              >
                <div className='flex-1'>
                  <StatCard
                    title='Channel Messages'
                    value={processNumericMetric(
                      processedMessages.channel,
                      processedMessages.isLoading,
                      processedMessages.error,
                    )}
                    subtitle={subtitle}
                    variant={StatCardVariant.LINE}
                    {...(processedMessages.channelChartData.length > 0
                      ? { chartData: processedMessages.channelChartData }
                      : {})}
                  />
                </div>
                <div className='hidden sm:block border-r border-gray-200'></div>
                <div className='border-t sm:border-t-0 border-gray-200 sm:border-gray-0'></div>
                <div className='flex-1'>
                  <StatCard
                    title='Group DM Messages'
                    value={processNumericMetric(
                      processedMessages.groupDm,
                      processedMessages.isLoading,
                      processedMessages.error,
                    )}
                    subtitle={subtitle}
                    variant={StatCardVariant.LINE}
                    {...(processedMessages.groupDmChartData.length > 0
                      ? { chartData: processedMessages.groupDmChartData }
                      : {})}
                  />
                </div>
              </div>
            </div>
            {/* Right Column */}
            <div
              id='analytics-section-1-right'
              className='flex-1 border-t lg:border-t-0 border-gray-200'
            >
              {currentUsersLoading ? (
                <div className='flex items-center justify-center h-full'>
                  <span>Loading...</span>
                </div>
              ) : pieChartResult.hasError ? (
                <div className='flex items-center justify-center h-full'>
                  <div className='text-center'>
                    <div className='text-sm font-semibold mb-2'>Currently Online Users</div>
                    <span className='text-gray-500'>{pieChartResult.errorMessage}</span>
                  </div>
                </div>
              ) : (
                <Charts
                  chartType={ChartType.PIE}
                  data={pieChartResult.chartData}
                  colors={pieChartColors}
                  legendPosition={ChartLegendPosition.RIGHT}
                  chartHeaderSlot={
                    <div className='text-sm font-semibold'>Currently Online Users</div>
                  }
                  height={300}
                  showCollapseIcon={false}
                />
              )}
            </div>
          </div>
        </div>

        {/* Second Content Section */}
        <div id='analytics-section-2' className='rounded-lg border border-gray-200 overflow-hidden'>
          <div id='analytics-section-2-container' className='flex flex-col md:flex-row'>
            <div className='flex-1'>
              <StatCard
                title='Active Channels'
                value={processNumericMetric(latestChannelValue, channelsLoading, channelsError)}
                subtitle={subtitle}
                variant={StatCardVariant.LINE}
                {...(Array.isArray(channelsData?.data)
                  ? {
                      chartData: processTimeSeriesData(channelsData.data, 'day'),
                    }
                  : {})}
              />
            </div>
            <div className='border-t md:border-t-0 md:border-r border-gray-200'></div>
            <div className='flex-1'>
              <StatCard
                title='Active Users'
                value={processNumericMetric(usersData?.data?.uniqueUsers, usersLoading, usersError)}
                subtitle={subtitle}
                variant={StatCardVariant.LINE}
                {...((): { chartData?: Array<{ value: number; name: string }> } => {
                  // Extract chart data from structured ActiveUsersResponse
                  const chartData = usersData?.data?.timeSeries
                    ? processTimeSeriesData(usersData.data.timeSeries, 'day')
                    : [];
                  return chartData.length > 0 ? { chartData } : {};
                })()}
              />
            </div>
            <div className='border-t md:border-t-0 md:border-r border-gray-200'></div>
            <div className='flex-1'>
              <StatCard
                title='Messages Per User'
                value={processNumericMetric(
                  messagesPerUser.value,
                  messagesPerUser.isLoading,
                  messagesPerUser.error,
                  true,
                )}
                subtitle={subtitle}
                variant={StatCardVariant.LINE}
                {...(messagesPerUser.chartData.length > 0
                  ? { chartData: messagesPerUser.chartData }
                  : {})}
              />
            </div>
          </div>
        </div>

        {/* Third Content Section */}
        <div id='analytics-section-3' className='rounded-lg border border-gray-200 overflow-hidden'>
          <div id='analytics-section-3-container' className='flex flex-col md:flex-row'>
            <div className='flex-1'>
              <StatCard
                title='Messages Today'
                value={processNumericMetric(
                  messagesTodayData?.data,
                  messagesTodayLoading,
                  messagesTodayError,
                )}
                subtitle={subtitle}
                variant={StatCardVariant.LINE}
                {...(Array.isArray(messagesTodayData?.data)
                  ? {
                      chartData: processTimeSeriesData(messagesTodayData.data, 'day'),
                    }
                  : {})}
              />
            </div>
            <div className='border-t md:border-t-0 md:border-r border-gray-200'></div>
            {/* Users Onboarded - commented out, replaced by Total Duration of Calls */}
            {/* <div className='flex-1'>
              <StatCard
                title='User Onboarded'
                value={processNumericMetric(
                  usersOnboardedData?.data,
                  usersOnboardedLoading,
                  usersOnboardedError,
                )}
                subtitle={subtitle}
                variant={StatCardVariant.LINE}
                {...(Array.isArray(usersOnboardedData?.data)
                  ? {
                      chartData: processTimeSeriesData(usersOnboardedData.data, 'day'),
                    }
                  : {})}
              />
            </div> */}
            <div className='flex-1'>
              {(() => {
                const durationMetric = processDurationMetric(
                  totalCallsDurationData?.data,
                  totalCallsDurationLoading,
                  totalCallsDurationError,
                );
                return (
                  <StatCard
                    title={`Total Duration of Calls (${durationMetric.unit})`}
                    value={durationMetric.value}
                    subtitle={subtitle}
                    variant={StatCardVariant.LINE}
                    {...(durationMetric.chartData.length > 0
                      ? { chartData: durationMetric.chartData }
                      : {})}
                  />
                );
              })()}
            </div>
            <div className='border-t md:border-t-0 md:border-r border-gray-200'></div>
            <div className='flex-1'>
              <StatCard
                title='Number of Calls'
                value={processNumericMetric(callsData?.data, callsLoading, callsError)}
                subtitle={subtitle}
                variant={StatCardVariant.LINE}
                {...(Array.isArray(callsData?.data)
                  ? {
                      chartData: processTimeSeriesData(callsData.data, 'day'),
                    }
                  : {})}
              />
            </div>
          </div>
        </div>

        {/* Fourth Content Section */}
        <div id='analytics-section-4' className='rounded-lg border border-gray-200 overflow-hidden'>
          <div id='analytics-section-4-container' className='flex flex-col md:flex-row'>
            <div className='flex-1'>
              <StatCard
                title='Number of Tickets'
                value={processNumericMetric(ticketsData?.data, ticketsLoading, ticketsError)}
                subtitle={subtitle}
                variant={StatCardVariant.LINE}
                {...(Array.isArray(ticketsData?.data)
                  ? {
                      chartData: processTimeSeriesData(ticketsData.data, 'day'),
                    }
                  : {})}
              />
            </div>
            <div className='border-t md:border-t-0 md:border-r border-gray-200'></div>
            <div className='flex-1'>
              <StatCard
                title='Number of Canvases'
                value={processNumericMetric(canvasesData?.data, canvasesLoading, canvasesError)}
                subtitle={subtitle}
                variant={StatCardVariant.LINE}
                {...(Array.isArray(canvasesData?.data)
                  ? {
                      chartData: processTimeSeriesData(canvasesData.data, 'day'),
                    }
                  : {})}
              />
            </div>
            <div className='border-t md:border-t-0 md:border-r border-gray-200'></div>
            <div className='flex-1'>
              <StatCard
                title='File Attachments Shared'
                value={processNumericMetric(filesData?.data, filesLoading, filesError)}
                subtitle={subtitle}
                variant={StatCardVariant.LINE}
                {...(Array.isArray(filesData?.data)
                  ? {
                      chartData: processTimeSeriesData(filesData.data, 'day'),
                    }
                  : {})}
              />
            </div>
          </div>
        </div>

        {/* Fifth Content Section - Top Users by Messages */}
        <div
          id='analytics-section-5'
          className='rounded-lg border border-gray-200 overflow-hidden p-6'
        >
          {topUsersLoading ? (
            <div className='flex items-center justify-center h-64'>
              <span>Loading...</span>
            </div>
          ) : topUsersError ? (
            <div className='flex items-center justify-center h-64'>
              <span className='text-gray-500'>Failed to load top users data</span>
            </div>
          ) : topUsersData?.data && topUsersData.data.length > 0 ? (
            <div className='flex flex-col gap-4'>
              <div className='flex flex-col gap-1'>
                <div className='text-sm font-semibold'>Top 10 Users by Messages Sent</div>
                <div className='text-xs text-gray-500'>{subtitle}</div>
              </div>
              <div className='flex flex-col gap-2'>
                {topUsersData.data.map((user, index) => (
                  <div
                    key={user.userId}
                    className='flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors'
                  >
                    <div className='flex items-center gap-3'>
                      <span className='text-sm font-medium text-gray-500 w-6'>{index + 1}.</span>
                      <span className='text-sm font-medium text-gray-900'>{user.userName}</span>
                    </div>
                    <span className='text-sm font-semibold text-blue-600'>
                      {user.messageCount.toLocaleString()} messages
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className='flex items-center justify-center h-64'>
              <span className='text-gray-500'>No data available</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnalyticsScreen;
