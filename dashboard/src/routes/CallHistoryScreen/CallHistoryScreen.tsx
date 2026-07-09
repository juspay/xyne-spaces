import {
  Calendar,
  CalendarDays,
  ChevronDown,
  Info,
  LayoutList,
  Loader2,
  LucideIcon,
  Phone,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { ReactElement, useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate, useOutlet } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import { useAuth } from '../../hooks/useAuth';
import { useCallHistory } from './useCallHistory';
import { CallStatus, InvitationResponse } from '@xyne/shared';
import { logger, Event } from '../../utils/logger';
import { dataLoadDuration, safeRecordMetric } from '../../services/otel';
import { CallConfirmationModal } from '../../components/Call/CallConfirmationModal';
import { DeleteCallModal } from '../../components/Call/DeleteCallModal';
import { InstantCallModal } from '../../components/Call/InstantCallModal/InstantCallModal';
import { ScheduleCallModal } from '../../components/Call/ScheduleCallModal/ScheduleCallModal';
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
import { isSameDay } from '../../utils/dateUtils';
import { mutators } from '../../zero/mutators';
import axios from 'axios';
import { API_BASE_URL } from '../../config';
import { CallCard } from './CallCard';
import {
  Call,
  isExternalCalendarEvent,
  isScheduledCallJoinable,
  RecentCallFilter,
  FILTER_LABELS,
} from './callHistoryItem.utils';
import { CallExternalChatDialog } from '../../components/Call/CallExternalChatDialog/CallExternalChatDialog';
import { GoogleCalendarIcon, MicrosoftIcon } from './CalendarIcons';
import { ParticipantsModal } from './ParticipantsModal';
import { getUserDisplayName } from '../../utils/userDisplayName';
import CalendarWeekView from './CalendarWeekView';
import CalendarDayView from './CalendarDayView';
import CalendarMonthView from './CalenderMonthView';
import { usePlatform } from '../../hooks/usePlatform';
import MeetWithPanel from './MeetWithPanel';
import { useOtherUserCalls } from '../../hooks/useOtherUserCalls';
import { UpcomingCallsList } from '../../components/Call/UpcomingCallsList';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function hasExternalChatAccess(call: Call): boolean {
  return (
    call.participants?.some(p => p.isExternal && p.response !== InvitationResponse.INVITED) ?? false
  );
}

const CallHistoryScreen = (): ReactElement => {
  const { isMobile } = usePlatform();
  const { user } = useAuth();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const allChannels = useAllChannels();

  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [scheduleInitialTime, setScheduleInitialTime] = useState<{
    startsAt: Date;
    endsAt: Date;
  } | null>(null);
  const [isInstantCallModalOpen, setIsInstantCallModalOpen] = useState(false);
  const [externalChatCallId, setExternalChatCallId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [calendarSubView, setCalendarSubView] = useState<'month' | 'week' | 'day'>(() =>
    isMobile ? 'day' : 'week',
  );
  const [calendarProvider, setCalendarProvider] = useState<'GOOGLE' | 'MICROSOFT' | null>(null);
  const [pendingAutoSync, setPendingAutoSync] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{
    text: string;
    ok: boolean;
    reauth?: boolean;
  } | null>(null);
  const [reauthCountdown, setReauthCountdown] = useState<{
    count: number;
    loginUrl: string;
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
  const [recentCallFilter, setRecentCallFilter] = useState<RecentCallFilter>('all');
  const [upcomingDay, setUpcomingDay] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const {
    calls,
    scheduledCalls,
    calendarScheduledCalls,
    missedCalls,
    isLoading,
    isScheduledCallsLoading,
    queryDetails,
    selectedCall,
    isParticipantsModalOpen,
    searchQuery,
    setSearchQuery,
    handleCallRowClick,
    handleParticipantsClick,
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
    deleteModalOpen,
    deleteModalCall,
    handleDeleteConfirm,
    closeDeleteModal,
    handleHideClick,
    handleEditClick,
    handleDeleteClick,
    editModalOpen,
    editModalCall,
    closeEditModal,
    showChannelCalls,
    setShowChannelCalls,
  } = useCallHistory(user?.id);

  const allUsers = useUsers();

  // Compute date range for the currently displayed calendar view
  const calendarFrom = useMemo(() => {
    if (calendarSubView === 'week') return currentWeekStart;
    if (calendarSubView === 'day') return currentDayStart;
    return currentMonthStart;
  }, [calendarSubView, currentWeekStart, currentDayStart, currentMonthStart]);

  const calendarTo = useMemo(() => {
    const d = new Date(calendarFrom);
    if (calendarSubView === 'week') d.setDate(d.getDate() + 7);
    else if (calendarSubView === 'day') d.setDate(d.getDate() + 1);
    else d.setMonth(d.getMonth() + 1);
    return d;
  }, [calendarFrom, calendarSubView]);

  const {
    selectedUsers: meetWithUsers,
    otherUsersCalls,
    addUser: addMeetWithUser,
    removeUser: removeMeetWithUser,
  } = useOtherUserCalls(calendarFrom, calendarTo);

  const otherUsersCallsArray = useMemo(
    () => Array.from(otherUsersCalls.values()),
    [otherUsersCalls],
  );

  const zero = useZero();
  const callHistoryLoadStartTimeRef = useRef<number | null>(null);
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Show a loader for at least 10 seconds (or until calls load) so the screen
  // doesn't flash the empty state while the Zero query is still warming up.
  const [showMinLoader, setShowMinLoader] = useState(true);
  useEffect(() => {
    if (!isLoading) {
      setShowMinLoader(false);
      return;
    }
    setShowMinLoader(true);
    const timer = setTimeout(() => setShowMinLoader(false), 10000);
    return () => clearTimeout(timer);
  }, [isLoading]);

  const showRecentCallsLoader = isLoading || (showMinLoader && (calls?.length ?? 0) === 0);

  // Fetch the current user's calendar provider once on mount.
  // If syncCalendar=true is in the URL (returning from connect-calendar OAuth),
  // strip the param and set pendingAutoSync so we fire sync once the provider is known.
  useEffect(() => {
    if (!user?.id) return;
    const params = new URLSearchParams(location.search);
    if (params.get('syncCalendar') === 'true') {
      params.delete('syncCalendar');
      void navigate(`${location.pathname}?${params.toString()}`, { replace: true });
      setPendingAutoSync(true);
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Tick the reauth countdown down every second, then redirect
  useEffect(() => {
    if (!reauthCountdown) return;
    if (reauthCountdown.count === 0) {
      const isElectron = typeof window.electronAPI?.openExternal === 'function';
      if (isElectron && window.electronAPI) {
        window.electronAPI.openExternal(reauthCountdown.loginUrl);
      } else {
        window.location.href = reauthCountdown.loginUrl;
      }
      return;
    }
    const timer = setTimeout(() => {
      setReauthCountdown(prev => (prev ? { ...prev, count: prev.count - 1 } : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [reauthCountdown]);

  // Fire the auto-sync once calendarProvider is loaded after OAuth redirect
  useEffect(() => {
    if (!pendingAutoSync || !calendarProvider) return;
    setPendingAutoSync(false);
    void handleCalendarSync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoSync, calendarProvider]);

  const handleCalendarSync = async (isRetry = false) => {
    if (!calendarProvider || isSyncing) return;
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const provider = calendarProvider === 'GOOGLE' ? 'google' : 'microsoft';
      await axios.post(`${API_BASE_URL}/calendar/sync/${provider}`, {}, { withCredentials: true });
      setSyncMessage({ text: 'Synced!', ok: true });
      setIsSyncing(false);
      setTimeout(() => setSyncMessage(null), 3000);
    } catch (error) {
      setIsSyncing(false);
      const responseError = axios.isAxiosError(error)
        ? (error.response?.data as { error?: string } | undefined)?.error
        : undefined;
      const shouldReauthorize =
        !isRetry &&
        axios.isAxiosError(error) &&
        error.response?.status === 401 &&
        responseError === 'calendar_reauth_required';

      if (shouldReauthorize) {
        const isElectron = typeof window.electronAPI?.openExternal === 'function';
        const platformParam = isElectron ? '&platform=electron' : '';
        const loginUrl =
          calendarProvider === 'MICROSOFT'
            ? `${API_BASE_URL}/v2/auth/microsoft/login?connectCalendar=true${platformParam}`
            : `${API_BASE_URL}/v2/auth/login?connectCalendar=true${platformParam}`;
        setSyncMessage({ text: '', ok: false, reauth: true });
        setReauthCountdown({ count: 5, loginUrl });
        return;
      }
      setSyncMessage({ text: 'Unable to sync', ok: false });
      setTimeout(() => setSyncMessage(null), 3000);
    }
  };

  const endedCallsCount = calls?.filter(c => c.status === CallStatus.ENDED).length ?? 0;

  const searchParams = new URLSearchParams(location.search);
  const callIdParam = searchParams.get('callId');

  // When navigating from an activity with a callId, jump the calendar to the call's date,
  // then remove callId from the URL so switching sub-views doesn't re-open the popup.
  useEffect(() => {
    if (!callIdParam) return;
    const allCalls = [...(calls || []), ...(scheduledCalls || [])];
    const target = allCalls.find(c => c.id === callIdParam);
    if (!target?.startsAt) return;

    const callDate = new Date(target.startsAt);

    const month = new Date(callDate.getFullYear(), callDate.getMonth(), 1);
    month.setHours(0, 0, 0, 0);
    setCurrentMonthStart(month);

    const weekStart = new Date(callDate);
    weekStart.setDate(callDate.getDate() - callDate.getDay());
    weekStart.setHours(0, 0, 0, 0);
    setCurrentWeekStart(weekStart);

    const dayStart = new Date(callDate);
    dayStart.setHours(0, 0, 0, 0);
    setCurrentDayStart(dayStart);

    // Force calendar view — notifications deep-link expects the popup to open on a calendar.
    // The page defaults to list mode in the new design, so without this the popup never shows.
    setViewMode('calendar');

    // Remove callId (and legacy tab param) from URL so switching sub-views doesn't re-open the popup
    const params = new URLSearchParams(location.search);
    params.delete('callId');
    params.delete('tab');
    void navigate(`${location.pathname}${params.toString() ? `?${params.toString()}` : ''}`, {
      replace: true,
    });
  }, [callIdParam, calls, scheduledCalls]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isMobile) return;
    const rafId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(rafId);
  }, [isMobile]);

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
    }
    return currentDayStart.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

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
    }
    const next = new Date(currentDayStart);
    next.setDate(next.getDate() + 1);
    return next > maxCalendarDate;
  }, [calendarSubView, currentMonthStart, currentWeekStart, currentDayStart, maxCalendarDate]);

  const isTodayDisabled = useMemo(() => {
    const today = new Date();
    if (calendarSubView === 'month') return isSameMonth(currentMonthStart, today);
    if (calendarSubView === 'week') {
      const todayWeekStart = new Date(today);
      todayWeekStart.setDate(today.getDate() - today.getDay());
      todayWeekStart.setHours(0, 0, 0, 0);
      return currentWeekStart.getTime() === todayWeekStart.getTime();
    }
    return isSameDay(currentDayStart, today);
  }, [calendarSubView, currentMonthStart, currentWeekStart, currentDayStart]);

  const allUsersData = useUsers();

  const filterCallsBySearchQuery = (callsList: Call[], query: string): Call[] => {
    if (!query.trim()) return callsList;
    const lowerQuery = query.toLowerCase();
    return callsList.filter(call => {
      if (call.title?.toLowerCase().includes(lowerQuery)) return true;
      const channel = allChannels.find(c => c.id === call.channelId);
      if (channel?.name?.toLowerCase().includes(lowerQuery)) return true;
      const participantNames = call.participants
        ?.map(p => {
          if (p.isExternal) return (p.displayName || p.email || '').toLowerCase();
          const u = allUsersData.find(u => u.id === p.userId);
          return getUserDisplayName(u).toLowerCase();
        })
        .join(' ');
      if (participantNames?.includes(lowerQuery)) return true;
      const participantEmails = call.participants
        ?.map(p => {
          if (p.isExternal) return p.email?.toLowerCase() || '';
          const u = allUsersData.find(u => u.id === p.userId);
          return u?.email?.toLowerCase() || '';
        })
        .join(' ');
      if (participantEmails?.includes(lowerQuery)) return true;
      return false;
    });
  };

  const filteredScheduledCalls = searchQuery.trim()
    ? filterCallsBySearchQuery(scheduledCalls || [], searchQuery)
    : scheduledCalls;

  const filteredCalendarScheduledCalls = searchQuery.trim()
    ? filterCallsBySearchQuery(calendarScheduledCalls || [], searchQuery)
    : calendarScheduledCalls;

  const limitedScheduledCalls = useMemo(() => {
    if (!filteredScheduledCalls) return filteredScheduledCalls;
    return filteredScheduledCalls.filter(call => !isExternalCalendarEvent(call));
  }, [filteredScheduledCalls]);

  const filteredRecentCalls = searchQuery.trim()
    ? filterCallsBySearchQuery(calls || [], searchQuery)
    : calls;

  const filteredRecentCallsNoGcal = filteredRecentCalls?.filter(
    call => !isExternalCalendarEvent(call),
  );

  const filteredMissedCalls = (
    searchQuery.trim() ? filterCallsBySearchQuery(missedCalls || [], searchQuery) : missedCalls
  )?.filter(call => !isExternalCalendarEvent(call));

  const calendarCalls = useMemo(() => {
    const combined = [...(filteredRecentCalls || []), ...(filteredCalendarScheduledCalls || [])];
    const seenCallIds = new Set<string>();
    return combined.filter(call => {
      if (seenCallIds.has(call.id)) return false;
      seenCallIds.add(call.id);
      return true;
    });
  }, [filteredRecentCalls, filteredCalendarScheduledCalls]);

  const displayRecentCalls = useMemo(() => {
    const base = filteredRecentCallsNoGcal || [];
    let filtered: typeof base;
    switch (recentCallFilter) {
      case 'incoming':
        filtered = base.filter(c => c.createdByUserId !== user?.id);
        break;
      case 'outgoing':
        filtered = base.filter(c => c.createdByUserId === user?.id);
        break;
      case 'active':
        filtered = base.filter(c => c.status === CallStatus.ACTIVE || isScheduledCallJoinable(c));
        break;
      case 'missed':
        filtered = filteredMissedCalls || [];
        break;
      default:
        filtered = base;
    }
    // Active/joinable calls always float to the top
    return [...filtered].sort((a, b) => {
      const aTop = a.status === CallStatus.ACTIVE || isScheduledCallJoinable(a) ? 0 : 1;
      const bTop = b.status === CallStatus.ACTIVE || isScheduledCallJoinable(b) ? 0 : 1;
      return aTop - bTop;
    });
  }, [filteredRecentCallsNoGcal, filteredMissedCalls, recentCallFilter, user?.id]);

  if (queryDetails.type === 'error') {
    return (
      <div className='flex items-center justify-center h-full'>
        <div className='text-sm text-red-500'>Error loading call history</div>
      </div>
    );
  }

  if (outlet) return outlet;

  return (
    <div
      ref={setScrollContainer}
      className={cn(
        'bg-background flex flex-col w-full h-full md:rounded-2xl shadow-md relative',
        viewMode === 'calendar' ? 'overflow-hidden' : 'overflow-y-auto',
      )}
    >
      <div
        className={cn(
          'w-full flex flex-col items-center px-4',
          viewMode === 'calendar' && 'flex-1 min-h-0',
        )}
      >
        {/* Sticky header */}
        <div className='max-w-[860px] w-full sticky top-0 bg-background z-50 flex flex-col gap-3 pt-4 pb-6 sm:pb-3'>
          {/* Row 1: Title + calendar sync */}
          <div className='flex items-center justify-between'>
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
                    {reauthCountdown ? (
                      <>
                        <span className='md:hidden'>{`Redirecting in ${reauthCountdown.count}s…`}</span>
                        <span className='hidden md:inline'>{`Need calendar access, redirecting to login in ${reauthCountdown.count}s…`}</span>
                      </>
                    ) : syncMessage ? (
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
            </div>
          </div>

          {/* Row 2: Search + Include all channel calls toggle */}
          <div className='flex items-center justify-between gap-4'>
            <div className='relative flex-1 max-w-full md:max-w-[350px]'>
              <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground size-4' />
              <Input
                ref={searchInputRef}
                type='text'
                placeholder='Search calls'
                value={searchQuery}
                maxLength={56}
                onChange={e => setSearchQuery(e.target.value)}
                className='pl-8 w-full placeholder:text-muted-foreground rounded-xl focus-visible:ring-0 duration-300 ease-in-out'
                data-testid='user-search-input'
              />
            </div>
            <div className='flex items-center gap-3 shrink-0'>
              <label
                htmlFor='channel-calls-toggle'
                className='hidden md:block text-sm text-muted-foreground whitespace-nowrap cursor-pointer select-none'
              >
                Include all channel calls
              </label>
              <Switch
                id='channel-calls-toggle'
                checked={showChannelCalls}
                onCheckedChange={setShowChannelCalls}
              />
              <Tooltip content='Include all channel calls' side='bottom'>
                <button className='md:hidden text-muted-foreground flex items-center'>
                  <Info className='size-4' />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
        {/* Page body */}
        <div
          className={cn(
            'max-w-[860px] w-full flex flex-col gap-6',
            viewMode === 'calendar' ? 'flex-1 min-h-0' : 'pb-6',
          )}
        >
          {/* Action cards */}
          <div className='grid grid-cols-2 gap-3' data-testid='new-call-button'>
            <button
              data-testid='start-instant-call-option'
              onClick={() => setIsInstantCallModalOpen(true)}
              data-track-category='Calls'
              data-track-name='start-instant-call'
              className='flex items-center gap-4 p-2.5 sm:p-4 rounded-xl border border-border hover:bg-accent/50 transition-colors text-left'
            >
              <div className='size-6 rounded-md bg-action-primary flex items-center justify-center shrink-0'>
                <Plus className='size-4 text-action-primary-foreground' strokeWidth={2.5} />
              </div>
              <div className='flex flex-col min-w-0 gap-0.5'>
                <p className='text-sm font-medium text-foreground'>
                  <span className='sm:hidden'>Instant call</span>
                  <span className='hidden sm:inline'>Start an instant call</span>
                </p>
                <p className='hidden sm:block text-xs text-muted-foreground'>
                  Connect right away and begin your conversation.
                </p>
              </div>
            </button>
            <button
              data-testid='schedule-call-option'
              onClick={() => setIsScheduleModalOpen(true)}
              data-track-category='Calls'
              data-track-name='schedule-call'
              className='flex items-center gap-4 p-2.5 sm:p-4 rounded-xl border border-border hover:bg-accent/50 transition-colors text-left'
            >
              <div className='size-6 rounded-md bg-blue-500 flex items-center justify-center shrink-0'>
                <CalendarDays className='size-4 text-white' />
              </div>
              <div className='flex flex-col min-w-0 gap-0.5'>
                <p className='text-sm font-medium text-foreground'>
                  <span className='sm:hidden'>Schedule call</span>
                  <span className='hidden sm:inline'>Schedule a call</span>
                </p>
                <p className='hidden sm:block text-xs text-muted-foreground'>
                  Pick a time that works for everyone and plan ahead.
                </p>
              </div>
            </button>
          </div>

          {/* UPCOMING section */}
          <div className={cn('flex flex-col gap-3', viewMode === 'calendar' && 'flex-1 min-h-0')}>
            <div className='flex items-center justify-between shrink-0'>
              <span className='text-xs font-semibold tracking-widest text-muted-foreground uppercase'>
                Upcoming
              </span>
              <div className='flex items-center gap-1.5'>
                {/* Day navigation — list mode only */}
                {viewMode === 'list' &&
                  (() => {
                    const todayMidnight = new Date();
                    todayMidnight.setHours(0, 0, 0, 0);
                    const isPrevDisabled = isSameDay(upcomingDay, todayMidnight);
                    return (
                      <>
                        <button
                          onClick={() =>
                            setUpcomingDay(d => {
                              const prev = new Date(d);
                              prev.setDate(prev.getDate() - 1);
                              return prev;
                            })
                          }
                          disabled={isPrevDisabled}
                          data-track-category='Calls'
                          data-track-name='upcoming-prev-day'
                          className={cn(
                            'p-1.5 rounded transition-colors',
                            isPrevDisabled
                              ? 'text-muted-foreground/30 cursor-not-allowed'
                              : 'hover:bg-muted text-muted-foreground',
                          )}
                          aria-label='Previous day'
                        >
                          <ChevronDown className='size-4 rotate-90' />
                        </button>
                        <button
                          onClick={() =>
                            setUpcomingDay(d => {
                              const next = new Date(d);
                              next.setDate(next.getDate() + 1);
                              return next;
                            })
                          }
                          data-track-category='Calls'
                          data-track-name='upcoming-next-day'
                          className='p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground'
                          aria-label='Next day'
                        >
                          <ChevronDown className='size-4 -rotate-90' />
                        </button>
                      </>
                    );
                  })()}
                {/* Calendar mode controls */}
                {viewMode === 'calendar' && (
                  <>
                    <span className='text-sm font-semibold text-foreground hidden sm:block min-w-[130px]'>
                      {calendarTitle()}
                    </span>
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
                    {/* Meet With inline — desktop only */}
                    <div className='min-w-[220px] w-64 shrink-0 hidden sm:block'>
                      <MeetWithPanel
                        allUsers={allUsers}
                        currentUserId={user?.id}
                        selectedUsers={meetWithUsers}
                        otherUsersCalls={otherUsersCalls}
                        onAddUser={addMeetWithUser}
                        onRemoveUser={removeMeetWithUser}
                        hideHeading
                      />
                    </div>
                    <div className='w-px h-6 bg-border shrink-0 hidden sm:block' />
                    <button
                      onClick={handleCalendarToday}
                      disabled={isTodayDisabled}
                      data-track-category='Calls'
                      data-track-name='calendar-today'
                      className={cn(
                        'px-2.5 py-1.5 text-sm font-medium border border-border rounded-lg transition-colors',
                        isTodayDisabled
                          ? 'text-muted-foreground/50 cursor-not-allowed'
                          : 'hover:bg-muted text-foreground',
                      )}
                    >
                      Today
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className='flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors text-foreground'>
                          {calendarSubView.charAt(0).toUpperCase() + calendarSubView.slice(1)}
                          <ChevronDown className='size-3.5' />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end' sideOffset={6} className='rounded-xl w-28'>
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
                  </>
                )}

                {/* List / Calendar toggle */}
                <div className='flex items-center border border-border rounded-lg overflow-hidden'>
                  <button
                    onClick={() => setViewMode('list')}
                    data-track-category='Calls'
                    data-track-name='switch-to-list'
                    className={cn(
                      'p-2 transition-colors',
                      viewMode === 'list'
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted/50',
                    )}
                    aria-label='List view'
                  >
                    <LayoutList className='size-4' />
                  </button>
                  <button
                    onClick={() => setViewMode('calendar')}
                    data-track-category='Calls'
                    data-track-name='switch-to-calendar'
                    className={cn(
                      'p-2 transition-colors',
                      viewMode === 'calendar'
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted/50',
                    )}
                    aria-label='Calendar view'
                  >
                    <Calendar className='size-4' />
                  </button>
                </div>
              </div>
            </div>

            {viewMode === 'list' ? (
              isScheduledCallsLoading ? (
                <div className='py-10 flex items-center justify-center'>
                  <Loader2 className='w-6 h-6 animate-spin text-muted-foreground' />
                </div>
              ) : (
                <UpcomingCallsList
                  grouped
                  calls={limitedScheduledCalls || []}
                  selectedDay={upcomingDay}
                  onCallClick={undefined}
                  onJoinCall={call => handleCallRowClick(call)}
                  onEditCall={call => handleEditClick(call)}
                  onCancelCall={call => handleDeleteClick(call)}
                  currentUserId={user?.id}
                />
              )
            ) : (
              <div className='flex-1 min-h-0 overflow-hidden pb-3'>
                {calendarSubView === 'month' && (
                  <CalendarMonthView
                    calls={calendarCalls}
                    currentMonth={currentMonthStart}
                    currentUserId={user?.id}
                    onCallClick={call => handleCallRowClick(call)}
                    onGotoMessage={call => handleGotoTranscript(call)}
                    onDownloadTranscript={call => handleDownloadTranscript(call)}
                    onEditClick={call => handleEditClick(call)}
                    onHideClick={(call, options) => handleHideClick(call, options)}
                    onDeleteClick={call => handleDeleteClick(call)}
                    onCreateCall={handleCreateCallOnDay}
                    otherUsersCalls={otherUsersCallsArray}
                    initialOpenCallId={callIdParam}
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
                    onHideClick={(call, options) => handleHideClick(call, options)}
                    onDeleteClick={call => handleDeleteClick(call)}
                    onCreateCallAtSlot={handleCreateCallAtSlot}
                    otherUsersCalls={otherUsersCallsArray}
                    initialOpenCallId={callIdParam}
                  />
                )}
                {calendarSubView === 'day' && (
                  <CalendarDayView
                    calls={calendarCalls}
                    currentDay={currentDayStart}
                    currentUserId={user?.id}
                    currentUser={user}
                    onCallClick={call => handleCallRowClick(call)}
                    onGotoMessage={call => handleGotoTranscript(call)}
                    onDownloadTranscript={call => handleDownloadTranscript(call)}
                    onEditClick={call => handleEditClick(call)}
                    onHideClick={(call, options) => handleHideClick(call, options)}
                    onDeleteClick={call => handleDeleteClick(call)}
                    onCreateCallAtSlot={handleCreateCallAtSlot}
                    otherUsersCalls={otherUsersCallsArray}
                    initialOpenCallId={callIdParam}
                  />
                )}
              </div>
            )}
          </div>

          {/* RECENTS section — list mode only */}
          {viewMode === 'list' && (
            <div className='flex flex-col gap-3 pb-20 md:pb-4'>
              <div className='flex items-center justify-between'>
                <span className='text-xs font-semibold tracking-widest text-muted-foreground uppercase'>
                  Recents
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className='flex items-center gap-1 px-2.5 py-1 text-sm font-medium text-foreground border border-border rounded-lg hover:bg-accent transition-colors focus:outline-none'>
                      {FILTER_LABELS[recentCallFilter]}
                      <ChevronDown className='size-3' />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='rounded-xl w-44'>
                    {(Object.keys(FILTER_LABELS) as RecentCallFilter[]).map(f => (
                      <DropdownMenuItem
                        key={f}
                        className={cn(
                          'text-sm rounded-lg cursor-pointer',
                          recentCallFilter === f && 'font-medium',
                        )}
                        onSelect={() => setRecentCallFilter(f)}
                      >
                        {FILTER_LABELS[f]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {displayRecentCalls.length === 0 ? (
                showRecentCallsLoader ? (
                  <div className='py-10 flex items-center justify-center'>
                    <Loader2 className='w-6 h-6 animate-spin text-muted-foreground' />
                  </div>
                ) : searchQuery.trim() ? (
                  <NoFiltredCalls searchQuery={searchQuery} />
                ) : (
                  <EmptyState
                    icon={Phone}
                    title='No Calls Yet'
                    description='Start a conversation by making your first call.'
                  />
                )
              ) : (
                <div className='flex flex-col gap-3 -mx-3' data-testid='call-history-list'>
                  {searchQuery.trim() ? (
                    displayRecentCalls.map((call, i) => (
                      <CallCard
                        key={call.id}
                        call={call}
                        currentUserId={user?.id}
                        isLastItem={i === displayRecentCalls.length - 1}
                        onCallClick={() => handleCallRowClick(call)}
                        onParticipantsClick={() => handleParticipantsClick(call)}
                        handleGotoTranscript={getGotoTranscriptHandler(call)}
                        handleDownloadTranscript={() => handleDownloadTranscript(call)}
                        onViewExternalChat={
                          hasExternalChatAccess(call)
                            ? () => setExternalChatCallId(call.externalId)
                            : undefined
                        }
                        isRecentCall
                        onDetailClick={() => {
                          void navigate(`${call.id}/detail`, { state: { call } });
                        }}
                      />
                    ))
                  ) : (
                    <Virtuoso
                      {...(scrollContainer ? { customScrollParent: scrollContainer } : {})}
                      data={displayRecentCalls}
                      initialItemCount={Math.min(displayRecentCalls.length, 20)}
                      endReached={() => {
                        if (hasMoreCalls) loadMoreCalls();
                      }}
                      rangeChanged={range => {
                        onVisibleRangeChanged(range.startIndex);
                      }}
                      computeItemKey={(_, call) => call.id}
                      itemContent={(i, call) => (
                        <div className='pb-3'>
                          <CallCard
                            call={call}
                            currentUserId={user?.id}
                            isLastItem={i === displayRecentCalls.length - 1}
                            onCallClick={() => handleCallRowClick(call)}
                            onParticipantsClick={() => handleParticipantsClick(call)}
                            handleGotoTranscript={getGotoTranscriptHandler(call)}
                            handleDownloadTranscript={() => handleDownloadTranscript(call)}
                            onViewExternalChat={
                              hasExternalChatAccess(call)
                                ? () => setExternalChatCallId(call.externalId)
                                : undefined
                            }
                            isRecentCall
                            onDetailClick={() => {
                              void navigate(`${call.id}/detail`, { state: { call } });
                            }}
                          />
                        </div>
                      )}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ParticipantsModal
        isOpen={isParticipantsModalOpen}
        onClose={closeParticipantsModal}
        call={selectedCall}
        currentUserId={user?.id}
      />

      <CallConfirmationModal
        isOpen={showConfirmModal}
        onClose={closeConfirmModal}
        onConfirm={handleConfirmCall}
        title={confirmModalConfig.title}
        subtitle={confirmModalConfig.subtitle}
      />

      <ScheduleCallModal
        isOpen={isScheduleModalOpen}
        onClose={() => {
          setIsScheduleModalOpen(false);
          setScheduleInitialTime(null);
        }}
        initialStartsAt={scheduleInitialTime?.startsAt ?? null}
        initialEndsAt={scheduleInitialTime?.endsAt ?? null}
        initialParticipants={meetWithUsers.length > 0 ? meetWithUsers.map(u => u.id) : null}
      />

      <ScheduleCallModal
        isOpen={editModalOpen}
        onClose={closeEditModal}
        mode='edit'
        initialCall={editModalCall}
        onSuccess={closeEditModal}
      />

      <InstantCallModal
        isOpen={isInstantCallModalOpen}
        onClose={() => setIsInstantCallModalOpen(false)}
        onSubmit={handleInstantCall}
      />

      <CallExternalChatDialog
        open={!!externalChatCallId}
        onOpenChange={open => !open && setExternalChatCallId(null)}
        callExternalId={externalChatCallId ?? ''}
      />

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
      <h2 className='text-lg text-foreground font-medium mb-1'>No calls found for {searchQuery}</h2>
    </div>
  );
};

export default CallHistoryScreen;
