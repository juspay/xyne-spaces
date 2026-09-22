import { useState, useMemo, useCallback, useRef } from 'react';
import { useSelector } from '@xstate/react';
import {
  X,
  UserPlus,
  Users,
  ChevronUp,
  ChevronDown,
  MicOff,
  UserX,
  Check,
  XIcon,
  Hand,
  Search,
  MoreVertical,
  ShieldCheck,
} from 'lucide-react';
import { useIsSpeaking } from '@livekit/components-react';
import type { Participant } from 'livekit-client';
import { roomActor, type ParticipantInfo } from '../../../machines/roomMachine';
import { useUser } from '../../../hooks/useUsers';
import { useAuth } from '../../../hooks/useAuth';
import { InvitationResponse, RingStatus, type CallParticipantMetadata } from '@xyne/shared';
import Avatar from '../../ui/Avatar/Avatar';
import { Popover } from '../../ui/Popover/Popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';

import { InviteToCallModal } from '../CallModals/InviteToCallModal';
import { AudioIndicator } from '../components/AudioIndicator';
import {
  HostControlsSection,
  useActiveHostRestrictionCount,
} from '../HostControlsSection/HostControlsSection';
import { AgentCard, type AgentControls } from './AgentCard';
import { callService } from '../../../services/Call/callService';
import { getUserDisplayName, isUserDeactivated } from '../../../utils/userDisplayName';
import { cn } from '../../../utils/classNames';
import { logger, Event } from '../../../utils/logger';
import { getRingStatusLabel, useIsBroadcastChannelCall } from '../ringStatus.utils';

function matchesSearch(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || name.toLowerCase().includes(q);
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
  /** Lets the local user lower their own hand from the raised-hands queue */
  onToggleHandRaise?: (() => void) | undefined;
  /** Talk-back / control for Xyne Automatic; omit where it isn't offered */
  agentControls?: AgentControls | undefined;
  /** Host display name, for the "only the host can…" notes */
  hostName?: string | null | undefined;
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
  ringStatus?: string | null | undefined;
}

