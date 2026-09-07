import {
  Calendar,
  CalendarDays,
  ChevronDown,
  LayoutList,
  Loader2,
  LucideIcon,
  Phone,
  Plus,
} from 'lucide-react';
import {
  ReactElement,
  type UIEvent,
  useCallback,
  useEffect,
  useState,
  useRef,
  useMemo,
} from 'react';
import { useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import { useAuth } from '../../hooks/useAuth';
import { useCallHistory } from './useCallHistory';
import {
  CallOrigin,
  CallStatus,
  CallType,
  CallVisibility,
  ChannelScopeType,
  InvitationResponse,
  MeetingStatus,
  TagMethod,
} from '@xyne/shared';
import { logger, Event } from '../../utils/logger';
import { dataLoadDuration, safeRecordMetric } from '../../services/otel';
import AppNavigator from '../../components/AppNavigator/AppNavigator';
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
import { useActiveUserSearch, useUsers } from '../../hooks/useUsers';
import { useAllChannels } from '../../hooks/useChannels';
import { useZero } from '../../hooks/useZero';
import { cn } from '../../utils/classNames';
import { isSameDay } from '../../utils/dateUtils';
import { mutators } from '../../zero/mutators';
import { CallCard } from './CallCard';
import {
  Call,
  isMissedCallForUser,
  isExternalCalendarEvent,
  isScheduledCallJoinable,
  RecentCallFilter,
  FILTER_LABELS,
} from './callHistoryItem.utils';
import { CallLabelFilter } from './CallLabelFilter';
import { useResolvedRecordingLabels } from '../../hooks/useResolvedRecordingLabels';
import { normalizeRecordingTags } from '../../utils/recordingUtils';
import { CallExternalChatDialog } from '../../components/Call/CallExternalChatDialog/CallExternalChatDialog';
import { ParticipantsModal } from './ParticipantsModal';
import CalendarWeekView from './CalendarWeekView';
import CalendarDayView from './CalendarDayView';
import CalendarMonthView from './CalenderMonthView';
import { usePlatform } from '../../hooks/usePlatform';
import MeetWithPanel from './MeetWithPanel';
import { useOtherUserCalls } from '../../hooks/useOtherUserCalls';
import { UpcomingCallsList } from '../../components/Call/UpcomingCallsList';
import { useSearchMetrics } from '../../hooks/useSearchMetrics';
import type { DisplaySearchResult } from '../../types/search';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { ChipType, TabType } from '../../components/Chat/ChatDirectory/ChannelCommandMenu.types';
import { type InitialQueryData } from '../../components/Chat/ChatDirectory/LexicalSearchInput';
import { CallHistorySearchPanel } from './CallHistorySearchPanel';
import { useCalendarSync } from '../../hooks/useCalendarSync';

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

function isDmScope(scopeType: ChannelScopeType | string | null | undefined): boolean {
  return scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM;
}

function isVisibleInCallList(
  call: Call,
  currentUserId: string | undefined,
  showChannelCalls: boolean,
): boolean {
  if (isExternalCalendarEvent(call)) return true;
  if (showChannelCalls) return true;
  return call.participants?.some(p => p.userId === currentUserId) ?? false;
}

function stripSearchHighlight(value: string | undefined): string {
  return (value || '').replace(/<\/?hi>/g, '');
}

function timestampOrUndefined(value: number | undefined): number | undefined {
  return value && value > 0 ? value : undefined;
}

function isJoinedInvitationResponse(response: string): boolean {
  return (
    response === String(InvitationResponse.ACCEPTED) || response === String(InvitationResponse.LEFT)
  );
}

function mapVespaCallResultToCall(result: DisplaySearchResult, workspaceId: string): Call {
  const context = result.searchContext;
  const callId = context?.callId || result.id;
  const startedAt =
    timestampOrUndefined(context?.startedAt) ||
    timestampOrUndefined(context?.startsAt) ||
    Date.now();
  const now = Date.now();
  const participantResponses = context?.participantResponses || [];
  const participantUserIds = context?.userIds || [];
  const participantNames = context?.participantNames || [];
  const participantEmails = context?.participantEmails || [];
  const participantCount = Math.max(
    participantUserIds.length,
    participantResponses.length,
    participantNames.length,
    participantEmails.length,
  );

  return {
    workspaceId,
    id: callId,
    externalId: context?.externalId || callId,
    title: stripSearchHighlight(context?.title || result.title) || null,
    createdByUserId: context?.createdByUserId || '',
    organizerId: null,
    channelId: context?.channelId || null,
    orgName: null,
    description: null,
    callType: CallType.VIDEO,
    callOrigin: (context?.callOrigin as CallOrigin | undefined) ?? CallOrigin.CHANNEL,
    status: (context?.status as CallStatus | undefined) ?? CallStatus.ENDED,
    roomLink: context?.roomLink || null,
    startsAt: timestampOrUndefined(context?.startsAt) ?? null,
    endsAt: timestampOrUndefined(context?.endsAt) ?? null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    isRecurring: Boolean(context?.recurringSeriesId),
    recurringSeriesId: context?.recurringSeriesId || null,
    recurrenceRule: null,
    instanceDate: null,
    recordingEnabled: false,
    recordingUrl: null,
    recordingParticipants: '[]',
    transcript: context?.hasTranscript ? 'available' : undefined,
    aiSummary: null,
    startedAt,
    endedAt: timestampOrUndefined(context?.endedAt) ?? null,
    lastActivityAt: timestampOrUndefined(context?.endedAt) || startedAt,
    createdAt: startedAt,
    updatedAt: now,
    metadata: null,
    callUpdatesChannel: null,
    participantCount,
    participantPreviewUserIds: JSON.stringify(
      participantUserIds
        .map((userId, index) =>
          userId
            ? {
                userId,
                hasJoined: isJoinedInvitationResponse(participantResponses[index] || ''),
              }
            : null,
        )
        .filter((entry): entry is { userId: string; hasJoined: boolean } => entry !== null),
    ),
    summaryTemplateId: null,
    labels: [],
    markedItems: [],
    xyneManaged: false,
    visibility: CallVisibility.PRIVATE,
    participants: Array.from({ length: participantCount }, (_, index) => {
      const userId = participantUserIds[index] || '';
      const displayName = stripSearchHighlight(participantNames[index]);
      const email = stripSearchHighlight(participantEmails[index]);
      const isExternal = !userId;

      return {
        workspaceId,
        id: `${callId}:${userId || `external-${index}`}`,
        callId,
        userId,
        invitedBy: context?.createdByUserId || '',
        invitedAt: startedAt,
        response: (participantResponses[index] as InvitationResponse | undefined) || null,
        meetingStatus: MeetingStatus.PENDING,
        respondedAt: null,
        joinedAt: null,
        leftAt: null,
        metadata: null,
        displayName: displayName || null,
        email: email || null,
        isExternal,
      };
    }),
  } as Call;
}

const CallHistoryScreen = (): ReactElement => {
  const { isMobile } = usePlatform();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const { calendarProvider, isSyncing, syncMessage, reauthCountdown, syncCalendar } =
    useCalendarSync(user?.id);

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
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
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
  const allChannels = useAllChannels();
  const [callMentionSearchType, setCallMentionSearchType] = useState<ChipType | null>(null);
  const [callMentionSearchQuery, setCallMentionSearchQuery] = useState('');
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [hasNavigatedMentions, setHasNavigatedMentions] = useState(false);
  const insertMentionRef = useRef<
    ((item: { id: string; name: string; email?: string }) => void) | null
  >(null);
  const {
    searchResults: vespaCallSearchResults,
    isSearching: isVespaCallSearching,
    text: searchQuery,
    setText: setSearchQuery,
    selectedMentions: callSearchSelectedMentions,
    setSelectedMentions: setCallSearchSelectedMentions,
    setActiveTab: setCallSearchActiveTab,
    isLoadingMore: isLoadingMoreCallSearchResults,
    loadMore: loadMoreCallSearchResults,
  } = useSearchMetrics({
    isCallSearchPage: true,
    mentionSearchType: callMentionSearchType,
  });
  const titleSearchQuery = searchQuery.trim();
  const userMentionResults = useActiveUserSearch(
    callMentionSearchType === ChipType.USER ? callMentionSearchQuery : '',
    8,
  );
  const selectedCallSearchUserIds = useMemo(
    () =>
      callSearchSelectedMentions
        .filter(mention => mention.type === ChipType.USER)
        .map(mention => mention.id),
    [callSearchSelectedMentions],
  );
  const selectedCallSearchChannelIds = useMemo(
    () =>
      callSearchSelectedMentions
        .filter(mention => mention.type === ChipType.CHANNEL)
        .map(mention => mention.id),
    [callSearchSelectedMentions],
  );
  const channelMentionResults = useMemo(() => {
    if (callMentionSearchType !== ChipType.CHANNEL) return [];
    const query = callMentionSearchQuery.trim().toLowerCase();
    const selected = new Set(selectedCallSearchChannelIds);

    return allChannels
      .filter(channel => !isDmScope(channel.scopeType))
      .filter(channel => !selected.has(channel.id))
      .filter(channel => {
        if (!query) return true;
        return (channel.name || channel.id).toLowerCase().includes(query);
      })
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
      .slice(0, 8);
  }, [allChannels, callMentionSearchQuery, callMentionSearchType, selectedCallSearchChannelIds]);
  const filteredUserMentionResults = useMemo(() => {
    const selected = new Set(selectedCallSearchUserIds);
    const query = callMentionSearchQuery.trim().toLowerCase();

    return userMentionResults
      .filter(candidate => !selected.has(candidate.id))
      .filter(candidate => {
        if (!query) return true;
        return [getUserDisplayName(candidate), candidate.name, candidate.email].some(value =>
          value?.toLowerCase().includes(query),
        );
      })
      .slice(0, 8);
  }, [callMentionSearchQuery, selectedCallSearchUserIds, userMentionResults]);
  const hasCallSearchFilters =
    selectedCallSearchUserIds.length > 0 || selectedCallSearchChannelIds.length > 0;
  const callSearchInitialQuery = useMemo<InitialQueryData | null>(() => {
    const mentions = callSearchSelectedMentions
      .filter(mention => mention.type === ChipType.USER || mention.type === ChipType.CHANNEL)
      .map(mention => ({
        id: mention.id,
        name: mention.name || mention.id,
        type: mention.type,
        prefix: mention.type === ChipType.USER ? ('with:' as const) : ('in:' as const),
      }));

    return searchQuery || mentions.length > 0 ? { text: searchQuery, mentions } : null;
  }, [callSearchSelectedMentions, searchQuery]);
  const isRestoringCallSearchRef = useRef(false);

  useEffect(() => {
    if (outlet && (searchQuery || callSearchSelectedMentions.length > 0)) {
      isRestoringCallSearchRef.current = true;
    }
  }, [callSearchSelectedMentions.length, outlet, searchQuery]);

  const closeCallMentionSearch = useCallback(() => {
    setCallMentionSearchType(null);
    setCallMentionSearchQuery('');
    setSelectedMentionIndex(0);
    setHasNavigatedMentions(false);
  }, []);

  const handleCallUserSearch = useCallback(
    (query: string | null) => {
      if (query === null) {
        closeCallMentionSearch();
        return;
      }
      setCallMentionSearchType(ChipType.USER);
      setCallMentionSearchQuery(query);
      setSelectedMentionIndex(0);
      setHasNavigatedMentions(false);
    },
    [closeCallMentionSearch],
  );

  const handleCallChannelSearch = useCallback(
    (query: string | null) => {
      if (query === null) {
        closeCallMentionSearch();
        return;
      }
      setCallMentionSearchType(ChipType.CHANNEL);
      setCallMentionSearchQuery(query);
      setSelectedMentionIndex(0);
      setHasNavigatedMentions(false);
    },
    [closeCallMentionSearch],
  );

  const handleCallSearchChange = useCallback(
    (text: string, mentions: Array<{ id: string; type: ChipType; prefix?: string }>) => {
      if (isRestoringCallSearchRef.current) {
        if (!text && mentions.length === 0) return;
        isRestoringCallSearchRef.current = false;
      }

      setSearchQuery(text);
      setCallSearchSelectedMentions(
        mentions
          .filter(mention => mention.type === ChipType.USER || mention.type === ChipType.CHANNEL)
          .map(mention => {
            const existingMention = callSearchSelectedMentions.find(
              selected => selected.id === mention.id && selected.type === mention.type,
            );
            const user =
              mention.type === ChipType.USER
                ? allUsers.find(candidate => candidate.id === mention.id)
                : undefined;
            const channel =
              mention.type === ChipType.CHANNEL
                ? allChannels.find(candidate => candidate.id === mention.id)
                : undefined;

            return {
              id: mention.id,
              name:
                existingMention?.name ||
                (user ? getUserDisplayName(user) : channel?.name) ||
                mention.id,
              type: mention.type,
              prefix: mention.type === ChipType.USER ? 'with:' : 'in:',
            };
          }),
      );
    },
    [
      allChannels,
      allUsers,
      callSearchSelectedMentions,
      setCallSearchSelectedMentions,
      setSearchQuery,
    ],
  );

  const handleInsertMentionReady = useCallback(
    (insertMention: (item: { id: string; name: string; email?: string }) => void) => {
      insertMentionRef.current = insertMention;
    },
    [],
  );
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

  useEffect(() => {
    setCallSearchActiveTab(TabType.CALL);
  }, [setCallSearchActiveTab]);

  const vespaCallSearchRows = useMemo(() => {
    const wsId = user?.workspaceId;
    if (!wsId) return [];
    return vespaCallSearchResults.map(r => mapVespaCallResultToCall(r, wsId));
  }, [vespaCallSearchResults, user?.workspaceId]);

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

  const hasCallSearch = !!titleSearchQuery || hasCallSearchFilters;
  const lastCallSearchScrollTopRef = useRef(0);
  const handleCallHistoryScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
      const isScrollingDown = scrollTop > lastCallSearchScrollTopRef.current;
      lastCallSearchScrollTopRef.current = scrollTop;

      if (
        hasCallSearch &&
        !isLoadingMoreCallSearchResults &&
        isScrollingDown &&
        scrollHeight - scrollTop - clientHeight <= 200
      ) {
        void loadMoreCallSearchResults();
      }
    },
    [hasCallSearch, isLoadingMoreCallSearchResults, loadMoreCallSearchResults],
  );
  const vespaScheduledCallRows = useMemo(
    () => vespaCallSearchRows.filter(call => call.status === CallStatus.SCHEDULED),
    [vespaCallSearchRows],
  );
  const vespaRecentCallRows = useMemo(
    () => vespaCallSearchRows.filter(call => call.status !== CallStatus.SCHEDULED),
    [vespaCallSearchRows],
  );

  const visibleScheduledCalls = useMemo(() => {
    if (!hasCallSearch) return scheduledCalls;
    return vespaScheduledCallRows.filter(call =>
      isVisibleInCallList(call, user?.id, showChannelCalls),
    );
  }, [hasCallSearch, scheduledCalls, showChannelCalls, user?.id, vespaScheduledCallRows]);

  const filteredCalendarScheduledCalls = hasCallSearch
    ? visibleScheduledCalls
    : calendarScheduledCalls;

  const limitedScheduledCalls = useMemo(() => {
    if (!visibleScheduledCalls) return visibleScheduledCalls;
    return visibleScheduledCalls.filter(call => !isExternalCalendarEvent(call));
  }, [visibleScheduledCalls]);

  const filteredRecentCalls = useMemo(() => {
    if (!hasCallSearch) return calls;
    return vespaRecentCallRows.filter(call =>
      isVisibleInCallList(call, user?.id, showChannelCalls),
    );
  }, [calls, hasCallSearch, showChannelCalls, user?.id, vespaRecentCallRows]);

  const filteredRecentCallsNoGcal = filteredRecentCalls?.filter(
    call => !isExternalCalendarEvent(call),
  );

  // Options come off the Zero-backed list rather than the current view, so the
  // dropdown doesn't shrink as you narrow the results.
  const availableCallLabels = useMemo(
    () => normalizeRecordingTags((calls ?? []).flatMap(call => call.labels)),
    [calls],
  );
  // call.labels stores Tag ids (no FK), not display text — resolve them once so
  // the dropdown shows real names. Every id is passed in, including generated
  // ones, since resolving is also what reveals the method.
  const { resolveLabel: resolveCallLabel, resolveMethod: resolveCallLabelMethod } =
    useResolvedRecordingLabels(availableCallLabels);
  const isManualCallLabel = useCallback(
    (label: string): boolean => resolveCallLabelMethod(label) !== TagMethod.LLM,
    [resolveCallLabelMethod],
  );
  const manualCallLabels = useMemo(
    () =>
      availableCallLabels
        .filter(isManualCallLabel)
        .sort((left, right) => resolveCallLabel(left).localeCompare(resolveCallLabel(right))),
    [availableCallLabels, isManualCallLabel, resolveCallLabel],
  );
  // Search results are Vespa rows, built with `labels: []` (mapVespaCallResultToCall),
  // so a selection would wrongly empty the list. Disable the control and skip it
  // rather than silently filtering everything away.
  const isLabelFilterDisabled = hasCallSearch;

  const filteredMissedCalls = (
    hasCallSearch
      ? filteredRecentCalls?.filter(call => isMissedCallForUser(call, user?.id))
      : missedCalls
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
    if (selectedLabels.length > 0 && !hasCallSearch) {
      const wanted = new Set(selectedLabels);
      filtered = filtered.filter(call => (call.labels ?? []).some(label => wanted.has(label)));
    }
    if (hasCallSearch) {
      return filtered;
    }

    // Active/joinable calls always float to the top
    return [...filtered].sort((a, b) => {
      const aTop = a.status === CallStatus.ACTIVE || isScheduledCallJoinable(a) ? 0 : 1;
      const bTop = b.status === CallStatus.ACTIVE || isScheduledCallJoinable(b) ? 0 : 1;
      return aTop - bTop;
    });
  }, [
    filteredRecentCallsNoGcal,
    filteredMissedCalls,
    hasCallSearch,
    recentCallFilter,
    selectedLabels,
    user?.id,
  ]);

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
      onScroll={handleCallHistoryScroll}
      className={cn(
        'bg-background flex flex-col w-full h-full md:rounded-2xl shadow-md relative',
        viewMode === 'calendar' ? 'overflow-hidden' : 'overflow-y-auto',
      )}
    >
      {/* This root is itself the scroll container, so an absolutely positioned
          navigator would scroll away with the list. A zero-height sticky wrapper
          pins it to the top-left instead while contributing no layout height, so
          the list still starts where it did. z-[60] clears the sticky header's
          z-50 for the widths where the centred column reaches the left edge. */}
      {!isMobile && (
        <div className='sticky left-0 top-0 z-[60] hidden h-0 w-fit md:block'>
          <div className='h-[52px] w-fit'>
            <AppNavigator />
          </div>
        </div>
      )}
      <div
        className={cn(
          'w-full flex flex-col items-center px-4',
          viewMode === 'calendar' && 'flex-1 min-h-0',
        )}
      >
        {/* Sticky header */}
        <div className='max-w-[860px] w-full sticky top-0 bg-background z-50 flex flex-col gap-3 pt-4 pb-6 sm:pb-3'>
          {/* Row 1: Title + calendar sync */}
          <CallHistorySearchPanel
            calendarProvider={calendarProvider}
            isSyncing={isSyncing}
            syncMessage={syncMessage}
            reauthCountdown={reauthCountdown}
            onCalendarSync={() => {
              syncCalendar();
            }}
            callMentionSearchType={callMentionSearchType}
            callMentionSearchQuery={callMentionSearchQuery}
            callSearchSelectedMentions={callSearchSelectedMentions}
            callSearchInitialQuery={callSearchInitialQuery}
            filteredUserMentionResults={filteredUserMentionResults}
            channelMentionResults={channelMentionResults}
            selectedMentionIndex={selectedMentionIndex}
            setSelectedMentionIndex={setSelectedMentionIndex}
            hasNavigatedMentions={hasNavigatedMentions}
            setHasNavigatedMentions={setHasNavigatedMentions}
            onInsertMentionReady={handleInsertMentionReady}
            closeCallMentionSearch={closeCallMentionSearch}
            handleCallSearchChange={handleCallSearchChange}
            handleCallUserSearch={handleCallUserSearch}
            handleCallChannelSearch={handleCallChannelSearch}
            showChannelCalls={showChannelCalls}
            setShowChannelCalls={setShowChannelCalls}
            isMobile={isMobile}
            {...(user?.id ? { currentUserId: user.id } : {})}
          />
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
              data-track-category='CALLS'
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
              data-track-category='CALLS'
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
                          data-track-category='CALLS'
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
                          data-track-category='CALLS'
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
                        data-track-category='CALLS'
                        data-track-name='calendar-prev'
                        className='p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground'
                        aria-label='Previous'
                      >
                        <ChevronDown className='size-4 rotate-90' />
                      </button>
                      <button
                        onClick={handleCalendarNext}
                        disabled={isNextDisabled}
                        data-track-category='CALLS'
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
                      data-track-category='CALLS'
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
                    data-track-category='CALLS'
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
                    data-track-category='CALLS'
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
              (!hasCallSearch && isScheduledCallsLoading) ||
              (hasCallSearch && isVespaCallSearching) ? (
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
                <div className='flex items-center gap-2'>
                  <CallLabelFilter
                    labels={manualCallLabels}
                    selectedLabels={selectedLabels}
                    onSelectedLabelsChange={setSelectedLabels}
                    resolveLabel={resolveCallLabel}
                    isDisabled={isLabelFilterDisabled}
                  />
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
              </div>

              {displayRecentCalls.length === 0 ? (
                (!hasCallSearch && showRecentCallsLoader) ||
                (hasCallSearch && isVespaCallSearching) ? (
                  <div className='py-10 flex items-center justify-center'>
                    <Loader2 className='w-6 h-6 animate-spin text-muted-foreground' />
                  </div>
                ) : hasCallSearch ? (
                  <NoFiltredCalls
                    isShortTitleSearch={titleSearchQuery.length > 0 && titleSearchQuery.length < 4}
                  />
                ) : (
                  <EmptyState
                    icon={Phone}
                    title='No Calls Yet'
                    description='Start a conversation by making your first call.'
                  />
                )
              ) : (
                <div className='flex flex-col gap-3 -mx-3' data-testid='call-history-list'>
                  <Virtuoso
                    {...(scrollContainer ? { customScrollParent: scrollContainer } : {})}
                    data={displayRecentCalls}
                    initialItemCount={Math.min(displayRecentCalls.length, 20)}
                    endReached={() => {
                      if (!hasCallSearch && hasMoreCalls) loadMoreCalls();
                    }}
                    rangeChanged={range => {
                      if (!hasCallSearch) {
                        onVisibleRangeChanged(range.startIndex);
                      }
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
                          labels={call.labels.filter(isManualCallLabel)}
                          resolveLabel={resolveCallLabel}
                          onDetailClick={() => {
                            // The labels on screen right now double as the detail picker's
                            // suggestions — same rows this screen's label filter is built from.
                            void navigate(`${call.id}/detail`, {
                              state: { call, labelSuggestions: availableCallLabels },
                            });
                          }}
                        />
                      </div>
                    )}
                  />
                </div>
              )}
              {hasCallSearch && isLoadingMoreCallSearchResults && (
                <div className='py-4 flex justify-center'>
                  <Loader2 className='size-5 animate-spin text-muted-foreground' />
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

const NoFiltredCalls = ({ isShortTitleSearch }: { isShortTitleSearch: boolean }): ReactElement => {
  return (
    <div className='flex flex-col items-center justify-center h-full px-6 py-12'>
      <h2 className='text-lg text-foreground font-medium mb-1'>
        {isShortTitleSearch ? 'Type at least 4 letters to search call titles' : 'No calls found'}
      </h2>
    </div>
  );
};

export default CallHistoryScreen;
