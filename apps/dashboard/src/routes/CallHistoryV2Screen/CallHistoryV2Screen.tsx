import {
  CalendarDefault as CalendarDays,
  ChevronDown,
  Spinner as Loader2,
  PhoneDefault,
  PlusDefault as Plus,
  FilterFunnel,
  SearchDefault as SearchIcon,
} from '@xyne/icons';
import { format } from 'date-fns';
import {
  ReactElement,
  type UIEvent,
  useCallback,
  useEffect,
  useState,
  useRef,
  useMemo,
} from 'react';
import { useNavigate, useOutlet } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import { useAuth } from '../../hooks/useAuth';
import { useCallHistory } from '../CallHistoryScreen/useCallHistory';
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
import { useActiveUserSearch, useUsers } from '../../hooks/useUsers';
import { useAllChannels } from '../../hooks/useChannels';
import { useZero } from '../../hooks/useZero';
import { cn } from '../../utils/classNames';
import { mutators } from '../../zero/mutators';
import { CallCard } from './CallCard';
import {
  Call,
  isMissedCallForUser,
  isExternalCalendarEvent,
  type RecentCallFilterV2,
} from '../CallHistoryScreen/callHistoryItem.utils';
import { CallLabelFilter } from './CallLabelFilter';
import CallAskAIModal from './components/CallAskAIModal';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { useResolvedRecordingLabels } from '../../hooks/useResolvedRecordingLabels';
import { normalizeRecordingTags } from '../../utils/recordingUtils';
import { CallExternalChatDialog } from '../../components/Call/CallExternalChatDialog/CallExternalChatDialog';
import { ParticipantsModal } from '../CallHistoryScreen/ParticipantsModal';
import { usePlatform } from '../../hooks/usePlatform';
import { UpcomingCallsListV2 } from './components/UpcomingCallsListV2';
import { useSearchMetrics } from '../../hooks/useSearchMetrics';
import type { DisplaySearchResult } from '../../types/search';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { MentionType, TabType } from '../../components/Chat/ChatDirectory/ChannelCommandMenu.types';
import { type InitialQueryData } from '../../components/Chat/ChatDirectory/LexicalSearchInput';
import { CallHistorySearchPanel } from './CallHistorySearchPanel';
import { Button } from '../../components/ui/Button/Button';
import { Switch } from '../../components/ui/Switch';
import { Popover } from '../../components/ui/Popover/Popover';
import { buildDateGroupedRowsFromItems, findNearestVisibleItem } from '../../utils/dateGroupedList';
import { CallsEmptyStateIllustration } from './CallsEmptyStateIllustration';

interface EmptyStateProps {
  title: string;
  description: string;
}

const CALL_FILTER_TABS: ReadonlyArray<{ value: RecentCallFilterV2; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'missed', label: 'Missed' },
  { value: 'recurring', label: 'Recurring' },
];

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

