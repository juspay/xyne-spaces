import { useState, useMemo, useCallback, useRef } from 'react';
import { useSelector } from '@xstate/react';
import {
  X,
  UserPlus,
  Users,
  ChevronUp,
  ChevronDown,
  MicOff,
  Mic,
  UserX,
  Check,
  XIcon,
  Hand,
} from 'lucide-react';
import { useIsSpeaking } from '@livekit/components-react';
import type { Participant } from 'livekit-client';
import { roomActor, type ParticipantInfo } from '../../../machines/roomMachine';
import { useUser } from '../../../hooks/useUsers';
import { useAuth } from '../../../hooks/useAuth';
import { InvitationResponse, type CallParticipantMetadata } from '@xyne/shared';
import Avatar from '../../ui/Avatar/Avatar';
import { InviteToCallModal } from '../CallModals/InviteToCallModal';
import { callService } from '../../../services/Call/callService';
import { getUserDisplayName, isUserDeactivated } from '../../../utils/userDisplayName';
import { cn } from '../../../utils/classNames';
import { logger, Event } from '../../../utils/logger';

// Speaking indicator component (animated bars like Google Meet)
function SpeakingIndicator(): React.ReactElement {
  return (
    <div className='flex items-center gap-[2px] h-4'>
      <span className='w-[3px] h-2 bg-green-500 rounded-full animate-[speaking_0.5s_ease-in-out_infinite]' />
      <span className='w-[3px] h-3 bg-green-500 rounded-full animate-[speaking_0.5s_ease-in-out_infinite_0.1s]' />
      <span className='w-[3px] h-2 bg-green-500 rounded-full animate-[speaking_0.5s_ease-in-out_infinite_0.2s]' />
    </div>
  );
}

interface ParticipantsSidebarProps {
  callId: string;
  onClose: () => void;
  /** If provided, used instead of fetching from activeCalls */
  callParticipants?: readonly CallParticipant[] | undefined;
  /** If provided, used instead of computing from activeCalls */
  isHost?: boolean | undefined;
  /** If provided, used instead of useAuth().user?.id */
  currentUserId?: string | null | undefined;
  /** Callback when host admits an external participant */
  onApproveLobbyRequest?: ((participantId: string) => void) | undefined;
  /** Callback when host declines an external participant */
  onRejectLobbyRequest?: ((participantId: string) => void) | undefined;
  /** Hide "Add People" button and invite modal (e.g. for external users) */
  hideInvite?: boolean | undefined;
  /** Identities (userIds) of participants with hand raised */
  raisedHands?: string[] | undefined;
}

interface CallParticipant {
  id: string;
  callId: string;
  userId: string;
  invitedBy: string;
  invitedAt: number;
  response: string | null;
  respondedAt: number | null;
  joinedAt: number | null;
  leftAt: number | null;
  metadata: unknown;
  displayName?: string | null | undefined;
  isExternal?: boolean | undefined;
}

interface ActiveCall {
  externalId: string;
  createdByUserId?: string;
  participants?: CallParticipant[];
}

function isLiveKitExternalParticipant(participantInfo: ParticipantInfo): boolean {
  const metadata = participantInfo.participant?.metadata;
  if (!metadata) return false;

  try {
    return (JSON.parse(metadata) as { isExternal?: boolean }).isExternal === true;
  } catch {
    return false;
  }
}

function SpeakingStatus({
  livekitParticipant,
}: {
  livekitParticipant: Participant | undefined;
}): React.ReactElement | null {
  const isSpeaking = useIsSpeaking(livekitParticipant);
  if (!isSpeaking) return null;
  return <SpeakingIndicator />;
}

function SectionHeader({
  title,
  count,
  isExpanded,
  onToggle,
}: {
  title: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      onClick={onToggle}
      className='flex items-center justify-between w-full px-3 py-2.5 hover:bg-muted transition-colors'
      data-track-category='CALLS'
      data-track-name='Toggle_Participants_Section'
      data-track-metadata={JSON.stringify({ section: title, isExpanded: !isExpanded })}
    >
      <span className='text-sm font-medium text-foreground'>{title}</span>
      <div className='flex items-center gap-4'>
        <span className='text-sm text-muted-foreground'>{count}</span>
        {isExpanded ? (
          <ChevronUp size={16} className='text-muted-foreground' />
        ) : (
          <ChevronDown size={16} className='text-muted-foreground' />
        )}
      </div>
    </button>
  );
}

