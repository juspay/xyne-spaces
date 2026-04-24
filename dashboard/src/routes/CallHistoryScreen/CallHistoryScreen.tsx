import {
  Calendar,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  Info,
  LayoutList,
  LucideIcon,
  Megaphone,
  Phone,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { ReactElement, useEffect, useState, useRef, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useAuth } from '../../hooks/useAuth';
import { useCallHistory } from './useCallHistory';
import { CallStatus } from '@xyne/shared';
import { logger, Event } from '../../utils/logger';
import { dataLoadDuration, safeRecordMetric } from '../../services/otel';
import { useLocation, useNavigate } from 'react-router-dom';
import { CallConfirmationModal } from '../../components/Call/CallConfirmationModal';
import { DeleteCallModal } from '../../components/Call/DeleteCallModal';
import { InstantCallModal } from '../../components/Call/InstantCallModal/InstantCallModal';
import { ScheduleCallModal } from '../../components/Call/ScheduleCallModal/ScheduleCallModal';
import Avatar from '../../components/ui/Avatar/Avatar';
import Button from '../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import Input from '../../components/ui/Input';
import { Switch } from '../../components/ui/Switch';
import { Tooltip } from '../../components/ui/Tooltip/Tooltip';
import { useAllChannels } from '../../hooks/useChannels';
import { useUsers } from '../../hooks/useUsers';
import { useZero } from '../../hooks/useZero';
import { cn } from '../../utils/classNames';
import { mutators } from '../../zero/mutators';
import axios from 'axios';
import { API_BASE_URL } from '../../config';
import { CallCard, UpcomingCallCard } from './CallCard';
import { Call, isExternalCalendarEvent } from './callHistoryItem.utils';
import { GoogleCalendarIcon, MicrosoftIcon } from './CalendarIcons';
import { ParticipantsModal } from './ParticipantsModal';
import * as Tabs from '@radix-ui/react-tabs';
import { getUserDisplayName } from '../../utils/userDisplayName';
import CalendarWeekView from './CalendarWeekView';
import CalendarDayView from './CalendarDayView';
import CalendarMonthView from './CalenderMonthView';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export type CallTabType = 'all' | 'upcoming' | 'missed';

const MAX_UPCOMING_CALLS_TO_SHOW = 3;

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

const CallHistoryScreen = (): ReactElement => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const allChannels = useAllChannels();
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [scheduleInitialTime, setScheduleInitialTime] = useState<{
    startsAt: Date;
    endsAt: Date;
  } | null>(null);
  const [isInstantCallModalOpen, setIsInstantCallModalOpen] = useState(false);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [calendarSubView, setCalendarSubView] = useState<'month' | 'week' | 'day'>('month');
  const [calendarProvider, setCalendarProvider] = useState<'GOOGLE' | 'MICROSOFT' | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{
    text: string;
    ok: boolean;
    reauth?: boolean;
  } | null>(null);
  const [currentMonthStart, setCurrentMonthStart] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [currentDayStart, setCurrentDayStart] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const {
    calls,
    scheduledCalls,
    missedCalls,
    queryDetails,
    selectedCall,
    isParticipantsModalOpen,
    searchQuery,
    setSearchQuery,
    filteredUsers,
    selectedUsers,
    handleCallRowClick,
    handleParticipantsClick,
    handleRemoveUser,
    closeParticipantsModal,
    handleGotoTranscript,
    getGotoTranscriptHandler,
    handleDownloadTranscript,
    showConfirmModal,
    confirmModalConfig,
    handleConfirmCall,
    closeConfirmModal,
    handleInstantCall,
    hasMoreCalls,
    loadMoreCalls,
    onVisibleRangeChanged,
    handleDeleteClick,
    deleteModalOpen,
    deleteModalCall,
    handleDeleteConfirm,
    closeDeleteModal,
    handleEditClick,
    editModalOpen,
    editModalCall,
    closeEditModal,
    showChannelCalls,
    setShowChannelCalls,
  } = useCallHistory(user?.id);

  const zero = useZero();
  const callHistoryLoadStartTimeRef = useRef<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Fetch the current user's calendar provider once on mount
  useEffect(() => {
    if (!user?.id) return;
    axios
      .get<{ success: boolean; provider: 'GOOGLE' | 'MICROSOFT' | null }>(
        `${API_BASE_URL}/calendar/sync/provider`,
        { withCredentials: true },
      )
      .then(res => {
        if (res.data.success) setCalendarProvider(res.data.provider);
      })
      .catch(() => {
        // non-critical — button just won't show
      });
  }, [user?.id]);

  const handleCalendarSync = async () => {
    if (!calendarProvider || isSyncing) return;
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const provider = calendarProvider === 'GOOGLE' ? 'google' : 'microsoft';
      await axios.post(`${API_BASE_URL}/calendar/sync/${provider}`, {}, { withCredentials: true });
      setSyncMessage({ text: 'Synced!', ok: true });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { error?: string; needsReauth?: boolean } | undefined;
        if (data?.needsReauth) {
          setSyncMessage({
            text: 'Re-authorization required — please sign out and sign back in',
            ok: false,
            reauth: true,
          });
        } else {
          setSyncMessage({ text: 'Unable to sync', ok: false });
        }
      } else {
        setSyncMessage({ text: 'Unable to sync', ok: false });
      }
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncMessage(null), syncMessage?.reauth ? 8000 : 3000);
    }
  };

  const endedCallsCount = calls?.filter(c => c.status === CallStatus.ENDED).length ?? 0;

  const searchParams = new URLSearchParams(location.search);
  const tabParam = searchParams.get('tab');
  const activeTab = (tabParam as CallTabType) || 'all';

  useEffect(() => {
    if (endedCallsCount === 0) return;

    void zero.mutate(mutators.activities.markMissedCallsAsRead({}));
  }, [endedCallsCount]);

  useEffect(() => {
    if (queryDetails.type === 'unknown') {
      callHistoryLoadStartTimeRef.current = Date.now();
    } else if (queryDetails.type === 'complete') {
      if (callHistoryLoadStartTimeRef.current !== null) {
        const duration = Date.now() - callHistoryLoadStartTimeRef.current;
        logger.info(Event.CALL_HISTORY_LOADED, {
          source: 'CallHistoryScreen',
          message: 'Call history loaded',
          durationMs: duration,
          url: window.location.href,
        });

        safeRecordMetric(() => {
          dataLoadDuration.record(duration, {
            source: 'CallHistoryScreen',
            event: Event.CALL_HISTORY_LOADED,
            platform: logger.platformName,
          });
        });

        callHistoryLoadStartTimeRef.current = null;
      }
    } else if (queryDetails.type === 'error') {
      if (callHistoryLoadStartTimeRef.current !== null) {
        const duration = Date.now() - callHistoryLoadStartTimeRef.current;
        logger.info(Event.CALL_HISTORY_LOADED, {
          source: 'CallHistoryScreen',
          message: 'Call history load failed',
          durationMs: duration,
          url: window.location.href,
        });

        safeRecordMetric(() => {
          dataLoadDuration.record(duration, {
            source: 'CallHistoryScreen',
            event: Event.CALL_HISTORY_LOADED,
            platform: logger.platformName,
          });
        });
        callHistoryLoadStartTimeRef.current = null;
      }
    } else {
      callHistoryLoadStartTimeRef.current = null;
    }
  }, [queryDetails.type]);

  // call tabs
  const tabs: Array<{ id: CallTabType; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'upcoming', label: 'Scheduled' },
    { id: 'missed', label: 'Missed' },
  ];

  // update query params
  const handleTabChange = (newTab: string) => {
    const params = new URLSearchParams(location.search);
    params.set('tab', newTab);
    void navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    if (newTab !== 'upcoming') {
      setViewMode('list');
    }
  };

  const handleCreateCallAtSlot = (startsAt: Date, endsAt: Date) => {
    setScheduleInitialTime({ startsAt, endsAt });
    setIsScheduleModalOpen(true);
  };

  const handleCreateCallOnDay = (date: Date) => {
    if (isSameDay(date, new Date())) {
      setScheduleInitialTime(null);
      setIsScheduleModalOpen(true);
      return;
    }
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const start = new Date(date);
    start.setHours(11, 0, 0, 0);
    handleCreateCallAtSlot(start, new Date(start.getTime() + ONE_HOUR_MS));
  };

  const handleCalendarPrev = () => {
    if (calendarSubView === 'month') {
      setCurrentMonthStart(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
    } else if (calendarSubView === 'week') {
      setCurrentWeekStart(d => {
        const n = new Date(d);
        n.setDate(n.getDate() - 7);
        return n;
      });
    } else {
      setCurrentDayStart(d => {
        const n = new Date(d);
        n.setDate(n.getDate() - 1);
        return n;
      });
    }
  };

  const handleCalendarNext = () => {
    const max = new Date();
    max.setDate(max.getDate() + 60);
    max.setHours(23, 59, 59, 999);
    if (calendarSubView === 'month') {
      const next = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() + 1, 1);
      if (next <= max) setCurrentMonthStart(next);
    } else if (calendarSubView === 'week') {
      const next = new Date(currentWeekStart);
      next.setDate(next.getDate() + 7);
      if (next <= max) setCurrentWeekStart(next);
    } else {
      const next = new Date(currentDayStart);
      next.setDate(next.getDate() + 1);
      if (next <= max) setCurrentDayStart(next);
    }
  };

  const handleCalendarToday = () => {
    const today = new Date();
    const month = new Date(today.getFullYear(), today.getMonth(), 1);
    month.setHours(0, 0, 0, 0);
    setCurrentMonthStart(month);

    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    weekStart.setHours(0, 0, 0, 0);
    setCurrentWeekStart(weekStart);

    const dayStart = new Date(today);
    dayStart.setHours(0, 0, 0, 0);
    setCurrentDayStart(dayStart);
  };

  const calendarTitle = (): string => {
    if (calendarSubView === 'month') {
      return currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } else if (calendarSubView === 'week') {
      // Calculate week number within the month
      const firstDayOfMonth = new Date(
        currentWeekStart.getFullYear(),
        currentWeekStart.getMonth(),
        1,
      );
      const firstWeekDay = firstDayOfMonth.getDay();
      const offset = firstWeekDay === 0 ? 1 : 0;
      const weekNumber = Math.ceil((currentWeekStart.getDate() + firstWeekDay - 1) / 7) - offset;
      const monthName = currentWeekStart.toLocaleDateString('en-US', { month: 'short' });
      return `Week ${weekNumber}, ${monthName}`;
    } else {
      return currentDayStart.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }
  };

  // Redirect to /calls/all if no tab or invalid tab
  useEffect(() => {
    if (!tabParam) {
      const params = new URLSearchParams(location.search);
      params.set('tab', 'all');
      void navigate(`${location.pathname}?${params.toString()}`, { replace: true });
    }
  }, [tabParam, location.pathname, location.search, navigate]);

  const allUsersData = useUsers();

  const filterCallsBySearchQuery = (calls: Call[], query: string): Call[] => {
    if (!query.trim()) return calls;

    const lowerQuery = query.toLowerCase();

    return calls.filter(call => {
      // Search by call title
      if (call.title?.toLowerCase().includes(lowerQuery)) {
        return true;
      }

      // Search by channel name
      const channel = allChannels.find(c => c.id === call.channelId);
      if (channel?.name?.toLowerCase().includes(lowerQuery)) {
        return true;
      }

      // Search by participant names (handles both internal and external users)
      const participantNames = call.participants
        ?.map(p => {
          if (p.isExternal) return (p.displayName || '').toLowerCase();
          const user = allUsersData.find(u => u.id === p.userId);
          return getUserDisplayName(user).toLowerCase();
        })
        .join(' ');

      if (participantNames?.includes(lowerQuery)) {
        return true;
      }

      // Search by participant emails
      const participantEmails = call.participants
        ?.map(p => {
          const user = allUsersData.find(u => u.id === p.userId);
          return user?.email?.toLowerCase() || '';
        })
        .join(' ');

      if (participantEmails?.includes(lowerQuery)) {
        return true;
      }

      return false;
    });
  };

  const filteredScheduledCalls = searchQuery.trim()
    ? filterCallsBySearchQuery(scheduledCalls || [], searchQuery)
    : scheduledCalls;

  // Show only 1 instance per recurring series; exclude Google Calendar events from list view
  const limitedScheduledCalls = useMemo(() => {
    if (!filteredScheduledCalls) return filteredScheduledCalls;
    const seenSeries = new Set<string>();
    return filteredScheduledCalls.filter(call => {
      if (isExternalCalendarEvent(call)) {
        return false;
      }
      if (call.recurringSeriesId) {
        if (seenSeries.has(call.recurringSeriesId)) {
          return false;
        }
        seenSeries.add(call.recurringSeriesId);
      }
      return true;
    });
  }, [filteredScheduledCalls]);

  const displayScheduledCalls = showAllUpcoming
    ? limitedScheduledCalls
    : limitedScheduledCalls?.slice(0, MAX_UPCOMING_CALLS_TO_SHOW);

  const filteredRecentCalls = searchQuery.trim()
    ? filterCallsBySearchQuery(calls || [], searchQuery)
    : calls;

  // Exclude Google Calendar events from All/Missed list views
  const filteredRecentCallsNoGcal = filteredRecentCalls?.filter(
    call => !isExternalCalendarEvent(call),
  );

  const filteredMissedCalls = (
    searchQuery.trim() ? filterCallsBySearchQuery(missedCalls || [], searchQuery) : missedCalls
  )?.filter(call => !isExternalCalendarEvent(call));

  const calendarCalls = useMemo(() => {
    const combined = [...(filteredRecentCalls || []), ...(filteredScheduledCalls || [])];
    const seenCallIds = new Set<string>();

    return combined.filter(call => {
      if (seenCallIds.has(call.id)) {
        return false;
      }

      seenCallIds.add(call.id);
      return true;
    });
  }, [filteredRecentCalls, filteredScheduledCalls]);

  // Filter calls based on active tab
  const getTabContent = () => {
    if (searchQuery.trim()) {
      if (activeTab === 'missed') {
        return filteredMissedCalls;
      } else if (activeTab === 'upcoming') {
        return limitedScheduledCalls;
      }
      return filteredRecentCallsNoGcal;
    }

    //default view without search
    if (activeTab === 'missed') {
      return filteredMissedCalls;
    } else if (activeTab === 'upcoming') {
      return limitedScheduledCalls;
    }
    return filteredRecentCallsNoGcal;
  };

  const tabContent = getTabContent();

  const isCalendarMode = activeTab === 'upcoming' && viewMode === 'calendar';

  // 60-day navigation limit
  const maxCalendarDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 60);
    d.setHours(23, 59, 59, 999);
    return d;
  }, []);

  const isNextDisabled = useMemo(() => {
    if (calendarSubView === 'month') {
      return (
        new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() + 1, 1) >
        maxCalendarDate
      );
    } else if (calendarSubView === 'week') {
      const next = new Date(currentWeekStart);
      next.setDate(next.getDate() + 7);
      return next > maxCalendarDate;
    } else {
      const next = new Date(currentDayStart);
      next.setDate(next.getDate() + 1);
      return next > maxCalendarDate;
    }
  }, [calendarSubView, currentMonthStart, currentWeekStart, currentDayStart, maxCalendarDate]);

  const isTodayDisabled = useMemo(() => {
    const today = new Date();

    if (calendarSubView === 'month') {
      return isSameMonth(currentMonthStart, today);
    }

    if (calendarSubView === 'week') {
      const todayWeekStart = new Date(today);
      todayWeekStart.setDate(today.getDate() - today.getDay());
      todayWeekStart.setHours(0, 0, 0, 0);

      return currentWeekStart.getTime() === todayWeekStart.getTime();
    }

    return isSameDay(currentDayStart, today);
  }, [calendarSubView, currentMonthStart, currentWeekStart, currentDayStart]);

  if (queryDetails.type === 'unknown') {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='text-sm text-muted-foreground'>Loading call history...</div>
      </div>
    );
  }

  if (queryDetails.type === 'error') {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='text-sm text-red-500'>Error loading call history</div>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      className={cn(
        'bg-background flex flex-col w-full h-full md:rounded-2xl shadow-md relative',
        isCalendarMode ? 'overflow-hidden' : 'overflow-y-auto',
      )}
    >
      <div className='w-full flex flex-col items-center px-4'>
        <div className='max-w-[810px] w-full sticky top-0 bg-background z-50'>
          {/* Header */}
          <div className='flex items-center justify-between py-3'>
            <h1 className='text-lg font-semibold text-foreground'>Calls</h1>
            <div className='flex items-center gap-2'>
              {/* Calendar sync button — shown only for Google / Microsoft SSO users */}
              {calendarProvider && (
                <button
                  onClick={() => {
                    void handleCalendarSync();
                  }}
                  disabled={isSyncing}
                  data-track-category='Calls'
                  data-track-name='calendar-sync'
                  title={`Sync ${calendarProvider === 'GOOGLE' ? 'Google' : 'Microsoft'} Calendar`}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 h-8 rounded-lg text-sm font-medium border transition-colors disabled:opacity-60',
                    syncMessage?.reauth
                      ? 'border-destructive text-destructive hover:bg-destructive/10'
                      : 'border-border text-foreground hover:bg-muted',
                  )}
                >
                  {isSyncing ? (
                    <RefreshCw className='size-3.5 animate-spin' />
                  ) : calendarProvider === 'GOOGLE' ? (
                    <GoogleCalendarIcon size={14} />
                  ) : (
                    <MicrosoftIcon size={14} />
                  )}
                  <span>
                    {syncMessage ? (
                      syncMessage.text
                    ) : isSyncing ? (
                      'Syncing…'
                    ) : (
                      <>
                        <span className='md:hidden'>Sync</span>
                        <span className='hidden md:inline'>{`Sync ${calendarProvider === 'GOOGLE' ? 'Google' : 'Microsoft'} Calendar`}</span>
                      </>
                    )}
                  </span>
                </button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    data-testid='new-call-button'
                    className='!bg-action-primary !text-action-primary-foreground duration-300 ease-in-out rounded-lg gap-1.5 px-3 py-2 h-8 hover:opacity-90'
                  >
                    <span className='text-sm leading-5 font-semibold'>New Call</span>
                    <ChevronDown className='size-4' strokeWidth={2.3} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' sideOffset={8} className='rounded-xl'>
                  <DropdownMenuItem
                    data-testid='start-instant-call-option'
                    className='flex gap-2 items-center text-sm rounded-lg'
                    onSelect={() => {
                      setIsInstantCallModalOpen(true);
                    }}
                  >
                    <Plus className='size-4' />
                    Start an instant call
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-testid='schedule-call-option'
                    className='flex gap-2 items-center text-sm leading-5 rounded-lg'
                    onSelect={() => setIsScheduleModalOpen(true)}
                  >
                    <CalendarDays className='size-4' />
                    Schedule call for later
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Tabs Options */}
          <div className='overflow-x-auto border-b border-border shrink-0'>
            <Tabs.Root value={activeTab} onValueChange={handleTabChange}>
              <Tabs.List className='flex items-center justify-start'>
                {tabs.map(tab => (
                  <Tabs.Trigger asChild key={tab.id} value={tab.id}>
                    <button
                      className={cn(
                        'flex items-center p-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2 cursor-pointer',
                        activeTab === tab.id
                          ? 'border-foreground text-foreground'
                          : 'border-transparent text-muted-foreground',
                      )}
                    >
                      {tab.label}
                    </button>
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </Tabs.Root>
          </div>

          {/* Calendar toolbar (calendar mode) or Search + icons (list mode) */}
          {isCalendarMode ? (
            <div className='my-3 flex items-center justify-between gap-3'>
              {/* Left: title + prev/next */}
              <div className='flex items-center gap-2'>
                <h2 className='text-base font-semibold text-foreground min-w-[140px]'>
                  {calendarTitle()}
                </h2>
                <div className='flex items-center'>
                  <button
                    onClick={handleCalendarPrev}
                    data-track-category='Calls'
                    data-track-name='calendar-prev'
                    className='p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground'
                    aria-label='Previous'
                  >
                    <ChevronDown className='size-4 rotate-90' />
                  </button>
                  <button
                    onClick={handleCalendarNext}
                    disabled={isNextDisabled}
                    data-track-category='Calls'
                    data-track-name='calendar-next'
                    className={cn(
                      'p-1.5 rounded transition-colors',
                      isNextDisabled
                        ? 'text-muted-foreground/30 cursor-not-allowed'
                        : 'hover:bg-muted text-muted-foreground',
                    )}
                    aria-label='Next'
                  >
                    <ChevronDown className='size-4 -rotate-90' />
                  </button>
                </div>
              </div>

              {/* Right: Today + sub-view dropdown + list/calendar icons */}
              <div className='flex items-center gap-2'>
                <button
                  onClick={handleCalendarToday}
                  disabled={isTodayDisabled}
                  data-track-category='Calls'
                  data-track-name='calendar-today'
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium border border-border rounded-lg transition-colors',
                    isTodayDisabled
                      ? 'text-muted-foreground/50 cursor-not-allowed'
                      : 'hover:bg-muted text-foreground',
                  )}
                >
                  Today
                </button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors text-foreground'>
                      {calendarSubView.charAt(0).toUpperCase() + calendarSubView.slice(1)}
                      <ChevronDown className='size-3.5' />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' sideOffset={6} className='rounded-xl w-32'>
                    {(['month', 'week', 'day'] as const).map(v => (
                      <DropdownMenuItem
                        key={v}
                        className={cn(
                          'text-sm rounded-lg capitalize cursor-pointer',
                          calendarSubView === v && 'font-medium',
                        )}
                        onSelect={() => setCalendarSubView(v)}
                      >
                        {v.charAt(0).toUpperCase() + v.slice(1)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className='flex items-center shrink-0 border border-border rounded-lg overflow-hidden'>
                  <button
                    onClick={() => setViewMode('list')}
                    data-track-category='Calls'
                    data-track-name='calendar-switch-to-list'
                    className='p-2 text-muted-foreground hover:bg-muted/50 transition-colors'
                    aria-label='List view'
                  >
                    <LayoutList className='size-4' />
                  </button>
                  <button
                    onClick={() => setViewMode('calendar')}
                    data-track-category='Calls'
                    data-track-name='calendar-switch-to-calendar'
                    className='p-2 bg-muted text-foreground transition-colors'
                    aria-label='Calendar view'
                  >
                    <Calendar className='size-4' />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Search Input and View Mode Toggle */}
              <div className='my-4 flex items-center justify-between gap-4'>
                <div className='relative flex-1 max-w-full md:max-w-[350px]'>
                  <Search className='absolute left-2.5 top-1/2 transform -translate-y-1/2 text-muted-foreground dark:text-muted-foreground size-4' />
                  <Input
                    type='text'
                    placeholder='Search calls'
                    value={searchQuery}
                    maxLength={56}
                    onChange={e => setSearchQuery(e.target.value)}
                    className='pl-8 w-full placeholder:text-muted-foreground rounded-xl focus-visible:ring-0 duration-300 ease-in-out'
                    data-testid='user-search-input'
                  />
                </div>
                {activeTab === 'all' && (
                  <div className='flex items-center gap-3 shrink-0'>
                    <label
                      htmlFor='channel-calls-toggle'
                      className='hidden md:block text-sm text-muted-foreground whitespace-nowrap cursor-pointer select-none'
                    >
                      Show all calls in my channels
                    </label>
                    <Switch
                      id='channel-calls-toggle'
                      checked={showChannelCalls}
                      onCheckedChange={setShowChannelCalls}
                    />
                    <Tooltip content='Show all calls in my channels' side='bottom'>
                      <button className='md:hidden text-muted-foreground flex items-center'>
                        <Info className='size-4' />
                      </button>
                    </Tooltip>
                  </div>
                )}
                {activeTab === 'upcoming' && (
                  <div className='flex items-center shrink-0 border border-border rounded-lg overflow-hidden'>
                    <button
                      onClick={() => setViewMode('list')}
                      data-track-category='Calls'
                      data-track-name='list-switch-to-list'
                      className='p-2 bg-muted text-foreground transition-colors'
                      aria-label='List view'
                    >
                      <LayoutList className='size-4' />
                    </button>
                    <button
                      onClick={() => setViewMode('calendar')}
                      data-track-category='Calls'
                      data-track-name='list-switch-to-calendar'
                      className='p-2 text-muted-foreground hover:bg-muted/50 transition-colors'
                      aria-label='Calendar view'
                    >
                      <Calendar className='size-4' />
                    </button>
                  </div>
                )}
              </div>

              {/* Selected Users Pills */}
              {selectedUsers.length > 0 && (
                <div className='my-4 flex flex-wrap gap-2'>
                  {selectedUsers.map(selectedUser => (
                    <div
                      key={selectedUser.id}
                      className='flex items-center gap-2 px-3 py-1.5 bg-primary/20 dark:bg-primary/20 rounded-full'
                    >
                      <Avatar userId={selectedUser.id} size='sm' />
                      <span className='text-sm font-medium text-primary'>
                        {getUserDisplayName(selectedUser)}
                      </span>
                      <button
                        onClick={() => handleRemoveUser(selectedUser.id)}
                        className='text-primary hover:text-primary/80'
                        data-track-category='Calls'
                        data-track-name='RemoveUserFilter'
                        data-track-metadata={JSON.stringify({ userId: selectedUser.id })}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Call List */}
        <div
          className={cn('flex-1 min-h-0 w-full no-scrollbar overflow-y-auto')}
          data-testid='call-history-list'
        >
          {/* All Tab View */}
          {activeTab === 'all' && (
            <div className='max-w-[810px] w-full mx-auto flex flex-col gap-7'>
              {/* Upcoming calls */}
              {(!searchQuery.trim() ||
                (filteredScheduledCalls && filteredScheduledCalls.length > 0)) &&
                scheduledCalls &&
                scheduledCalls.length > 0 && (
                  <div className='flex flex-col gap-4 mt-3 w-full'>
                    <div className='flex items-center justify-between'>
                      <span className='font-mono text-muted-foreground text-sm leading-5 font-medium uppercase cursor-default'>
                        upcoming calls
                      </span>
                      {!searchQuery.trim() &&
                        (limitedScheduledCalls?.length ?? 0) > MAX_UPCOMING_CALLS_TO_SHOW && (
                          <Button
                            variant='secondary'
                            size='sm'
                            onClick={() => setShowAllUpcoming(!showAllUpcoming)}
                            className='font-mono text-sm leading-5 font-medium capitalize rounded-xl h-7'
                          >
                            {showAllUpcoming ? 'less' : 'more'}
                          </Button>
                        )}
                    </div>

                    <div className='grid grid-cols-1 md:grid-cols-3 md:gap-4 border md:border-none border-border rounded-xl'>
                      {displayScheduledCalls &&
                        displayScheduledCalls.length > 0 &&
                        displayScheduledCalls.map((call, i) => (
                          <UpcomingCallCard
                            key={call.id}
                            call={call}
                            allUsers={filteredUsers}
                            onCallClick={() => handleCallRowClick(call)}
                            onParticipantsClick={() => handleParticipantsClick(call)}
                            isLastItem={i === displayScheduledCalls.length - 1}
                            currentUserId={user?.id ?? ''}
                            onCancelClick={e => {
                              e.stopPropagation();
                              handleDeleteClick(call);
                            }}
                            onEditClick={e => {
                              e.stopPropagation();
                              handleEditClick(call);
                            }}
                          />
                        ))}
                    </div>
                  </div>
                )}

              {/* Recent Calls */}
              {filteredRecentCalls && filteredRecentCalls.length > 0 && (
                <div className='flex flex-col gap-4 w-full pb-20 md:pb-4'>
                  <span className='font-mono text-muted-foreground text-sm leading-5 font-medium uppercase cursor-default'>
                    recents
                  </span>
                  <div className='border border-border rounded-xl overflow-hidden'>
                    {searchQuery.trim() ? (
                      filteredRecentCalls.map((call, i) => (
                        <CallCard
                          key={call.id}
                          call={call}
                          currentUserId={user?.id}
                          isLastItem={i === filteredRecentCalls.length - 1}
                          onCallClick={() => handleCallRowClick(call)}
                          onParticipantsClick={() => handleParticipantsClick(call)}
                          handleGotoTranscript={getGotoTranscriptHandler(call)}
                          handleDownloadTranscript={() => handleDownloadTranscript(call)}
                        />
                      ))
                    ) : (
                      <Virtuoso
                        {...(scrollContainerRef.current
                          ? { customScrollParent: scrollContainerRef.current }
                          : {})}
                        data={filteredRecentCalls}
                        initialItemCount={Math.min(filteredRecentCalls.length, 20)}
                        endReached={() => {
                          if (hasMoreCalls) loadMoreCalls();
                        }}
                        rangeChanged={range => {
                          onVisibleRangeChanged(range.startIndex);
                        }}
                        computeItemKey={(_, call) => call.id}
                        itemContent={(i, call) => (
                          <CallCard
                            call={call}
                            currentUserId={user?.id}
                            isLastItem={i === filteredRecentCalls.length - 1}
                            onCallClick={() => handleCallRowClick(call)}
                            onParticipantsClick={() => handleParticipantsClick(call)}
                            handleGotoTranscript={getGotoTranscriptHandler(call)}
                            handleDownloadTranscript={() => handleDownloadTranscript(call)}
                          />
                        )}
                      />
                    )}
                  </div>
                </div>
              )}
              {filteredRecentCalls &&
                filteredRecentCalls.length === 0 &&
                displayScheduledCalls &&
                displayScheduledCalls.length === 0 &&
                (searchQuery.trim() ? (
                  <NoFiltredCalls searchQuery={searchQuery} />
                ) : (
                  <EmptyState
                    icon={Phone}
                    title='No Calls Yet'
                    description='Start a conversation by making your first call.'
                  />
                ))}
            </div>
          )}

          {/* Scheduled Calls Tab View */}
          {activeTab === 'upcoming' && viewMode === 'calendar' && (
            <div className='w-full h-full min-h-0 pb-6 overflow-hidden'>
              {calendarSubView === 'month' && (
                <CalendarMonthView
                  calls={calendarCalls}
                  currentMonth={currentMonthStart}
                  currentUserId={user?.id}
                  onCallClick={call => handleCallRowClick(call)}
                  onGotoMessage={call => handleGotoTranscript(call)}
                  onDownloadTranscript={call => handleDownloadTranscript(call)}
                  onEditClick={call => handleEditClick(call)}
                  onCreateCall={handleCreateCallOnDay}
                />
              )}
              {calendarSubView === 'week' && (
                <CalendarWeekView
                  calls={calendarCalls}
                  currentWeekStart={currentWeekStart}
                  currentUserId={user?.id}
                  onCallClick={call => handleCallRowClick(call)}
                  onGotoMessage={call => handleGotoTranscript(call)}
                  onDownloadTranscript={call => handleDownloadTranscript(call)}
                  onEditClick={call => handleEditClick(call)}
                  onCreateCallAtSlot={handleCreateCallAtSlot}
                />
              )}
              {calendarSubView === 'day' && (
                <CalendarDayView
                  calls={calendarCalls}
                  currentDay={currentDayStart}
                  currentUserId={user?.id}
                  onCallClick={call => handleCallRowClick(call)}
                  onGotoMessage={call => handleGotoTranscript(call)}
                  onDownloadTranscript={call => handleDownloadTranscript(call)}
                  onEditClick={call => handleEditClick(call)}
                  onCreateCallAtSlot={handleCreateCallAtSlot}
                />
              )}
            </div>
          )}

          {activeTab === 'upcoming' && viewMode === 'list' && (
            <div className='max-w-[810px] w-full mx-auto flex flex-col gap-4 pb-20 md:pb-4'>
              {tabContent && tabContent.length > 0 && (
                <div className='grid grid-cols-1 md:grid-cols-3 md:gap-4 border md:border-none border-gray-100 rounded-xl'>
                  {tabContent.map((call, i) => (
                    <UpcomingCallCard
                      key={call.id}
                      call={call}
                      allUsers={filteredUsers}
                      onCallClick={() => handleCallRowClick(call)}
                      onParticipantsClick={() => handleParticipantsClick(call)}
                      isLastItem={i === tabContent.length - 1}
                      currentUserId={user?.id ?? ''}
                      onCancelClick={e => {
                        e.stopPropagation();
                        handleDeleteClick(call);
                      }}
                      onEditClick={e => {
                        e.stopPropagation();
                        handleEditClick(call);
                      }}
                    />
                  ))}
                </div>
              )}
              {tabContent &&
                tabContent.length === 0 &&
                (searchQuery.trim() ? (
                  <NoFiltredCalls searchQuery={searchQuery} />
                ) : (
                  <EmptyState
                    icon={CalendarClock}
                    title='No Scheduled Calls'
                    description='Your calendar is clear. Schedule a call to get started.'
                  />
                ))}
            </div>
          )}

          {/* Missed Calls Tab View */}
          {activeTab === 'missed' && (
            <div className='max-w-[810px] w-full mx-auto flex flex-col gap-4 pb-20 md:pb-4'>
              {tabContent && tabContent.length > 0 && (
                <div className='border border-border rounded-xl'>
                  {tabContent.map((call, i) => (
                    <CallCard
                      key={call.id}
                      call={call}
                      currentUserId={user?.id}
                      isLastItem={i === tabContent.length - 1}
                      onCallClick={() => handleCallRowClick(call)}
                      onParticipantsClick={() => handleParticipantsClick(call)}
                      handleGotoTranscript={getGotoTranscriptHandler(call)}
                      handleDownloadTranscript={() => handleDownloadTranscript(call)}
                    />
                  ))}
                </div>
              )}
              {tabContent &&
                tabContent.length === 0 &&
                (searchQuery.trim() ? (
                  <NoFiltredCalls searchQuery={searchQuery} />
                ) : (
                  <EmptyState
                    icon={Megaphone}
                    title='No Missed Calls'
                    description="You haven't missed any calls. All caught up!"
                  />
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Participants Modal */}
      <ParticipantsModal
        isOpen={isParticipantsModalOpen}
        onClose={closeParticipantsModal}
        call={selectedCall}
        currentUserId={user?.id}
      />

      {/* Call Confirmation Modal */}
      <CallConfirmationModal
        isOpen={showConfirmModal}
        onClose={closeConfirmModal}
        onConfirm={handleConfirmCall}
        title={confirmModalConfig.title}
        subtitle={confirmModalConfig.subtitle}
      />

      {/* Schedule Call Modal (create) */}
      <ScheduleCallModal
        isOpen={isScheduleModalOpen}
        onClose={() => {
          setIsScheduleModalOpen(false);
          setScheduleInitialTime(null);
        }}
        initialStartsAt={scheduleInitialTime?.startsAt ?? null}
        initialEndsAt={scheduleInitialTime?.endsAt ?? null}
      />

      {/* Schedule Call Modal (edit) */}
      <ScheduleCallModal
        isOpen={editModalOpen}
        onClose={closeEditModal}
        mode='edit'
        initialCall={editModalCall}
        onSuccess={closeEditModal}
      />

      {/* Instant Call Modal */}
      <InstantCallModal
        isOpen={isInstantCallModalOpen}
        onClose={() => setIsInstantCallModalOpen(false)}
        onSubmit={handleInstantCall}
      />

      {/* Delete Call Modal */}
      <DeleteCallModal
        isOpen={deleteModalOpen}
        onClose={closeDeleteModal}
        onConfirm={handleDeleteConfirm}
        callLabel={
          deleteModalCall
            ? `${deleteModalCall.title ?? 'Scheduled Call'}${
                deleteModalCall.startsAt
                  ? ` | ${new Date(deleteModalCall.startsAt).toLocaleDateString('en-US', { weekday: 'short' })} ${new Date(deleteModalCall.startsAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`
                  : ''
              }`
            : ''
        }
        isRecurring={!!deleteModalCall?.recurringSeriesId}
      />
    </div>
  );
};

const EmptyState = ({ icon: Icon, title, description }: EmptyStateProps): ReactElement => {
  return (
    <div className='flex flex-col items-center justify-center h-full px-6 py-12'>
      <div className='size-12 rounded-xl bg-card border border-border flex items-center justify-center mb-4'>
        <Icon size={20} strokeWidth={1.5} className='text-muted-foreground' />
      </div>

      <h2 className='text-xl text-foreground font-light mb-4'>{title}</h2>

      <p className='text-sm text-muted-foreground text-center max-w-sm'>{description}</p>
    </div>
  );
};

const NoFiltredCalls = ({ searchQuery }: { searchQuery: string }): ReactElement => {
  return (
    <div className='flex flex-col items-center justify-center h-full px-6 py-12'>
      <p className='text-xs font-mono text-muted-foreground mb-6 tracking-widest'>[0 RESULTS]</p>

      <h2 className='text-xl text-foreground font-light mb-4'>Nothing matches</h2>

      <p className='text-sm text-muted-foreground text-center max-w-sm'>
        &quot;{searchQuery}&quot; didn&apos;t return any calls
      </p>
    </div>
  );
};

export default CallHistoryScreen;