const CallHistoryV2Screen = (): ReactElement => {
  const { isMobile } = usePlatform();
  const { user } = useAuth();
  const navigate = useNavigate();
  const outlet = useOutlet();

  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [scheduleInitialTime, setScheduleInitialTime] = useState<{
    startsAt: Date;
    endsAt: Date;
  } | null>(null);
  const [isInstantCallModalOpen, setIsInstantCallModalOpen] = useState(false);
  const [externalChatCallId, setExternalChatCallId] = useState<string | null>(null);
  const [showAskAIContextModal, setShowAskAIContextModal] = useState(false);
  const [recentCallFilter, setRecentCallFilter] = useState<RecentCallFilterV2>('all');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

  const {
    calls,
    scheduledCalls,
    missedCalls,
    isLoading,
    isScheduledCallsLoading,
    queryDetails,
    selectedCall,
    isParticipantsModalOpen,
    handleCallRowClick,
    handleParticipantsClick,
    closeParticipantsModal,
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
  const [callMentionSearchType, setCallMentionSearchType] = useState<MentionType | null>(null);
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
    callMentionSearchType === MentionType.USER ? callMentionSearchQuery : '',
    8,
  );
  const selectedCallSearchUserIds = useMemo(
    () =>
      callSearchSelectedMentions
        .filter(mention => mention.type === MentionType.USER)
        .map(mention => mention.id),
    [callSearchSelectedMentions],
  );
  const selectedCallSearchChannelIds = useMemo(
    () =>
      callSearchSelectedMentions
        .filter(mention => mention.type === MentionType.CHANNEL)
        .map(mention => mention.id),
    [callSearchSelectedMentions],
  );
  const channelMentionResults = useMemo(() => {
    if (callMentionSearchType !== MentionType.CHANNEL) return [];
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
      .filter(mention => mention.type === MentionType.USER || mention.type === MentionType.CHANNEL)
      .map(mention => ({
        id: mention.id,
        name: mention.name || mention.id,
        type: mention.type,
        prefix: mention.type === MentionType.USER ? ('with:' as const) : ('in:' as const),
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
      setCallMentionSearchType(MentionType.USER);
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
      setCallMentionSearchType(MentionType.CHANNEL);
      setCallMentionSearchQuery(query);
      setSelectedMentionIndex(0);
      setHasNavigatedMentions(false);
    },
    [closeCallMentionSearch],
  );

  const handleCallSearchChange = useCallback(
    (text: string, mentions: Array<{ id: string; type: MentionType; prefix?: string }>) => {
      if (isRestoringCallSearchRef.current) {
        if (!text && mentions.length === 0) return;
        isRestoringCallSearchRef.current = false;
      }

      setSearchQuery(text);
      setCallSearchSelectedMentions(
        mentions
          .filter(
            mention => mention.type === MentionType.USER || mention.type === MentionType.CHANNEL,
          )
          .map(mention => {
            const existingMention = callSearchSelectedMentions.find(
              selected => selected.id === mention.id && selected.type === mention.type,
            );
            const user =
              mention.type === MentionType.USER
                ? allUsers.find(candidate => candidate.id === mention.id)
                : undefined;
            const channel =
              mention.type === MentionType.CHANNEL
                ? allChannels.find(candidate => candidate.id === mention.id)
                : undefined;

            return {
              id: mention.id,
              name:
                existingMention?.name ||
                (user ? getUserDisplayName(user) : channel?.name) ||
                mention.id,
              type: mention.type,
              prefix: mention.type === MentionType.USER ? 'with:' : 'in:',
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
  useEffect(() => {
    setCallSearchActiveTab(TabType.CALL);
  }, [setCallSearchActiveTab]);

  const vespaCallSearchRows = useMemo(() => {
    const wsId = user?.workspaceId;
    if (!wsId) return [];
    return vespaCallSearchResults.map(r => mapVespaCallResultToCall(r, wsId));
  }, [vespaCallSearchResults, user?.workspaceId]);

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

  const activeCallsForUpcoming = useMemo(() => {
    const now = Date.now();
    return (filteredRecentCallsNoGcal || []).filter(
      call =>
        call.status === CallStatus.ACTIVE ||
        call.status === CallStatus.IN_PROGRESS ||
        (call.status === CallStatus.SCHEDULED &&
          call.startsAt &&
          new Date(call.startsAt).getTime() <= now),
    );
  }, [filteredRecentCallsNoGcal]);

  const displayRecentCalls = useMemo(() => {
    const base = (filteredRecentCallsNoGcal || []).filter(call => call.status === CallStatus.ENDED);
    let filtered: typeof base;
    switch (recentCallFilter) {
      case 'missed':
        filtered = filteredMissedCalls || [];
        break;
      case 'recurring':
        filtered = base.filter(c => c.isRecurring);
        break;
      default:
        filtered = base;
    }
    if (selectedLabels.length > 0 && !hasCallSearch) {
      const wanted = new Set(selectedLabels);
      filtered = filtered.filter(call => (call.labels ?? []).some(label => wanted.has(label)));
    }
    return filtered;
  }, [
    filteredRecentCallsNoGcal,
    filteredMissedCalls,
    hasCallSearch,
    recentCallFilter,
    selectedLabels,
  ]);

  const callRows = useMemo(
    () => buildDateGroupedRowsFromItems(displayRecentCalls),
    [displayRecentCalls],
  );
  const sourceIndexByCallId = useMemo(
    () => new Map((calls ?? []).map((call, index) => [call.id, index])),
    [calls],
  );
  const handleVisibleRangeChanged = useCallback(
    (startIndex: number): void => {
      const firstVisibleCall = findNearestVisibleItem(callRows, startIndex);
      if (!firstVisibleCall) return;

      const sourceIndex = sourceIndexByCallId.get(firstVisibleCall.id);
      if (sourceIndex !== undefined) {
        onVisibleRangeChanged(sourceIndex);
      }
    },
    [onVisibleRangeChanged, callRows, sourceIndexByCallId],
  );

  const handleOpenAskAI = useCallback((): void => {
    setShowAskAIContextModal(true);
  }, []);

  const handleConfirmAskAIContext = useCallback((selected: Call[]): void => {
    xyneAIActor.send({
      type: 'OPEN',
      contextType: 'general',
      threadInfo: null,
      startFreshChat: true,
      initialContextSelections: {
        canvases: [],
        recordings: [],
        calls: selected.map(call => ({
          id: call.id,
          title: call.title || 'Untitled call',
          ...(call.channelId ? { channelId: call.channelId } : {}),
        })),
      },
    });
  }, []);

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
      className='bg-background flex flex-col w-full h-full md:rounded-2xl shadow-md relative overflow-y-auto'
    >
      {!isMobile && (
        <div className='sticky left-0 top-0 z-[60] hidden h-0 w-fit md:block'>
          <div className='h-[52px] w-fit'>
            <AppNavigator />
          </div>
        </div>
      )}
      <div className='w-full flex flex-col items-center'>
        {/* Sticky header */}
        <div className='max-w-[820px] w-full sticky top-0 bg-background z-50 flex flex-col px-6 pt-8 sm:px-8'>
          {/* Row 1: Title + calendar sync */}
          <CallHistorySearchPanel
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
            isMobile={isMobile}
            onOpenAskAI={handleOpenAskAI}
            {...(user?.id ? { currentUserId: user.id } : {})}
          />
        </div>
        {/* Page body */}
        <div className='max-w-[820px] w-full flex flex-col gap-6 px-6 pb-20 sm:px-8'>
          <StartCallPill
            onInstantCall={() => setIsInstantCallModalOpen(true)}
            onScheduleCall={() => setIsScheduleModalOpen(true)}
          />

          {/* UPCOMING section */}
          <div className='flex flex-col gap-3'>
            <div className='flex items-center justify-between shrink-0'>
              <span className='text-xs font-medium tracking-wide text-muted-foreground/70 uppercase'>
                Upcoming
              </span>
              <span className='text-xs text-muted-foreground/70'>
                {format(new Date(), 'EEE, MMMM d')}
              </span>
            </div>

            {(!hasCallSearch && isScheduledCallsLoading) ||
            (hasCallSearch && isVespaCallSearching) ? (
              <div className='py-10 flex items-center justify-center'>
                <Loader2 className='w-6 h-6 animate-spin text-muted-foreground' />
              </div>
            ) : (
              <UpcomingCallsListV2
                calls={[...activeCallsForUpcoming, ...(limitedScheduledCalls || [])]}
                onJoinCall={call => handleCallRowClick(call)}
                onEditCall={call => handleEditClick(call)}
                onCancelCall={call => handleDeleteClick(call)}
                currentUserId={user?.id}
              />
            )}
          </div>

          {/* RECENTS section */}
          <div className='flex flex-col gap-3 pb-20 md:pb-4'>
            <div className='flex flex-wrap items-center gap-2'>
              <div
                className='relative inline-flex h-9 items-center gap-0.5 rounded-xl border border-border bg-muted p-0.5'
                role='group'
                aria-label='Filter calls'
              >
                {CALL_FILTER_TABS.map(tab => (
                  <button
                    key={tab.value}
                    type='button'
                    aria-pressed={recentCallFilter === tab.value}
                    onClick={() => setRecentCallFilter(tab.value)}
                    className={cn(
                      'relative z-10 inline-flex h-7 items-center justify-center whitespace-nowrap px-3 text-sm font-semibold transition-colors duration-200',
                      recentCallFilter === tab.value
                        ? 'text-foreground'
                        : 'text-muted-foreground/80 hover:text-foreground',
                    )}
                    data-track-category='CALLS'
                    data-track-name={`show_${tab.value}_calls`}
                  >
                    {recentCallFilter === tab.value && (
                      <span className='absolute inset-0 -z-10 rounded-lg bg-background shadow-sm' />
                    )}
                    {tab.label}
                  </button>
                ))}
              </div>
              <CallLabelFilter
                labels={manualCallLabels}
                selectedLabels={selectedLabels}
                onSelectedLabelsChange={setSelectedLabels}
                resolveLabel={resolveCallLabel}
                isDisabled={isLabelFilterDisabled}
              />
              <div className='flex h-9 shrink-0 items-center gap-2 rounded-xl border border-border px-2.5'>
                <FilterFunnel className='size-4 text-muted-foreground' />
                <label
                  htmlFor='channel-calls-toggle'
                  className='cursor-pointer select-none whitespace-nowrap text-sm font-medium text-muted-foreground'
                >
                  All channel calls
                </label>
                <Switch
                  id='channel-calls-toggle'
                  checked={showChannelCalls}
                  onCheckedChange={setShowChannelCalls}
                />
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
                  searchQuery={titleSearchQuery}
                />
              ) : (
                <EmptyState
                  title='No Calls Yet'
                  description='Start a conversation by making your first call.'
                />
              )
            ) : (
              <div className='flex flex-col gap-3' data-testid='call-history-list'>
                <Virtuoso
                  {...(scrollContainer ? { customScrollParent: scrollContainer } : {})}
                  data={callRows}
                  initialItemCount={Math.min(callRows.length, 20)}
                  endReached={() => {
                    if (!hasCallSearch && hasMoreCalls) loadMoreCalls();
                  }}
                  rangeChanged={range => {
                    if (!hasCallSearch) {
                      handleVisibleRangeChanged(range.startIndex);
                    }
                  }}
                  computeItemKey={(_, row) => row.id}
                  itemContent={(_, row) =>
                    row.type === 'group' ? (
                      <div className='sticky top-40 z-10 px-3 py-2 text-sm font-medium text-muted-foreground/70'>
                        {row.label}
                      </div>
                    ) : (
                      <div className='pb-3.5'>
                        <CallCard
                          call={row.item}
                          currentUserId={user?.id}
                          isLastItem={row.item.id === displayRecentCalls.at(-1)?.id}
                          onCallClick={() => handleCallRowClick(row.item)}
                          onParticipantsClick={() => handleParticipantsClick(row.item)}
                          handleGotoTranscript={getGotoTranscriptHandler(row.item)}
                          handleDownloadTranscript={() => handleDownloadTranscript(row.item)}
                          onViewExternalChat={
                            hasExternalChatAccess(row.item)
                              ? () => setExternalChatCallId(row.item.externalId)
                              : undefined
                          }
                          labels={row.item.labels.filter(isManualCallLabel)}
                          resolveLabel={resolveCallLabel}
                          onDetailClick={() => {
                            // The labels on screen right now double as the detail picker's
                            // suggestions — same rows this screen's label filter is built from.
                            void navigate(`${row.item.id}/detail`, {
                              state: { call: row.item, labelSuggestions: availableCallLabels },
                            });
                          }}
                        />
                      </div>
                    )
                  }
                />
              </div>
            )}
            {hasCallSearch && isLoadingMoreCallSearchResults && (
              <div className='py-4 flex justify-center'>
                <Loader2 className='size-5 animate-spin text-muted-foreground' />
              </div>
            )}
          </div>
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
        initialParticipants={null}
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

      {showAskAIContextModal && (
        <CallAskAIModal
          open={showAskAIContextModal}
          calls={displayRecentCalls}
          users={allUsers}
          currentUserId={user?.id}
          resolveLabel={resolveCallLabel}
          onOpenChange={setShowAskAIContextModal}
          onConfirm={handleConfirmAskAIContext}
        />
      )}

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

const EmptyState = ({ title, description }: EmptyStateProps): ReactElement => {
  return (
    <div className='flex flex-col items-center justify-center h-full px-6 py-12'>
      <CallsEmptyStateIllustration />
      <h2 className='text-xl text-foreground font-light mt-6 mb-2'>{title}</h2>
      <p className='text-sm text-muted-foreground text-center max-w-sm'>{description}</p>
    </div>
  );
};

const NoFiltredCalls = ({
  isShortTitleSearch,
  searchQuery,
}: {
  isShortTitleSearch: boolean;
  searchQuery: string;
}): ReactElement => {
  return (
    <div className='flex min-h-[200px] flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center'>
      <span className='flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground/70'>
        <SearchIcon className='size-4' />
      </span>
      <span className='text-[10px] font-semibold tracking-widest text-muted-foreground/60 uppercase'>
        {isShortTitleSearch ? 'Keep typing' : '0 results'}
      </span>
      <h2 className='text-base font-semibold text-foreground'>
        {isShortTitleSearch
          ? 'Type at least 4 letters to search call titles'
          : searchQuery
            ? `No calls match "${searchQuery}"`
            : 'No calls found'}
      </h2>
      <p className='max-w-sm text-xs text-muted-foreground'>
        Try a name, a channel, or part of a call title.
      </p>
    </div>
  );
};

interface StartCallPillProps {
  onInstantCall: () => void;
  onScheduleCall: () => void;
}

const StartCallPill = ({ onInstantCall, onScheduleCall }: StartCallPillProps): ReactElement => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className='fixed bottom-7 left-[calc(50%+30px)] z-10 -translate-x-1/2'>
      <Popover
        open={isOpen}
        onOpenChange={setIsOpen}
        side='top'
        align='center'
        sideOffset={10}
        container={document.body}
        className='w-80 rounded-2xl p-1.5'
        trigger={
          <Button
            size='inline'
            data-testid='new-call-button'
            data-track-category='CALLS'
            data-track-name='start-a-call-pill'
            className='gap-2 rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background shadow-lg hover:bg-foreground/90 cursor-pointer z-60'
          >
            <PhoneDefault variant='Solid' className='size-3.5' />
            Start a call
            <ChevronDown className={cn('size-4 transition-transform', isOpen && 'rotate-180')} />
          </Button>
        }
      >
        <div className='flex flex-col'>
          <Button
            variant='ghost'
            size='inline'
            data-testid='start-instant-call-option'
            data-track-category='CALLS'
            data-track-name='start-instant-call'
            onClick={() => {
              setIsOpen(false);
              onInstantCall();
            }}
            className='w-full items-start gap-3 rounded-xl p-2.5 text-left'
          >
            <span className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary'>
              <Plus className='size-4 text-action-primary-foreground' strokeWidth={2.5} />
            </span>
            <span className='min-w-0'>
              <span className='block text-sm font-semibold tracking-tight text-foreground'>
                Start an instant call
              </span>
              <span className='mt-0.5 block text-xs font-normal text-muted-foreground'>
                Connect right away and begin talking.
              </span>
            </span>
          </Button>
          <Button
            variant='ghost'
            size='inline'
            data-testid='schedule-call-option'
            data-track-category='CALLS'
            data-track-name='schedule-call'
            onClick={() => {
              setIsOpen(false);
              onScheduleCall();
            }}
            className='w-full items-start gap-3 rounded-xl p-2.5 text-left'
          >
            <span className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground'>
              <CalendarDays className='size-4' />
            </span>
            <span className='min-w-0'>
              <span className='block text-sm font-semibold tracking-tight text-foreground'>
                Schedule a call
              </span>
              <span className='mt-0.5 block text-xs font-normal text-muted-foreground'>
                Pick a time that works for everyone.
              </span>
            </span>
          </Button>
        </div>
      </Popover>
    </div>
  );
};

export default CallHistoryV2Screen;
