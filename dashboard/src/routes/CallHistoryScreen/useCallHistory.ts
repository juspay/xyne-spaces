import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useZero } from '../../hooks/useZero';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../zero/queries';
import { roomActor } from '../../machines/roomMachine';
import { CallType, ChannelScopeType } from '@xyne/shared';
import { useSelector } from '@xstate/react';
import { toast } from 'sonner';
import { usePlatform } from '../../hooks/usePlatform';
import { stateMachineActor, type User } from '../../machines/stateMachine';
import { getParticipantUsers } from './callHistoryItem.utils';
import { useAllChannels } from '../../hooks/useChannels';
import { useActiveCalls } from '../../hooks/useCalls';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { callService } from '../../services/Call/callService';
import { reactNativeBridge } from '../../utils/reactNativeBridge';
import { blobToBase64 } from '../../services/clients/fileFetchService';
import { logger, Event as Logger } from '../../utils/logger';

type CallHistoryResult = QueryResultType<typeof queries.userCallHistory>;
type Call = CallHistoryResult[number];

interface UseCallHistoryReturn {
  calls: Call[] | undefined;
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
  handleInitiateCall: () => void;
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
}

export function useCallHistory(userId: string | undefined): UseCallHistoryReturn {
  const zero = useZero();
  const [calls, queryDetails] = useCachedQuery(queries.userCallHistory());
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [isParticipantsModalOpen, setIsParticipantsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalConfig, setConfirmModalConfig] = useState<{
    title: string;
    subtitle: string;
  }>({ title: '', subtitle: '' });
  const [pendingCall, setPendingCall] = useState<Call | null>(null);
  const [isJoiningCall, setIsJoiningCall] = useState(false); // Track if joining vs initiating
  const [callIdToJoin, setCallIdToJoin] = useState<string | null>(null); // Store the active call's externalId
  const navigate = useNavigate();

  const { isMobile } = usePlatform();

  // Get all users from state machine
  const allUsers = useSelector(stateMachineActor, state => state.context.users);

  // Helper function to get channel by ID from state machine
  const channels = useAllChannels();

  // Get active calls to check if channel has ongoing call
  const activeCalls = useActiveCalls();

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
    return (calls || []).filter(call => {
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
  }, [calls, searchQuery, userId, allUsers]);

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
    // If user is already in a different call, show toast instead of allowing join
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
        subtitle: `You'll be starting a call that all ${channel?.participantCount || 0} members of # ${channel?.name || 'this channel'} can join.`,
      });
      setShowConfirmModal(true);
      return;
    }

    // For DM/Group DM, proceed directly
    initiateCall(call);
  };

  const handleCallRowClick = (call: Call): void => {
    if (call.endedAt === null) {
      handleJoinCall(call);
    } else {
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
      } else {
        return [...prev, user];
      }
    });
  };

  const handleRemoveUser = (userId: string): void => {
    setSelectedUsers(prev => prev.filter(u => u.id !== userId));
  };

  const handleInitiateCall = (): void => {
    // If user is in any call, show toast instead of allowing new call
    if (isInCall) {
      toast.info('Already in a call', {
        description: 'You are already in a call. Please leave your current call first.',
        duration: 3000,
      });
      return;
    }

    if (selectedUsers.length === 0) {
      return;
    }

    const targetUserIds = selectedUsers.map(u => u.id);

    // Backend will create DM for 1 user, group DM for multiple users
    roomActor.send({
      type: 'INITIATE_CALL',
      callType: CallType.AUDIO,
      targetUserIds,
      zero,
      viewMode: isMobile ? 'full' : 'mini',
    });

    // Clear selection after initiating call
    setSelectedUsers([]);
    setSearchQuery('');
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

  const handleGotoTranscript = (call: Call): void => {
    const metadata = call.metadata as { conversationId?: string } | null;
    const conversationId = metadata?.conversationId;

    const showInfo = ({ header, description }: { header: string; description: string }) =>
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
    calls,
    queryDetails,
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
    handleInitiateCall,
    closeParticipantsModal,
    handleGotoTranscript,
    handleDownloadTranscript,
    showConfirmModal,
    confirmModalConfig,
    handleConfirmCall,
    closeConfirmModal,
  };
}
