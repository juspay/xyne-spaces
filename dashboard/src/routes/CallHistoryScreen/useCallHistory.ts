import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useZero } from '../../hooks/useZero';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { roomActor } from '../../machines/roomMachine';
import { CallType, CallStatus, ChannelScopeType, InvitationResponse } from '@xyne/shared';
import { useSelector } from '@xstate/react';
import { toast } from 'sonner';
import { usePlatform } from '../../hooks/usePlatform';
import { stateMachineActor, type User } from '../../machines/stateMachine';
import { getCallStatus, getParticipantUsers } from './callHistoryItem.utils';
import { useAllChannels } from '../../hooks/useChannels';
import { useActiveCalls } from '../../hooks/useCalls';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { callService } from '../../services/Call/callService';
import { reactNativeBridge } from '../../utils/reactNativeBridge';
import { blobToBase64 } from '../../services/clients/fileFetchService';
import { logger, Event as Logger } from '../../utils/logger';
import { usePaginatedCalls } from '../../hooks/usePaginatedCalls';

type CallHistoryResult = QueryResultType<typeof queries.userCallHistory>;
type ScheduledCallsResult = QueryResultType<typeof queries.userScheduledCalls>;
type Call = CallHistoryResult[number];
type ScheduledCall = ScheduledCallsResult[number];