interface ParticipantItemProps {
  participant: CallParticipant;
  showMuteButton?: boolean;
  currentUserId?: string | null;
  isExternal?: boolean;
  callId: string;
  hostUserId: string | undefined;
  raisedHands: string[];
  livekitParticipantMap: Map<string, ParticipantInfo>;
  mutingParticipantId: string | null;
  removingParticipantId: string | null;
  onMuteParticipant: (participantUserId: string) => void | Promise<void>;
  onRemoveParticipant: (participantUserId: string, name: string) => void | Promise<void>;
}

// ParticipantItem component that uses useUser hook internally
function ParticipantItem({
  participant,
  showMuteButton = false,
  currentUserId,
  isExternal = false,
  callId,
  hostUserId,
  raisedHands,
  livekitParticipantMap,
  mutingParticipantId,
  removingParticipantId,
  onMuteParticipant,
  onRemoveParticipant,
}: ParticipantItemProps): React.ReactElement {
  const { response, userId, displayName } = participant;
  const wasRemovedByHost =
    (participant.metadata as CallParticipantMetadata | null)?.removedByHost === true;
  // Only look up user via Zero if we don't have a displayName and it's not external
  const shouldLookupUser = !isExternal && !displayName;
  const participantUser = useUser(shouldLookupUser ? userId : '');
  const isInCall = response === InvitationResponse.ACCEPTED || response === 'ACCEPTED';
  const isMutingThis = mutingParticipantId === userId;

  // Get LiveKit participant for speaking detection and mute status
  const livekitParticipant = livekitParticipantMap.get(userId);
  const livekitParticipantObj = livekitParticipant?.participant;
  const isMicrophoneEnabled = livekitParticipant?.isMicrophoneEnabled ?? true;

  // Determine if mute button should be shown for this participant
  // Show only if: host, participant is in call, not the current user (self), not an agent
  const canMute =
    showMuteButton && isInCall && userId !== currentUserId && !userId.startsWith('agent-');
  const canRemove = canMute;
  const isRemovingThis = removingParticipantId === userId;

  // Use displayName when provided (e.g. from API for external view), otherwise look up user
  const participantName = displayName
    ? displayName
    : isExternal
      ? 'Guest'
      : getUserDisplayName(participantUser);

  // Check if user is deactivated (only for non-external users with lookup)
  const isDeactivated = !isExternal && !displayName ? isUserDeactivated(participantUser) : false;

  // Get initials for external users fallback
  const fallbackInitial = participantName.charAt(0).toUpperCase();

  const isRaised = raisedHands.includes(userId);

  return (
    <div
      className={cn(
        'flex items-center gap-3 py-2 px-3 rounded-lg transition-colors',
        isRaised ? 'bg-amber-50 ring-1 ring-amber-300' : 'hover:bg-muted',
      )}
    >
      <div className='relative'>
        {isExternal ? (
          <div className='flex items-center justify-center w-5 h-5 bg-orange-400 text-white text-xs font-medium rounded-sm'>
            {fallbackInitial}
          </div>
        ) : (
          <Avatar userId={userId} size='sm' />
        )}
        {isInCall && (
          <span className='absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white' />
        )}
      </div>
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-1.5'>
          <p
            className={`text-sm font-medium truncate ${isDeactivated ? 'text-muted-foreground' : 'text-foreground'}`}
          >
            {participantName}
          </p>
          {hostUserId && userId === hostUserId && (
            <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 shrink-0'>
              Host
            </span>
          )}
          {isDeactivated && (
            <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground shrink-0'>
              Deactivated
            </span>
          )}
          {isExternal && (
            <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-700 shrink-0'>
              External
            </span>
          )}
        </div>
        {wasRemovedByHost ? (
          <p className='text-xs text-red-500'>Removed by host</p>
        ) : (
          <>
            {response === InvitationResponse.LEFT && (
              <p className='text-xs text-muted-foreground'>Left the call</p>
            )}
            {response === InvitationResponse.INVITED && (
              <p className='text-xs text-yellow-600'>Invited</p>
            )}
            {response === InvitationResponse.DECLINED && (
              <p className='text-xs text-red-500'>Declined</p>
            )}
            {response === InvitationResponse.REQUESTED && (
              <p className='text-xs text-orange-500'>Requesting to join</p>
            )}
          </>
        )}
      </div>
      {/* Hand raise indicator */}
      {isRaised && (
        <div className='p-1.5 text-amber-500' title='Hand raised'>
          <Hand size={16} className='fill-amber-400/30' />
        </div>
      )}
      {/* Speaking indicator - only show when mic is enabled */}
      {isInCall && livekitParticipantObj && isMicrophoneEnabled && (
        <SpeakingStatus livekitParticipant={livekitParticipantObj} />
      )}
      {/* Mute status indicator (for non-host or when participant is muted) */}
      {isInCall && !isMicrophoneEnabled && !canMute && (
        <div className='p-1.5 text-red-500' title='Muted'>
          <MicOff size={16} />
        </div>
      )}
      {/* Mute/Unmute button - always visible for host */}
      {canMute && (
        <button
          onClick={() => void onMuteParticipant(userId)}
          disabled={isMutingThis || !isMicrophoneEnabled}
          className={`p-1.5 rounded-md transition-colors disabled:cursor-not-allowed ${
            !isMicrophoneEnabled
              ? 'text-red-500 bg-red-50'
              : 'hover:bg-secondary text-muted-foreground hover:text-foreground'
          }`}
          data-track-category='CALLS'
          data-track-name='MUTE_PARTICIPANT'
          data-track-metadata={JSON.stringify({ callId, participantUserId: userId })}
          title={!isMicrophoneEnabled ? `${participantName} is muted` : `Mute ${participantName}`}
        >
          {isMutingThis ? (
            <div className='w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin' />
          ) : !isMicrophoneEnabled ? (
            <MicOff size={16} />
          ) : (
            <Mic size={16} />
          )}
        </button>
      )}
      {canRemove && (
        <button
          onClick={() => void onRemoveParticipant(userId, participantName)}
          disabled={isRemovingThis}
          className='p-1.5 rounded-md transition-colors disabled:cursor-not-allowed text-muted-foreground hover:bg-red-50 hover:text-red-600'
          data-track-category='CALLS'
          data-track-name='REMOVE_PARTICIPANT'
          data-track-metadata={JSON.stringify({ callId, participantUserId: userId })}
          title={`Remove ${participantName} from the call`}
        >
          {isRemovingThis ? (
            <div className='w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin' />
          ) : (
            <UserX size={16} />
          )}
        </button>
      )}
    </div>
  );
}

