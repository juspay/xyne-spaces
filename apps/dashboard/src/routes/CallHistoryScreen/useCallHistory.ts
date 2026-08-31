import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useZero } from '../../hooks/useZero';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { roomActor } from '../../machines/roomMachine';
import {
  openInitiateCallWindow,
  openJoinCallWindow,
  shouldUseCallWindow,
} from '../CallWindow/callWindowLauncher';
import { CallType, CallStatus, ChannelScopeType, MeetingStatus } from '@xyne/shared';
import { useSelector } from '@xstate/react';
import { toast } from 'sonner';
import { usePlatform } from '../../hooks/usePlatform';
import { type User } from '../../machines/stateMachine';
import {
  getCallParticipantCount,
  isMissedCallForUser,
  isExternalCalendarEvent,
  isExternalCalendarEventForUser,
  canJoinCall,
  shouldShowInCallLists,
  shouldShowInScheduledList,
  type Call,
  type CallParticipants,
} from './callHistoryItem.utils';
import { useAllChannels } from '../../hooks/useChannels';
import { useActiveCalls } from '../../hooks/useCalls';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { callService } from '../../services/Call/callService';
import { reactNativeBridge } from '../../utils/reactNativeBridge';
import { blobToBase64 } from '../../services/clients/fileFetchService';
import { logger, Event as Logger } from '../../utils/logger';
import { usePaginatedCalls } from '../../hooks/usePaginatedCalls';
import { EditCallData } from '../../components/Call/ScheduleCallModal/ScheduleCallModal';
import { useQuery } from '@xyne/shared/hooks';

type ScheduledCall = Omit<
  QueryResultType<typeof queries.userScheduledCallsV2>[number],
  'participants'
> & {
  participants?: CallParticipants;
};

interface UseCallHistoryReturn {
  calls: Call[] | undefined;
  scheduledCalls: ScheduledCall[] | undefined;
  calendarScheduledCalls: ScheduledCall[] | undefined;
  missedCalls: Call[];
  isLoading: boolean;
  isScheduledCallsLoading: boolean;
  queryDetails: ReturnType<typeof useCachedQuery>[1];
  selectedCall: Call | null;
  isParticipantsModalOpen: boolean;
  selectedUsers: User[];
  handleCallRowClick: (call: Call) => void;
  handleParticipantsClick: (call: Call) => void;
  handleUserToggle: (user: User) => void;
  handleRemoveUser: (userId: string) => void;
  closeParticipantsModal: () => void;
  handleGotoTranscript: (call: Call) => void;
  getGotoTranscriptHandler: (call: Call) => (() => void) | undefined;
  handleDownloadTranscript: (call: Call) => void;
  showConfirmModal: boolean;
  confirmModalConfig: {
    title: string;
    subtitle: string;
  };
  handleConfirmCall: () => void;
  closeConfirmModal: () => void;
  handleInstantCall: (selectedParticipants: string[]) => void;
  handleCancelCall: (callId: string) => void;
  hasMoreCalls: boolean;
  loadMoreCalls: () => void;
  onVisibleRangeChanged: (startIndex: number) => void;
  /** Open the delete-call modal for a specific call */
  handleDeleteClick: (call: ScheduledCall) => void;
  deleteModalOpen: boolean;
  deleteModalCall: ScheduledCall | null;
  handleDeleteConfirm: (cancelEntireSeries: boolean) => void;
  closeDeleteModal: () => void;
  /** Hide a call (participant-only, irreversible) */
  handleHideClick: (call: ScheduledCall, options?: { isSeries?: boolean }) => void;
  /** Open the edit-call modal for a specific call */
  handleEditClick: (call: Call) => void;
  editModalOpen: boolean;
  editModalCall: EditCallData | null;
  closeEditModal: () => void;
  /** Toggle for showing channel calls */
  showChannelCalls: boolean;
  setShowChannelCalls: (show: boolean) => void;
}