interface UseCallHistoryReturn {
  calls: Call[] | undefined;
  scheduledCalls: ScheduledCall[] | undefined;
  missedCalls: QueryResultType<typeof queries.userCallHistory>;
  queryDetails: ReturnType<typeof useCachedQuery>[1];
  selectedCall: Call | null;
  isParticipantsModalOpen: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredUsers: User[];
  filteredCalls: Call[];
  selectedUsers: User[];
  handleCallRowClick: (call: Call) => void;
  handleParticipantsClick: (call: Call) => void;
  handleUserToggle: (user: User) => void;
  handleRemoveUser: (userId: string) => void;
  closeParticipantsModal: () => void;
  handleGotoTranscript: (call: Call) => void;
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
  /** Open the edit-call modal for a specific call */
  handleEditClick: (call: ScheduledCall) => void;
  editModalOpen: boolean;
  editModalCall: ScheduledCall | null;
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
  } = usePaginatedCalls();

  const [allScheduledCalls] = useCachedQuery(queries.userScheduledCalls());

  // Fetch all calls when user is searching, so search covers everything
  const [searchQuery, setSearchQuery] = useState('');
  const isSearching = searchQuery.trim().length > 0;

  // Toggle for showing channel calls (calls in channels the user is a member of but wasn't invited to)
  const [showChannelCalls, setShowChannelCalls] = useState(false);
  const [allCallsForSearch] = useCachedQuery(
    queries.userCallHistory({ limit: 9999, start: null }),
    { enabled: isSearching },
  );

  const calls = accumulatedCalls;
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [isParticipantsModalOpen, setIsParticipantsModalOpen] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalConfig, setConfirmModalConfig] = useState<{
    title: string;
    subtitle: string;
  }>({ title: '', subtitle: '' });
  const [pendingCall, setPendingCall] = useState<Call | null>(null);
  const [isJoiningCall, setIsJoiningCall] = useState(false); // Track if joining vs initiating
  const [callIdToJoin, setCallIdToJoin] = useState<string | null>(null); // Store the active call's externalId
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteModalCall, setDeleteModalCall] = useState<ScheduledCall | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editModalCall, setEditModalCall] = useState<ScheduledCall | null>(null);
  const navigate = useNavigate();

  const { isMobile } = usePlatform();

  // Get all users from state machine
  const allUsers = useSelector(stateMachineActor, state => state.context.users);

  // Helper function to get channel by ID from state machine
  const channels = useAllChannels();

  // Get active calls to check if channel has ongoing call
  const activeCalls = useActiveCalls();
  // Filter scheduled calls to only show those that haven't ended yet.
  const scheduledCalls = useMemo(() => {
    if (!allScheduledCalls) return undefined;

    const now = Date.now();
    const filtered = allScheduledCalls.filter(call => {
      // Only show scheduled calls that haven't passed their end time
      if (call.status === CallStatus.ACTIVE) {
        return false;
      }
      // Don't show calls that have already started
      if (call.startsAt && new Date(call.startsAt).getTime() <= now) {
        return false;
      }
      return call.endsAt && new Date(call.endsAt).getTime() > now;
    });

    // Sort by start time ascending
    filtered.sort((a, b) => {
      const aTime = a.startsAt ? new Date(a.startsAt).getTime() : Infinity;
      const bTime = b.startsAt ? new Date(b.startsAt).getTime() : Infinity;
      return aTime - bTime;
    });

    return filtered;
  }, [allScheduledCalls]);

  const recentCalls = useMemo(() => {
    // When searching, use the full dataset; otherwise use accumulated (paginated) calls
    const baseCalls = searchQuery.trim() ? allCallsForSearch : calls;
    if (!baseCalls) return undefined;

    const now = Date.now();

    // Get active scheduled calls that have started
    const activeScheduledCalls =
      allScheduledCalls?.filter(
        call =>
          call.status === CallStatus.ACTIVE ||
          (call.startsAt && new Date(call.startsAt).getTime() <= now),
      ) || [];

    // Combine base calls with active scheduled calls
    let allCalls = [...baseCalls, ...activeScheduledCalls];

    // If showChannelCalls is false (default), filter out calls in channels where user wasn't invited
    if (!showChannelCalls) {
      allCalls = allCalls.filter(call => {
        // Check if user was invited to this call (exists in participants)
        const userParticipant = call.participants?.find(p => p.userId === userId);
        // Only show calls where user was invited
        return !!userParticipant;
      });
    }

    return allCalls.sort((a, b) => {
      const aTime = a.startedAt || a.startsAt || a.createdAt;
      const bTime = b.startedAt || b.startsAt || b.createdAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
  }, [calls, allCallsForSearch, searchQuery, allScheduledCalls, showChannelCalls, userId]);

  // Filter users by search query (excluding current user)
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return [];

    const lowerQuery = searchQuery.toLowerCase();
    return allUsers.filter(user => {
      if (user.id === userId) return false; // Exclude current user
      const nameMatch = user.name?.toLowerCase().includes(lowerQuery);
      const emailMatch = user.email?.toLowerCase().includes(lowerQuery);
      return nameMatch || emailMatch;
    });
  }, [allUsers, searchQuery, userId]);

  // Filter calls by search query (search in participant names/emails)
  const filteredCalls = useMemo(() => {
    if (!searchQuery.trim()) return calls || [];

    const lowerQuery = searchQuery.toLowerCase();
    return (recentCalls || []).filter(call => {
      // Get all participants except current user
      const participants = call.participants?.filter(p => p.userId !== userId) || [];
      const users = getParticipantUsers(participants, allUsers);

      // Check if any participant matches the search query
      return users.some(user => {
        const nameMatch = user.name?.toLowerCase().includes(lowerQuery);
        const emailMatch = user.email?.toLowerCase().includes(lowerQuery);
        return nameMatch || emailMatch;
      });
    });
  }, [recentCalls, searchQuery, userId, allUsers]);

  const missedCalls = useMemo(() => {
    if (!recentCalls || !userId) return [];

    return recentCalls.filter(call => {
      // Skip scheduled and active calls
      if (call.status === CallStatus.SCHEDULED || call.status === CallStatus.ACTIVE) {
        return false;
      }

      const isOutgoingCall = call.createdByUserId === userId;
      const currentUserParticipant = call.participants?.find(p => p.userId === userId);
      if (!currentUserParticipant) {
        return false;
      }
      const hasCurrentUserJoined = currentUserParticipant?.response === InvitationResponse.ACCEPTED;
      const userJoinedandLeft = currentUserParticipant?.response === InvitationResponse.LEFT;
      const anyoneJoined = (call.participants || []).some(
        p => p.response === InvitationResponse.ACCEPTED || p.response === InvitationResponse.LEFT,
      );

      const callStatus = getCallStatus(
        call,
        isOutgoingCall,
        hasCurrentUserJoined,
        userJoinedandLeft,
        anyoneJoined,
      );
      return callStatus.isMissedCall;
    });
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
    // Use JOIN_CALL for all calls - backend API handles both regular and scheduled calls
    roomActor.send({
      type: 'JOIN_CALL',
      callId: callId,
      zero,
      viewMode: isMobile ? 'full' : 'mini',
    });
  };

  const initiateCall = (call: Call): void => {
    const participantUserIds = call.participants?.map(p => p.userId) || [];

    roomActor.send({
      type: 'INITIATE_CALL',
      channelId: call.channelId,
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

  const handleRestartCall = (call: Call): void => {
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
      setIsJoiningCall(false);
      setConfirmModalConfig({
        title: 'Start a call in this channel?',
        subtitle: `You'll be starting a call that all members of # ${channel?.name || 'this channel'} can join.`,
      });
      setShowConfirmModal(true);
      return;
    }

    // For DM/Group DM, proceed directly
    initiateCall(call);
  };

  const handleCallRowClick = (call: Call): void => {
    // For scheduled calls, always join (even if not started yet)
    if (call.status === CallStatus.SCHEDULED) {
      handleJoinCall(call);
    } else if (call.status === CallStatus.ACTIVE) {
      // For active/in-progress calls, join them
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
        initiateCall(pendingCall);
      }
      setPendingCall(null);
      setIsJoiningCall(false);
      setCallIdToJoin(null);
    }
  };

  const closeConfirmModal = (): void => {
    setShowConfirmModal(false);
    setPendingCall(null);
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

  const closeDeleteModal = (): void => {
    setDeleteModalOpen(false);
    setDeleteModalCall(null);
  };

  const handleEditClick = (call: ScheduledCall): void => {
    setEditModalCall(call);
    setEditModalOpen(true);
  };

  const closeEditModal = (): void => {
    setEditModalOpen(false);
    setEditModalCall(null);
  };

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

  const handleGotoTranscript = (call: Call): void => {
    const metadata = call.metadata as { conversationId?: string } | null;
    const conversationId = metadata?.conversationId;

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

    if (!call.channelId) {
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

    void navigate(`/chat/dir/${call.channelId}/${conversationId}#origin=${conversationId}`);
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
    missedCalls,
    queryDetails: { type: 'complete' },
    selectedCall,
    isParticipantsModalOpen,
    searchQuery,
    setSearchQuery,
    filteredUsers,
    filteredCalls,
    selectedUsers,
    handleCallRowClick,
    handleParticipantsClick,
    handleUserToggle,
    handleRemoveUser,
    closeParticipantsModal,
    handleGotoTranscript,
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
    handleEditClick,
    editModalOpen,
    editModalCall,
    closeEditModal,
    showChannelCalls,
    setShowChannelCalls,
  };
}