interface RequestedParticipantItemProps {
  participant: CallParticipant;
  canActOnRequest: boolean;
  approvingId: string | null;
  rejectingId: string | null;
  onApprove: (participantId: string) => void;
  onReject: (participantId: string) => void;
}

// Inner component for requested participants — looks up user name via useUser
function RequestedParticipantItem({
  participant,
  canActOnRequest,
  approvingId,
  rejectingId,
  onApprove,
  onReject,
}: RequestedParticipantItemProps): React.ReactElement {
  const { userId, displayName, isExternal } = participant;
  const participantUser = useUser(!isExternal ? userId : '');
  const resolvedName = displayName || participantUser?.name || 'Guest';
  const initial = resolvedName.charAt(0).toUpperCase();

  return (
    <div className='flex items-center gap-3 py-2 px-3 hover:bg-orange-50/50 transition-colors'>
      <div className='relative'>
        <div className='flex items-center justify-center w-8 h-8 bg-orange-400 text-white text-xs font-semibold rounded-full'>
          {initial}
        </div>
      </div>
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-1.5'>
          <p className='text-sm font-medium text-foreground truncate'>{resolvedName}</p>
          {isExternal && (
            <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-700 shrink-0'>
              External
            </span>
          )}
        </div>
        <p className='text-xs text-orange-500'>Requesting to join</p>
      </div>
      {canActOnRequest && (
        <div className='flex items-center gap-1.5 shrink-0'>
          <button
            onClick={() => onApprove(participant.id)}
            disabled={approvingId === participant.id}
            className='inline-flex items-center justify-center w-7 h-7 rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
            title='Admit'
            data-track-category='CALLS'
            data-track-name='APPROVE_LOBBY_REQUEST'
          >
            {approvingId === participant.id ? (
              <div className='w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin' />
            ) : (
              <Check size={14} />
            )}
          </button>
          <button
            onClick={() => onReject(participant.id)}
            disabled={rejectingId === participant.id}
            className='inline-flex items-center justify-center w-7 h-7 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
            title='Decline'
            data-track-category='CALLS'
            data-track-name='REJECT_LOBBY_REQUEST'
          >
            {rejectingId === participant.id ? (
              <div className='w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin' />
            ) : (
              <XIcon size={14} />
            )}
          </button>
        </div>
      )}
    </div>
  );
}