export function useCallHistory(userId: string | undefined): UseCallHistoryReturn {
  const zero = useZero();

  const {
    calls: accumulatedCalls,
    hasMoreCalls,
    loadMoreCalls,
    onVisibleRangeChanged,
    isLoading,
    queryDetails,
  } = usePaginatedCalls();

  const [allScheduledCalls, scheduledQueryDetails] = useCachedQuery(queries.userScheduledCallsV2());

  // Toggle for showing channel calls (calls in channels the user is a member of but wasn't invited to)
  const [showChannelCalls, setShowChannelCalls] = useState(false);

  const calls = accumulatedCalls as Call[] | undefined;
  const scheduledCallRows = allScheduledCalls as ScheduledCall[] | undefined;
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [isParticipantsModalOpen, setIsParticipantsModalOpen] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalConfig, setConfirmModalConfig] = useState<{
    title: string;
    subtitle: string;
  }>({ title: '', subtitle: '' });
  const [pendingCall, setPendingCall] = useState<Call | null>(null);
  const [pendingCallParticipants, setPendingCallParticipants] = useState<CallParticipants | null>(
    null,
  );
  const [isJoiningCall, setIsJoiningCall] = useState(false); // Track if joining vs initiating
  const [callIdToJoin, setCallIdToJoin] = useState<string | null>(null); // Store the active call's externalId
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteModalCall, setDeleteModalCall] = useState<ScheduledCall | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editModalCall, setEditModalCall] = useState<EditCallData | null>(null);
  const [fullParticipantAction, setFullParticipantAction] = useState<{
    call: Call;
    action: 'restart' | 'edit';
  } | null>(null);
  const [actionParticipants, actionParticipantsDetails] = useQuery(
    queries.callParticipantsByCallId({ callId: fullParticipantAction?.call.id ?? '' }),
    { enabled: Boolean(fullParticipantAction) },
  );
  const navigate = useNavigate();

  const { isMobile } = usePlatform();

  // Helper function to get channel by ID from state machine
  const channels = useAllChannels();

  // Get active calls to check if channel has ongoing call
  const activeCalls = useActiveCalls() as Call[];
  const getCurrentUserParticipant = (call: {
    participants?: CallParticipants;
  }): NonNullable<CallParticipants>[number] | undefined =>
    call.participants?.find(p => p.userId === userId);

  // Filter scheduled calls to only show those that haven't ended yet.
  const scheduledCalls = useMemo(() => {
    if (!scheduledCallRows) return undefined;

    const now = Date.now();

    // Match only the live occurrence. Matching by recurringSeriesId would hide
    // every future occurrence because the whole series shares that ID.
    const activeCallIds = new Set(activeCalls?.map(call => call.id) ?? []);
    const activeExternalIds = new Set(activeCalls?.map(call => call.externalId) ?? []);

    const filtered = scheduledCallRows.filter(call => {
      if (call.status === CallStatus.ACTIVE) {
        return false;
      }
      if (activeCallIds.has(call.id) || activeExternalIds.has(call.externalId)) {
        return false;
      }
      if (!shouldShowInScheduledList(call)) {
        return false;
      }
      // Regular scheduled calls: don't show if already started
      if (call.startsAt && new Date(call.startsAt).getTime() <= now) {
        return false;
      }
      if (!(call.endsAt && new Date(call.endsAt).getTime() > now)) {
        return false;
      }
      // Exclude calls the current user has hidden
      const currentUserParticipant = getCurrentUserParticipant(call);
      if (userId && currentUserParticipant?.meetingStatus === MeetingStatus.HIDDEN) {
        return false;
      }
      // Only show calls where the user is an actual participant. This filters out
      // broadcast-channel calls (post call updates mode) where call.channelId is a
      // large channel but only a subset of members are real participants.
      // External calendar calls (Google/Microsoft) have no CallParticipant rows —
      // attendees are stored in metadata only — so check the owning user id instead.
      const isExternalCalendarCall = isExternalCalendarEvent(call);
      const isParticipant = isExternalCalendarCall
        ? isExternalCalendarEventForUser(call, userId)
        : Boolean(currentUserParticipant);
      if (!isParticipant) return false;
      return true;
    });

    // Sort by start time ascending
    filtered.sort((a, b) => {
      const aTime = a.startsAt ? new Date(a.startsAt).getTime() : Infinity;
      const bTime = b.startsAt ? new Date(b.startsAt).getTime() : Infinity;
      return aTime - bTime;
    });

    return filtered;
  }, [scheduledCallRows, activeCalls, userId]);

  const calendarScheduledCalls = useMemo(() => {
    if (!scheduledCallRows) return undefined;

    const activeCallIds = new Set(activeCalls?.map(call => call.id) ?? []);
    const activeExternalIds = new Set(activeCalls?.map(call => call.externalId) ?? []);

    const filtered = scheduledCallRows.filter(call => {
      if (call.status === CallStatus.ACTIVE) {
        return false;
      }
      if (activeCallIds.has(call.id) || activeExternalIds.has(call.externalId)) {
        return false;
      }
      const currentUserParticipant = getCurrentUserParticipant(call);
      if (userId && currentUserParticipant?.meetingStatus === MeetingStatus.HIDDEN) {
        return false;
      }

      if (isExternalCalendarEvent(call)) {
        return isExternalCalendarEventForUser(call, userId);
      }

      return Boolean(currentUserParticipant);
    });

    filtered.sort((a, b) => {
      const aTime = a.startsAt ? new Date(a.startsAt).getTime() : Infinity;
      const bTime = b.startsAt ? new Date(b.startsAt).getTime() : Infinity;
      return aTime - bTime;
    });

    return filtered;
  }, [scheduledCallRows, activeCalls, userId]);

  const recentCalls = useMemo(() => {
    const baseCalls = calls;
    if (!baseCalls) return undefined;

    const now = Date.now();

    // Build lookup sets for stale-ACTIVE detection.
    // activeCalls (userActiveCalls) is the live source of truth: if a call is no longer
    // in this set it has ended. allScheduledCalls covers the ACTIVE→SCHEDULED reversion
    // (call ended before endsAt) where the call leaves userCallHistory but the
    // cumulative accumulator still holds an ACTIVE entry.
    const activeCallExternalIds = new Set(activeCalls?.map(c => c.externalId) ?? []);
    const scheduledCallIds = new Set(scheduledCallRows?.map(c => c.id) ?? []);

    // Get active scheduled calls that have started
    const activeScheduledCalls =
      scheduledCallRows?.filter(
        call =>
          call.status === CallStatus.ACTIVE ||
          (call.startsAt && new Date(call.startsAt).getTime() <= now),
      ) || [];

    const activeCallIds = new Set(activeCalls?.map(call => call.id) ?? []);

    // Combine history rows with active calls from roomActor. userCallHistory intentionally
    // excludes ACTIVE rows so live calls can use userActiveCalls, which carries all participants.
    // External calendar events are excluded from main call lists — they appear only in Calendar view
    let allCalls = [
      ...(activeCalls ?? []),
      ...baseCalls.filter(call => !activeCallIds.has(call.id)),
      ...activeScheduledCalls.filter(call => !activeCallIds.has(call.id)),
    ]
      .filter(call => {
        if (call.status === CallStatus.ACTIVE) {
          // Call has reverted to SCHEDULED (ended before endsAt) — stale accumulator entry
          if (scheduledCallIds.has(call.id)) return false;
          // Call has ended — no longer in the live active-calls subscription
          if (!activeCallExternalIds.has(call.externalId)) return false;
        }
        return true;
      })
      .filter(shouldShowInCallLists);

    // If showChannelCalls is false (default), filter out calls in channels where user wasn't invited
    // External calendar events (Google/Microsoft) bypass this filter — they have no participants,
    // the user is identified by createdByUserId instead.
    if (!showChannelCalls) {
      allCalls = allCalls.filter(call => {
        if (isExternalCalendarEvent(call)) return true;
        const userParticipant = getCurrentUserParticipant(call);
        return !!userParticipant;
      });
    }

    return allCalls.sort((a, b) => {
      const aTime = a.startsAt || a.startedAt || a.createdAt;
      const bTime = b.startsAt || b.startedAt || b.createdAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
  }, [calls, allScheduledCalls, activeCalls, showChannelCalls, userId]);

  const missedCalls = useMemo(() => {
    if (!recentCalls || !userId) return [];

    return recentCalls.filter(call => isMissedCallForUser(call, userId));
  }, [recentCalls, userId]);

  // Check if user is currently in any call
  const roomSnapshot = useSelector(roomActor, state => state);
  const isInCall =
    roomSnapshot.matches('initiating') ||
    roomSnapshot.matches('joining') ||
    roomSnapshot.matches('connecting') ||
    roomSnapshot.matches('connected');
  const currentCallId = useSelector(roomActor, state => state.context.callId);

  // Get active calls to check if channel has ongoing call

  const joinCall = (callId: string): void => {
    if (shouldUseCallWindow(isMobile)) {
      openJoinCallWindow(callId);
      return;
    }
    // Use JOIN_CALL for all calls - backend API handles both regular and scheduled calls
    roomActor.send({
      type: 'JOIN_CALL',
      callId: callId,
      zero,
      viewMode: isMobile ? 'full' : 'mini',
    });
  };

  const hasOnlyParticipantPreview = (call: Call): boolean => {
    if (call.status === CallStatus.ACTIVE) return false;
    if (call.participantCount === null || call.participantCount === undefined) return true;
    return getCallParticipantCount(call) > (call.participants?.length ?? 0);
  };

  const initiateCall = (call: Call, participants = call.participants): void => {
    const participantUserIds = participants?.map(p => p.userId) || [];

    if (shouldUseCallWindow(isMobile) && call.channelId) {
      openInitiateCallWindow({
        channelId: call.channelId,
        callType: CallType.AUDIO,
        targetUserIds: participantUserIds,
      });
      return;
    }

    roomActor.send({
      type: 'INITIATE_CALL',
      ...(call.channelId ? { channelId: call.channelId } : {}),
      callType: CallType.AUDIO,
      targetUserIds: participantUserIds,
      zero,
      viewMode: isMobile ? 'full' : 'mini',
    });
  };

  const handleJoinCall = (call: Call): void => {
    if (isInCall && currentCallId !== call.externalId) {
      toast.info('Already in a call', {
        description: 'You are already in a call. Please leave your current call first.',
        duration: 3000,
      });
      return;
    }

    joinCall(call.externalId);
  };

  const continueRestartCall = (call: Call, participants = call.participants): void => {
    // If user is in any call, show toast instead of allowing restart
    if (isInCall) {
      toast.info('Already in a call', {
        description: 'You are already in a call. Please leave your current call first.',
        duration: 3000,
      });
      return;
    }

    // Check if there's an active call in this channel
    const activeCallInChannel = activeCalls?.find(
      activeCall => activeCall.channelId === call.channelId,
    );

    if (activeCallInChannel) {
      // Show modal to join the ongoing call
      setPendingCall(call);
      setPendingCallParticipants(participants ?? null);
      setIsJoiningCall(true);
      setCallIdToJoin(activeCallInChannel.externalId);
      setConfirmModalConfig({
        title: 'Join ongoing call?',
        subtitle: `There's already an active call in this chat. Would you like to join?`,
      });
      setShowConfirmModal(true);
      return;
    }

    // Check if channel is DEFAULT scopeType
    const channel = channels.find(c => c.id === call.channelId);
    const isDefaultChannel = channel?.scopeType === ChannelScopeType.DEFAULT;

    // If DEFAULT channel, show confirmation modal
    if (isDefaultChannel) {
      setPendingCall(call);
      setPendingCallParticipants(participants ?? null);
      setIsJoiningCall(false);
      setConfirmModalConfig({
        title: 'Start a call in this channel?',
        subtitle: `You'll be starting a call that all members of # ${channel?.name || 'this channel'} can join.`,
      });
      setShowConfirmModal(true);
      return;
    }

    // For DM/Group DM, proceed directly
    initiateCall(call, participants);
  };

  const handleRestartCall = (call: Call): void => {
    if (hasOnlyParticipantPreview(call)) {
      setFullParticipantAction({ call, action: 'restart' });
      return;
    }

    continueRestartCall(call);
  };

  const handleCallRowClick = (call: Call): void => {
    if (canJoinCall(call)) {
      // Scheduled calls can be joined before their start time as well.
      handleJoinCall(call);
    } else {
      // For ended calls, restart them
      handleRestartCall(call);
    }
  };

  const handleParticipantsClick = (call: Call): void => {
    setSelectedCall(call);
    setIsParticipantsModalOpen(true);
  };

  const handleUserToggle = (user: User): void => {
    setSelectedUsers(prev => {
      const isSelected = prev.some(u => u.id === user.id);
      if (isSelected) {
        return prev.filter(u => u.id !== user.id);
      }
      return [...prev, user];
    });
  };

  const handleRemoveUser = (userId: string): void => {
    setSelectedUsers(prev => prev.filter(u => u.id !== userId));
  };

  // Instant call
  const handleInstantCall = (selectedParticipants: string[]): void => {
    // Check if already in a call
    if (isInCall) {
      toast.info('Already in a call', {
        description: 'You are already in a call. Please leave your current call first.',
        duration: 3000,
      });
      return;
    }

    // Validate participants
    if (selectedParticipants.length === 0) {
      toast.error('No participants selected', {
        description: 'Please select at least one participant.',
        duration: 2000,
      });
      return;
    }

    // Check if a channel is selected (starts with 'channel:')
    const channelSelection = selectedParticipants.find(p => p.startsWith('channel:'));

    if (channelSelection) {
      // Extract channel ID and start call in that channel
      const channelId = channelSelection.replace('channel:', '');
      if (shouldUseCallWindow(isMobile)) {
        openInitiateCallWindow({ channelId, callType: CallType.AUDIO });
        return;
      }
      roomActor.send({
        type: 'INITIATE_CALL',
        channelId,
        callType: CallType.AUDIO,
        zero,
        viewMode: isMobile ? 'full' : 'mini',
      });
    } else {
      // Extract user IDs and create DM/group call
      const targetUserIds = selectedParticipants
        .filter(p => p.startsWith('user:'))
        .map(p => p.replace('user:', ''));

      roomActor.send({
        type: 'INITIATE_CALL',
        callType: CallType.AUDIO,
        targetUserIds,
        zero,
        viewMode: isMobile ? 'full' : 'mini',
      });
    }
  };

  const closeParticipantsModal = (): void => {
    setIsParticipantsModalOpen(false);
  };

  const handleConfirmCall = (): void => {
    setShowConfirmModal(false);
    if (pendingCall) {
      if (isJoiningCall && callIdToJoin) {
        // Join the existing call
        joinCall(callIdToJoin);
      } else {
        // Initiate a new call
        initiateCall(pendingCall, pendingCallParticipants ?? pendingCall.participants);
      }
      setPendingCall(null);
      setPendingCallParticipants(null);
      setIsJoiningCall(false);
      setCallIdToJoin(null);
    }
  };

  const closeConfirmModal = (): void => {
    setShowConfirmModal(false);
    setPendingCall(null);
    setPendingCallParticipants(null);
    setIsJoiningCall(false);
    setCallIdToJoin(null);
  };

  const handleCancelCall = (callId: string): void => {
    try {
      void zero.mutate(
        mutators.calls.cancel({
          callId,
          timestamp: Date.now(),
        }),
      );
      toast.success('Call cancelled successfully');
    } catch (error) {
      logger.error(Logger.API_CALL_FAILED, {
        message: 'Failed to cancel call',
        error,
      });
      toast.error('Failed to cancel call');
    }
  };

  const handleDeleteClick = (call: ScheduledCall): void => {
    setDeleteModalCall(call);
    setDeleteModalOpen(true);
  };

  const handleHideClick = (call: ScheduledCall, options?: { isSeries?: boolean }): void => {
    void callService
      .hideCall(call.externalId, options)
      .then(() => toast.success('Call hidden'))
      .catch(error => {
        logger.error(Logger.API_CALL_FAILED, { message: 'Failed to hide call', error });
        toast.error('Failed to hide call');
      });
  };

  const closeDeleteModal = (): void => {
    setDeleteModalOpen(false);
    setDeleteModalCall(null);
  };

  const buildEditCallData = (call: Call, participants = call.participants ?? []): EditCallData => ({
    id: call.id,
    externalId: call.externalId,
    title: call.title ?? '',
    startsAt: call.startsAt!,
    endsAt: call.endsAt!,
    participants: [...participants],
    organizerUserId: call.organizerId ?? call.createdByUserId,
    channelId: call.channelId,
    recurringSeriesId: call.recurringSeriesId,
    callUpdatesChannel: call.callUpdatesChannel ?? null,
  });

  const openEditModal = (call: Call, participants = call.participants ?? []): void => {
    setEditModalCall({
      ...buildEditCallData(call, participants),
    });
    setEditModalOpen(true);
  };

  const handleEditClick = (call: Call): void => {
    if (hasOnlyParticipantPreview(call)) {
      setFullParticipantAction({ call, action: 'edit' });
      return;
    }

    openEditModal(call);
  };

  const closeEditModal = (): void => {
    setEditModalOpen(false);
    setEditModalCall(null);
  };

  useEffect(() => {
    if (!fullParticipantAction || !actionParticipants) return;
    if (actionParticipantsDetails.type !== 'complete') return;

    if (fullParticipantAction.action === 'restart') {
      continueRestartCall(fullParticipantAction.call, actionParticipants);
    } else {
      openEditModal(fullParticipantAction.call, actionParticipants);
    }

    setFullParticipantAction(null);
  }, [actionParticipants, actionParticipantsDetails.type, fullParticipantAction]);

  const handleDeleteConfirm = (cancelEntireSeries: boolean): void => {
    if (!deleteModalCall) return;

    const isCancelSeries = cancelEntireSeries && !!deleteModalCall.recurringSeriesId;

    if (isCancelSeries) {
      // Cancel the entire series via backend API — this marks all future instances
      // as CANCELLED and removes their Bull jobs. The Zero mutator only updates two
      // records (the clicked call + the series) and never touches the other future instances.
      void callService
        .cancelRecurringSeries(deleteModalCall.recurringSeriesId)
        .then(() => {
          toast.success('Recurring series cancelled');
        })
        .catch(error => {
          logger.error(Logger.API_CALL_FAILED, { message: 'Failed to cancel series', error });
          toast.error('Failed to cancel series');
        });
    } else {
      // Cancel a single instance via backend API — this also triggers buffer replenishment
      // so the 60-day buffer is maintained for the recurring series.
      void callService
        .cancelScheduledCall(deleteModalCall.externalId)
        .then(() => {
          toast.success('Call cancelled successfully');
        })
        .catch(error => {
          logger.error(Logger.API_CALL_FAILED, { message: 'Failed to cancel call', error });
          toast.error('Failed to cancel call');
        });
    }

    closeDeleteModal();
  };

  const getGotoTranscriptHandler = (call: Call): (() => void) | undefined => {
    const metadata = call.metadata as { conversationId?: string } | null;
    return metadata?.conversationId ? () => handleGotoTranscript(call) : undefined;
  };

  const handleGotoTranscript = (call: Call): void => {
    const metadata = call.metadata as { conversationId?: string } | null;
    const conversationId = metadata?.conversationId;
    const callUpdatesChannelId = call.callUpdatesChannel ?? call.channelId;

    const showInfo = ({
      header,
      description,
    }: {
      header: string;
      description: string;
    }): string | number =>
      toast.info(header, {
        description,
        duration: 3000,
      });

    if (!callUpdatesChannelId) {
      showInfo({ header: 'No channel found', description: 'No channel found for this call.' });
      return;
    }

    if (!conversationId) {
      showInfo({
        header: 'No conversation found',
        description: 'No conversation found for this call.',
      });
      return;
    }

    void navigate(`/chat/dir/${callUpdatesChannelId}/${conversationId}#origin=${conversationId}`);
  };

  const handleDownloadTranscript = (call: Call): void => {
    void (async () => {
      try {
        const response = await callService.downloadTranscript(call.externalId);

        // Convert the response text to a blob for download
        const blob = new Blob([response.data], { type: 'text/plain' });
        const fileName = `call_transcript_${call.externalId}_${new Date().toISOString().split('T')[0]}.txt`;

        if (reactNativeBridge.isAvailable()) {
          try {
            const base64Data = await blobToBase64(blob);
            const mimeType = response.contentType || blob.type || 'application/octet-stream';
            const dispatched = reactNativeBridge.saveFileToDevice({
              fileName,
              mimeType,
              base64Data,
            });

            if (dispatched) {
              return;
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Failed to download transcript';

            logger.error(Logger.API_OPERATIONAL_ERROR, {
              message: 'Failed to download transcript on mobile device',
              error: errorMessage,
            });

            toast.error(errorMessage, { id: 'download-transcript' });
            return;
          }
        }

        // Create a download link
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();

        // Cleanup
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        logger.info(Logger.API_CALL_SUCCESSFUL, {
          message: 'Transcript download completed',
          bytes: blob.size,
          fileName,
        });
        toast.success('Transcript downloaded', { id: 'download-transcript' });
      } catch (error) {
        logger.error(Logger.API_CALL_FAILED, {
          message: 'Failed to download transcript',
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        // Axios interceptor already extracts the error message from response.data.error
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to download transcript';

        toast.error(errorMessage, {
          id: 'download-transcript',
        });
      }
    })();
  };

  return {
    calls: recentCalls,
    scheduledCalls,
    calendarScheduledCalls,
    missedCalls,
    isLoading,
    isScheduledCallsLoading: scheduledQueryDetails.type === 'unknown',
    queryDetails,
    selectedCall,
    isParticipantsModalOpen,
    selectedUsers,
    handleCallRowClick,
    handleParticipantsClick,
    handleUserToggle,
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
    handleCancelCall,
    hasMoreCalls,
    loadMoreCalls,
    onVisibleRangeChanged,
    handleDeleteClick,
    deleteModalOpen,
    deleteModalCall,
    handleDeleteConfirm,
    closeDeleteModal,
    handleHideClick,
    handleEditClick,
    editModalOpen,
    editModalCall,
    closeEditModal,
    showChannelCalls,
    setShowChannelCalls,
  };
}