interface ActiveCall {
  externalId: string;
  createdByUserId?: string;
  channelId?: string | null;
  callOrigin?: string | null;
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

function RowAudioStatus({
  livekitParticipant,
  isMuted,
}: {
  livekitParticipant: Participant | undefined;
  isMuted: boolean;
}): React.ReactElement | null {
  const isSpeaking = useIsSpeaking(livekitParticipant);
  return <AudioIndicator isMuted={isMuted} isSpeaking={!isMuted && isSpeaking} />;
}

function SectionHeader({
  title,
  count,
  isExpanded,
  onToggle,
}: {
  title: string;
  count: number | string;
  isExpanded: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      onClick={onToggle}
      className='flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/60'
      aria-expanded={isExpanded}
      data-track-category='CALLS'
      data-track-name='Toggle_Participants_Section'
      data-track-metadata={JSON.stringify({ section: title, isExpanded: !isExpanded })}
    >
      <span className='text-sm font-medium text-foreground'>{title}</span>
      <div className='flex items-center gap-3'>
        <span className='text-sm tabular-nums text-muted-foreground'>{count}</span>
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
  searchQuery: string;
  /** Channel broadcast calls never ring anyone, so invitees read "Invited". */
  isBroadcastChannelCall: boolean;
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
  searchQuery,
  isBroadcastChannelCall,
}: ParticipantItemProps): React.ReactElement | null {
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
  const isSelf = !!currentUserId && userId === currentUserId;
  const isHostRow = !!hostUserId && userId === hostUserId;

  // Names resolve per row (some via a user lookup), so search filters here.
  if (!matchesSearch(participantName, searchQuery)) {
    return null;
  }

  const statusLine = wasRemovedByHost ? (
    <span className='text-red-500'>Removed by host</span>
  ) : response === InvitationResponse.LEFT ? (
    'Left the call'
  ) : response === InvitationResponse.INVITED ? (
    // Neither external guests nor channel broadcast invitees are ever rung.
    isExternal || isBroadcastChannelCall ? (
      'Invited'
    ) : (
      <span className={participant.ringStatus === RingStatus.BUSY ? 'text-amber-600' : undefined}>
        {getRingStatusLabel(participant.ringStatus)}
      </span>
    )
  ) : response === InvitationResponse.MISSED ? (
    'No answer'
  ) : response === InvitationResponse.DECLINED ? (
    <span className='text-red-500'>Declined</span>
  ) : response === InvitationResponse.REQUESTED ? (
    <span className='text-orange-500'>Requesting to join</span>
  ) : isHostRow ? (
    'Meeting host'
  ) : null;

  return (
    <div
      className={cn(
        'group/row flex items-center gap-3 px-4 py-2 transition-colors',
        isRaised ? 'bg-amber-500/10' : 'hover:bg-muted/60',
      )}
    >
      {isExternal ? (
        <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-400 text-sm font-medium text-white'>
          {fallbackInitial}
        </div>
      ) : (
        <Avatar
          userId={userId}
          size='md'
          rounded
          showActiveStatus={false}
          className='flex-shrink-0'
        />
      )}
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-1.5'>
          <p
            className={cn(
              'truncate text-sm font-medium',
              isDeactivated || !isInCall ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {participantName}
            {isSelf && <span className='font-normal text-muted-foreground'> (You)</span>}
          </p>
          {isDeactivated && (
            <span className='inline-flex shrink-0 items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground'>
              Deactivated
            </span>
          )}
          {isExternal && (
            <span className='inline-flex shrink-0 items-center rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-medium text-orange-600 dark:text-orange-300'>
              Guest
            </span>
          )}
        </div>
        {statusLine && <p className='truncate text-xs text-muted-foreground'>{statusLine}</p>}
      </div>

      <div className='flex flex-shrink-0 items-center gap-1'>
        {isRaised && (
          <span
            className='flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white'
            title='Hand raised'
          >
            <Hand className='h-3 w-3' />
          </span>
        )}
        {isInCall &&
          (livekitParticipantObj ? (
            <RowAudioStatus
              livekitParticipant={livekitParticipantObj}
              isMuted={!isMicrophoneEnabled}
            />
          ) : (
            <AudioIndicator isMuted={!isMicrophoneEnabled} isSpeaking={false} />
          ))}

        {/* Host actions — tucked behind ⋮ like Meet, instead of always-on icons */}
        {canMute && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                className='flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted'
                aria-label={`More actions for ${participantName}`}
                title='More actions'
              >
                {isMutingThis || isRemovingThis ? (
                  <div className='h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent' />
                ) : (
                  <MoreVertical className='h-4 w-4' />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-52'>
              <DropdownMenuItem
                onClick={() => void onMuteParticipant(userId)}
                disabled={isMutingThis || !isMicrophoneEnabled}
                className='cursor-pointer gap-2.5'
                data-ph-capture-attribute-track-id='mute_participant'
                data-track-category='CALLS'
                data-track-name='MUTE_PARTICIPANT'
                data-track-metadata={JSON.stringify({ callId, participantUserId: userId })}
              >
                <MicOff className='h-4 w-4' />
                {!isMicrophoneEnabled ? `${participantName} is muted` : `Mute ${participantName}`}
              </DropdownMenuItem>
              {canRemove && (
                <DropdownMenuItem
                  onClick={() => void onRemoveParticipant(userId, participantName)}
                  disabled={isRemovingThis}
                  className='cursor-pointer gap-2.5 text-red-600 focus:text-red-600'
                  data-ph-capture-attribute-track-id='remove_participant'
                  data-track-category='CALLS'
                  data-track-name='REMOVE_PARTICIPANT'
                  data-track-metadata={JSON.stringify({ callId, participantUserId: userId })}
                >
                  <UserX className='h-4 w-4' />
                  Remove from call
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
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
  searchQuery: string;
}

// Inner component for requested participants — looks up user name via useUser
function RequestedParticipantItem({
  participant,
  canActOnRequest,
  approvingId,
  rejectingId,
  onApprove,
  onReject,
  searchQuery,
}: RequestedParticipantItemProps): React.ReactElement | null {
  const { userId, displayName, isExternal } = participant;
  const participantUser = useUser(!isExternal ? userId : '');
  const resolvedName = displayName || participantUser?.name || 'Guest';
  const initial = resolvedName.charAt(0).toUpperCase();

  if (!matchesSearch(resolvedName, searchQuery)) {
    return null;
  }

  return (
    <div className='flex items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/60'>
      <div className='relative'>
        <div className='flex items-center justify-center w-8 h-8 bg-orange-400 text-white text-xs font-semibold rounded-full'>
          {initial}
        </div>
      </div>
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-1.5'>
          <p className='text-sm font-medium text-foreground truncate'>{resolvedName}</p>
          {isExternal && (
            <span className='inline-flex shrink-0 items-center rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-medium text-orange-600 dark:text-orange-300'>
              Guest
            </span>
          )}
        </div>
        <p className='text-xs text-muted-foreground'>Wants to join</p>
      </div>
      {canActOnRequest && (
        <div className='flex items-center gap-1.5 shrink-0'>
          <button
            onClick={() => onApprove(participant.id)}
            disabled={approvingId === participant.id}
            className='inline-flex h-8 items-center justify-center gap-1 rounded-full bg-[#0b57d0] px-3 text-xs font-medium text-white transition-colors hover:bg-[#0a4ebb] disabled:cursor-not-allowed disabled:opacity-50'
            title='Admit'
            data-ph-capture-attribute-track-id='approve_lobby_request'
            data-track-category='CALLS'
            data-track-name='APPROVE_LOBBY_REQUEST'
          >
            {approvingId === participant.id ? (
              <div className='w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin' />
            ) : (
              <>
                <Check size={14} />
                Admit
              </>
            )}
          </button>
          <button
            onClick={() => onReject(participant.id)}
            disabled={rejectingId === participant.id}
            className='inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
            aria-label='Decline'
            title='Decline'
            data-ph-capture-attribute-track-id='reject_lobby_request'
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
  onToggleHandRaise,
  agentControls,
  hostName,
}: ParticipantsSidebarProps): React.ReactElement {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAttendeesExpanded, setIsAttendeesExpanded] = useState(true);
  const [isAlsoInvitedExpanded, setIsAlsoInvitedExpanded] = useState(true);
  const [isRequestedExpanded, setIsRequestedExpanded] = useState(true);
  const [isRaisedExpanded, setIsRaisedExpanded] = useState(true);
  const activeRestrictionCount = useActiveHostRestrictionCount();
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

  const isBroadcastChannelCall = useIsBroadcastChannelCall(
    currentCall?.channelId,
    currentCall?.callOrigin,
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

  const sectionCardClass = 'overflow-hidden rounded-xl border border-border';
  const canMuteAll = isHost && contributors.length > 1;

  // Meet-style queue: people with a hand up, in the order they raised it.
  const raisedQueue = raisedHands
    .map(identity => contributors.find(p => p.userId === identity))
    .filter((p): p is CallParticipant => !!p);
  const isOwnHandRaised = !!resolvedCurrentUserId && raisedHands.includes(resolvedCurrentUserId);

  // Props every participant row shares, whichever section it's listed in.
  const participantItemProps = {
    isBroadcastChannelCall,
    showMuteButton: isHost,
    currentUserId: resolvedCurrentUserId,
    callId,
    hostUserId,
    raisedHands,
    livekitParticipantMap,
    mutingParticipantId,
    removingParticipantId,
    onMuteParticipant: handleMuteParticipant,
    onRemoveParticipant: handleRemoveParticipant,
    searchQuery,
  };

  return (
    <>
      <div className='flex h-full flex-col bg-background text-foreground'>
        {/* Header */}
        <div className='flex items-center justify-between py-3 pl-6 pr-3'>
          <h2 className='text-lg font-medium'>People</h2>
          <div className='flex items-center gap-1'>
            {/* Host controls — a popover off the header, so it's one click away no
                matter how long the list gets and never pushes the list down. */}
            {isHost && (
              <Popover
                side='bottom'
                align='end'
                sideOffset={6}
                collisionPadding={12}
                className='z-[80] w-80 overflow-hidden rounded-2xl border border-border bg-background p-0 text-foreground shadow-2xl'
                trigger={
                  <button
                    type='button'
                    className={cn(
                      'relative flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-muted data-[state=open]:bg-muted',
                      activeRestrictionCount > 0
                        ? 'text-[#0b57d0] dark:text-[#a8c7fa]'
                        : 'text-muted-foreground',
                    )}
                    title='Host controls'
                    aria-label={
                      activeRestrictionCount > 0
                        ? `Host controls — ${activeRestrictionCount} restricted`
                        : 'Host controls'
                    }
                    data-testid='host-controls-button'
                    data-track-event='BUTTON_CLICK'
                    data-track-category='CALLS'
                    data-track-name='TOGGLE_HOST_CONTROLS'
                  >
                    <ShieldCheck size={20} />
                    {activeRestrictionCount > 0 && (
                      <span className='absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#0b57d0] ring-2 ring-background dark:bg-[#a8c7fa]' />
                    )}
                  </button>
                }
              >
                <div data-testid='host-controls-section'>
                  <div className='px-4 pb-1 pt-4'>
                    <p className='text-sm font-medium'>Host controls</p>
                  </div>
                  <HostControlsSection callId={callId} />
                </div>
              </Popover>
            )}
            <button
              type='button'
              onClick={onClose}
              className='flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-muted'
              title='Close'
              aria-label='Close people panel'
              data-track-category='CALLS'
              data-track-name='Close_Participants_Sidebar'
            >
              <X size={20} className='text-muted-foreground' />
            </button>
          </div>
        </div>

        <div className='space-y-3 px-4 pb-3'>
          {/* Primary actions, side by side above search */}
          {(!hideInvite || canMuteAll) && (
            <div className='flex items-center gap-2'>
              {!hideInvite && (
                <button
                  type='button'
                  onClick={() => setShowInviteModal(true)}
                  className='flex h-9 items-center gap-2 rounded-full bg-[#0b57d0] pl-3 pr-4 text-sm font-medium text-white transition-colors hover:bg-[#0a4ebb] dark:bg-[#a8c7fa] dark:text-[#062e6f] dark:hover:bg-[#bcd4fb]'
                  title='Add people'
                  data-testid='add-people-button'
                  data-track-category='CALLS'
                  data-track-name='ADD_PEOPLE_TO_CALL'
                  data-track-metadata={JSON.stringify({ callId })}
                >
                  <UserPlus size={16} />
                  Add people
                </button>
              )}
              {canMuteAll && (
                <button
                  type='button'
                  onClick={() => void handleMuteAll()}
                  disabled={isMuting}
                  className='flex h-9 items-center gap-2 rounded-full border border-border pl-3 pr-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
                  title='Mute everyone except you'
                  data-testid='mute-all-button'
                  data-ph-capture-attribute-track-id='mute_all_participants'
                  data-track-category='CALLS'
                  data-track-name='MUTE_ALL_PARTICIPANTS'
                  data-track-metadata={JSON.stringify({ callId })}
                >
                  <MicOff size={16} />
                  {isMuting ? 'Muting…' : 'Mute all'}
                </button>
              )}
            </div>
          )}

          <label className='flex items-center gap-2 rounded-lg border border-border px-3 py-2 focus-within:border-[#0b57d0] focus-within:ring-1 focus-within:ring-[#0b57d0] dark:focus-within:border-[#a8c7fa] dark:focus-within:ring-[#a8c7fa]'>
            <Search size={18} className='flex-shrink-0 text-muted-foreground' />
            <input
              type='text'
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder='Search for people'
              aria-label='Search for people'
              data-track-category='CALLS'
              data-track-name='SEARCH_CALL_PARTICIPANTS'
              className='min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground'
            />
            {searchQuery && (
              <button
                type='button'
                onClick={() => setSearchQuery('')}
                className='text-muted-foreground hover:text-foreground'
                aria-label='Clear search'
                data-track-category='CALLS'
                data-track-name='CLEAR_CALL_PARTICIPANT_SEARCH'
              >
                <X size={16} />
              </button>
            )}
          </label>
        </div>

        {/* Participants List */}
        <div className='flex-1 space-y-3 overflow-y-auto px-4 pb-4' data-testid='participants-list'>
          {!searchQuery && (
            <AgentCard
              callId={callId}
              isHost={isHost}
              hostName={hostName}
              agentControls={agentControls}
            />
          )}

          {/* Requested Section — participants waiting for approval (host or any attendee) */}
          {canActOnLobbyRequests && requested.length > 0 && (
            <div
              className='overflow-hidden rounded-xl border border-orange-500/30 bg-orange-500/5'
              data-testid='requested-section'
            >
              <SectionHeader
                title='Waiting to join'
                count={requested.length}
                isExpanded={isRequestedExpanded}
                onToggle={() => setIsRequestedExpanded(!isRequestedExpanded)}
              />
              {isRequestedExpanded && (
                <div className='pb-1'>
                  {requested.map(participant => (
                    <RequestedParticipantItem
                      key={participant.id}
                      participant={participant}
                      canActOnRequest={canActOnLobbyRequests}
                      approvingId={approvingId}
                      rejectingId={rejectingId}
                      onApprove={handleApprove}
                      onReject={handleReject}
                      searchQuery={searchQuery}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Raised hands — Meet's queue, oldest first */}
          {raisedQueue.length > 0 && (
            <div
              className='overflow-hidden rounded-xl border border-amber-500/30 bg-amber-500/5'
              data-testid='raised-hands-section'
            >
              <SectionHeader
                title='Raised hands'
                count={raisedQueue.length}
                isExpanded={isRaisedExpanded}
                onToggle={() => setIsRaisedExpanded(!isRaisedExpanded)}
              />
              {isRaisedExpanded && (
                <div className='pb-1'>
                  {raisedQueue.map(participant => (
                    <ParticipantItem
                      key={`raised-${participant.id}`}
                      participant={participant}
                      isExternal={participant.isExternal ?? false}
                      {...participantItemProps}
                    />
                  ))}
                  {isOwnHandRaised && onToggleHandRaise && (
                    <div className='px-4 pb-2 pt-1'>
                      <button
                        type='button'
                        onClick={onToggleHandRaise}
                        className='rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted'
                        data-track-category='CALLS'
                        data-track-name='TOGGLE_HAND_RAISE'
                        data-track-metadata={JSON.stringify({
                          raised: false,
                          source: 'people_panel',
                        })}
                      >
                        Lower my hand
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Attendees Section */}
          {contributors.length > 0 && (
            <div className={sectionCardClass} data-testid='attendees-section'>
              <SectionHeader
                title='Contributors'
                count={contributors.length}
                isExpanded={isAttendeesExpanded}
                onToggle={() => setIsAttendeesExpanded(!isAttendeesExpanded)}
              />
              {isAttendeesExpanded && (
                <div className='pb-1'>
                  {contributors.map(participant => (
                    <ParticipantItem
                      key={participant.id}
                      participant={participant}
                      isExternal={participant.isExternal ?? false}
                      {...participantItemProps}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Also Invited Section */}
          {alsoInvited.length > 0 && (
            <div className={sectionCardClass} data-testid='invited-section'>
              <SectionHeader
                title='Also invited'
                count={alsoInvited.length}
                isExpanded={isAlsoInvitedExpanded}
                onToggle={() => setIsAlsoInvitedExpanded(!isAlsoInvitedExpanded)}
              />
              {isAlsoInvitedExpanded && (
                <div className='pb-1'>
                  {alsoInvited.map(participant => (
                    <ParticipantItem
                      key={participant.id}
                      participant={participant}
                      isExternal={participant.isExternal ?? false}
                      {...participantItemProps}
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
              <p className='mt-1 text-xs'>Invite people to join this call</p>
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