export function ParticipantsSidebar({
  callId,
  onClose,
  callParticipants: callParticipantsProp,
  isHost: isHostProp,
  currentUserId: currentUserIdProp,
  onApproveLobbyRequest,
  onRejectLobbyRequest,
  hideInvite,
  raisedHands = [],
}: ParticipantsSidebarProps): React.ReactElement {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [isAttendeesExpanded, setIsAttendeesExpanded] = useState(true);
  const [isAlsoInvitedExpanded, setIsAlsoInvitedExpanded] = useState(true);
  const [isRequestedExpanded, setIsRequestedExpanded] = useState(true);
  const [isMuting, setIsMuting] = useState(false);
  const [mutingParticipantId, setMutingParticipantId] = useState<string | null>(null);
  const [removingParticipantId, setRemovingParticipantId] = useState<string | null>(null);
  const removingParticipantIdRef = useRef<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const { user } = useAuth();

  // Get active calls and find current call (fallback when props not provided)
  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);
  const currentCall = useMemo(
    () => (activeCalls as ActiveCall[] | undefined)?.find(call => call.externalId === callId),
    [activeCalls, callId],
  );

  // Get LiveKit participants from room state (for speaking detection)
  const livekitParticipants = useSelector(roomActor, state => state.context.participants);

  // Create a map of userId -> LiveKit participant for quick lookup
  const livekitParticipantMap = useMemo(() => {
    const map = new Map<string, ParticipantInfo>();
    livekitParticipants.forEach(p => {
      map.set(p.identity, p);
    });
    return map;
  }, [livekitParticipants]);

  // Use props when provided, fallback to internal computation
  const resolvedCurrentUserId =
    currentUserIdProp !== undefined ? currentUserIdProp : (user?.id ?? null);
  const isHost = isHostProp !== undefined ? isHostProp : currentCall?.createdByUserId === user?.id;
  const hostUserId = currentCall?.createdByUserId;

  // Merge LiveKit state so joins show before DB sync catches up.
  const participantsFromDb = callParticipantsProp ?? currentCall?.participants ?? [];
  const participants = useMemo(() => {
    const livekitByIdentity = new Map(livekitParticipants.map(p => [p.identity, p]));
    const seenUserIds = new Set<string>();

    const mergedParticipants = participantsFromDb.map(participant => {
      seenUserIds.add(participant.userId);
      const livekitParticipant = livekitByIdentity.get(participant.userId);
      if (!livekitParticipant) return participant;

      return {
        ...participant,
        response: InvitationResponse.ACCEPTED,
        leftAt: null,
        displayName: participant.displayName ?? livekitParticipant.name ?? null,
        isExternal: participant.isExternal ?? isLiveKitExternalParticipant(livekitParticipant),
      };
    });

    livekitParticipants.forEach(livekitParticipant => {
      if (seenUserIds.has(livekitParticipant.identity)) return;
      if (livekitParticipant.identity.startsWith('agent-')) return;

      mergedParticipants.push({
        id: `livekit-${livekitParticipant.identity}`,
        callId,
        userId: livekitParticipant.identity,
        invitedBy: livekitParticipant.identity,
        invitedAt: 0,
        response: InvitationResponse.ACCEPTED,
        respondedAt: null,
        joinedAt: null,
        leftAt: null,
        metadata: null,
        displayName: livekitParticipant.name ?? null,
        isExternal: isLiveKitExternalParticipant(livekitParticipant),
      });
    });

    return mergedParticipants;
  }, [callId, livekitParticipants, participantsFromDb]);

  // Handle mute all participants
  const handleMuteAll = useCallback(async () => {
    if (isMuting) return;

    setIsMuting(true);
    try {
      await callService.muteAllParticipants(callId);
    } catch (error) {
      logger.error(Event.API_CALL_FAILED, {
        callId,
        context: 'ParticipantsSidebar.muteAllParticipants',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsMuting(false);
    }
  }, [callId, isMuting]);

  // Handle mute individual participant
  const handleMuteParticipant = useCallback(
    async (participantUserId: string) => {
      if (mutingParticipantId) return;

      setMutingParticipantId(participantUserId);
      try {
        await callService.muteParticipant(callId, participantUserId);
      } catch (error) {
        logger.error(Event.API_CALL_FAILED, {
          callId,
          context: 'ParticipantsSidebar.muteParticipant',
          participantUserId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setMutingParticipantId(null);
      }
    },
    [callId, mutingParticipantId],
  );

  const handleRemoveParticipant = useCallback(
    async (participantUserId: string, name: string) => {
      if (removingParticipantIdRef.current) return;
      if (
        !window.confirm(
          `Remove ${name} from the call? They'll need to be admitted again to rejoin.`,
        )
      ) {
        return;
      }

      removingParticipantIdRef.current = participantUserId;
      setRemovingParticipantId(participantUserId);
      try {
        await callService.removeParticipant(callId, participantUserId);
      } catch (error) {
        logger.error(Event.API_CALL_FAILED, {
          callId,
          context: 'ParticipantsSidebar.removeParticipant',
          participantUserId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        removingParticipantIdRef.current = null;
        setRemovingParticipantId(null);
      }
    },
    [callId],
  );

  // Split participants into Contributors (ACCEPTED), Requested (REQUESTED), Also Invited (others)
  const { contributors, alsoInvited, requested } = useMemo(() => {
    const contributors: CallParticipant[] = [];
    const alsoInvited: CallParticipant[] = [];
    const requested: CallParticipant[] = [];

    participants.forEach(participant => {
      const resp = participant.response;
      if (resp === InvitationResponse.REQUESTED || resp === 'REQUESTED') {
        requested.push(participant);
      } else if (resp === InvitationResponse.ACCEPTED || resp === 'ACCEPTED') {
        contributors.push(participant);
      } else {
        alsoInvited.push(participant);
      }
    });

    return { contributors, alsoInvited, requested };
  }, [participants]);

  const handleApprove = useCallback(
    (participantId: string) => {
      if (!onApproveLobbyRequest || approvingId) return;
      setApprovingId(participantId);
      try {
        onApproveLobbyRequest(participantId);
      } finally {
        setApprovingId(null);
      }
    },
    [onApproveLobbyRequest, approvingId],
  );

  const handleReject = useCallback(
    (participantId: string) => {
      if (!onRejectLobbyRequest || rejectingId) return;
      setRejectingId(participantId);
      try {
        onRejectLobbyRequest(participantId);
      } finally {
        setRejectingId(null);
      }
    },
    [onRejectLobbyRequest, rejectingId],
  );

  // Anyone already in the call can admit/decline join requests — not just the host.
  // (Only the host gets the toast)
  const isAttendee = useMemo(
    () => contributors.some(participant => participant.userId === resolvedCurrentUserId),
    [contributors, resolvedCurrentUserId],
  );
  const canActOnLobbyRequests =
    (isHost || isAttendee) && !!onApproveLobbyRequest && !!onRejectLobbyRequest;

  return (
    <>
      <div className='flex flex-col h-full bg-background text-foreground'>
        {/* Header */}
        <div className='flex items-center justify-between px-4 py-3 border-b border-border'>
          <div className='flex items-center gap-2'>
            <Users size={20} className='text-muted-foreground' />
            <h2 className='text-lg font-semibold'>Participants</h2>
          </div>
          <div className='flex items-center gap-2'>
            {isHost && contributors.length > 1 && (
              <button
                onClick={() => void handleMuteAll()}
                disabled={isMuting}
                className='flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card hover:bg-accent text-foreground border border-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                title='Mute all participants'
                data-testid='mute-all-button'
                data-track-category='CALLS'
                data-track-name='MUTE_ALL_PARTICIPANTS'
                data-track-metadata={JSON.stringify({ callId })}
              >
                <MicOff size={16} />
                <span className='text-sm font-medium'>{isMuting ? 'Muting...' : 'Mute All'}</span>
              </button>
            )}
            {!hideInvite && (
              <button
                onClick={() => setShowInviteModal(true)}
                className='flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background hover:bg-muted text-foreground border border-input transition-colors'
                title='Add People'
                data-testid='add-people-button'
                data-track-category='CALLS'
                data-track-name='ADD_PEOPLE_TO_CALL'
                data-track-metadata={JSON.stringify({ callId })}
              >
                <UserPlus size={16} />
                <span className='text-sm font-medium'>Add People</span>
              </button>
            )}
            <button
              onClick={onClose}
              className='p-1 hover:bg-muted rounded-full transition-colors'
              title='Close'
              data-track-category='CALLS'
              data-track-name='Close_Participants_Sidebar'
            >
              <X size={20} className='text-muted-foreground' />
            </button>
          </div>
        </div>

        {/* Participants List */}
        <div className='flex-1 overflow-y-auto p-3 space-y-3'>
          {/* Requested Section — participants waiting for approval (host or any attendee) */}
          {canActOnLobbyRequests && requested.length > 0 && (
            <div
              className='border border-orange-200 rounded-lg overflow-hidden bg-orange-50/30'
              data-testid='requested-section'
            >
              <SectionHeader
                title='Requested'
                count={requested.length}
                isExpanded={isRequestedExpanded}
                onToggle={() => setIsRequestedExpanded(!isRequestedExpanded)}
              />
              {isRequestedExpanded && (
                <div className='border-t border-orange-200'>
                  {requested.map(participant => (
                    <RequestedParticipantItem
                      key={participant.id}
                      participant={participant}
                      canActOnRequest={canActOnLobbyRequests}
                      approvingId={approvingId}
                      rejectingId={rejectingId}
                      onApprove={handleApprove}
                      onReject={handleReject}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Attendees Section */}
          {contributors.length > 0 && (
            <div
              className='border border-border rounded-lg overflow-hidden'
              data-testid='attendees-section'
            >
              <SectionHeader
                title='Attendees'
                count={contributors.length}
                isExpanded={isAttendeesExpanded}
                onToggle={() => setIsAttendeesExpanded(!isAttendeesExpanded)}
              />
              {isAttendeesExpanded && (
                <div className='border-t border-border'>
                  {contributors.map(participant => (
                    <ParticipantItem
                      key={participant.id}
                      participant={participant}
                      showMuteButton={isHost}
                      currentUserId={resolvedCurrentUserId}
                      isExternal={participant.isExternal ?? false}
                      callId={callId}
                      hostUserId={hostUserId}
                      raisedHands={raisedHands}
                      livekitParticipantMap={livekitParticipantMap}
                      mutingParticipantId={mutingParticipantId}
                      removingParticipantId={removingParticipantId}
                      onMuteParticipant={handleMuteParticipant}
                      onRemoveParticipant={handleRemoveParticipant}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Also Invited Section */}
          {alsoInvited.length > 0 && (
            <div
              className='border border-border rounded-lg overflow-hidden'
              data-testid='invited-section'
            >
              <SectionHeader
                title='Also invited'
                count={alsoInvited.length}
                isExpanded={isAlsoInvitedExpanded}
                onToggle={() => setIsAlsoInvitedExpanded(!isAlsoInvitedExpanded)}
              />
              {isAlsoInvitedExpanded && (
                <div className='border-t border-border'>
                  {alsoInvited.map(participant => (
                    <ParticipantItem
                      key={participant.id}
                      participant={participant}
                      currentUserId={resolvedCurrentUserId}
                      isExternal={participant.isExternal ?? false}
                      callId={callId}
                      hostUserId={hostUserId}
                      raisedHands={raisedHands}
                      livekitParticipantMap={livekitParticipantMap}
                      mutingParticipantId={mutingParticipantId}
                      removingParticipantId={removingParticipantId}
                      onMuteParticipant={handleMuteParticipant}
                      onRemoveParticipant={handleRemoveParticipant}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Empty State */}
          {participants.length === 0 && (
            <div className='flex flex-col items-center justify-center py-12 text-muted-foreground'>
              <Users size={48} className='mb-3 opacity-50' />
              <p className='text-sm'>No participants yet</p>
              <p className='text-xs mt-1'>Invite people to join this call</p>
            </div>
          )}
        </div>
      </div>

      {/* Invite Modal — only render when not hidden (needs ZeroProvider) */}
      {!hideInvite && (
        <InviteToCallModal
          isOpen={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          callId={callId}
        />
      )}
    </>
  );
}
