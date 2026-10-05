import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from '@xstate/react';
import { ChevronRight } from '@xyne/icons';
import { Copy, Phone, X } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { CallStatus, type CallPreviewData } from '@xyne/shared';

import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useUser, useUsers } from '../../../hooks/useUsers';
import { useAuth } from '../../../hooks/useAuth';
import { useChannel } from '../../../hooks/useChannels';
import { useCallJoinOrInitiate } from '../../../hooks/useCallJoinOrInitiate';
import { useCallConfirmation } from '../../../hooks/useCallConfirmation';
import { useAutoJoinOnAccept, useCallJoinState } from '../../../hooks/useCallJoinState';
import {
  getActiveParticipants,
  getUserCallAccessLevel,
  isUserActiveInCall,
} from '../../../hooks/useCalls';
import { roomActor } from '../../../machines/roomMachine';
import { cn } from '../../../utils/classNames';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { formatElapsedTime } from '../../../utils/recordingUtils';
import { getPreviewParticipantEntries } from '../../../routes/CallHistoryScreen/callHistoryItem.utils';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import Tooltip from '../../ui/Tooltip/Tooltip';
import { CallJoinButton } from '../../Call/CallJoinButton/CallJoinButton';
import { CallConfirmationModal } from '../../Call/CallConfirmationModal';

interface CallLinkPreviewProps {
  metadata: CallPreviewData;
  onClose?: (() => void) | undefined;
}

/** The slice of a roomActor.activeCalls entry this card reads (typed loosely there). */
interface LiveCall {
  externalId: string;
  participants?: { userId: string; response: string; isExternal?: boolean | null }[];
}

interface StatusPresentation {
  label: string;
  /** Text colour; the dot takes it too via bg-current. */
  className: string;
  /** Pulses the dot for a call happening right now. */
  live?: boolean;
  /** Plain label, no dot: the call is over and the card is inert. */
  noDot?: boolean;
}

/** IN_PROGRESS folds into ACTIVE: both mean "happening now". */
const STATUS_PRESENTATION: Record<CallStatus, StatusPresentation> = {
  [CallStatus.ACTIVE]: { label: 'Live', className: 'text-status-success', live: true },
  [CallStatus.IN_PROGRESS]: { label: 'Live', className: 'text-status-success', live: true },
  [CallStatus.SCHEDULED]: { label: 'Scheduled', className: 'text-status-scheduled' },
  [CallStatus.ENDED]: { label: 'Ended', className: 'text-muted-foreground' },
  [CallStatus.CANCELLED]: {
    label: 'Cancelled',
    className: 'font-normal text-muted-foreground',
    noDot: true,
  },
};

/**
 * Unfurl card for a Xyne call link.
 *
 * Everything shown is read live via Zero; link_preview_md only carries the id. Until the row
 * arrives, or when calls-acl denies it, the card is a plain "Xyne call" link with no status.
 * A live call also shows who is in it and the same Join / Request to Join button as the
 * in-thread call message.
 */
const CallLinkPreviewComponent: React.FC<CallLinkPreviewProps> = ({ metadata, onClose }) => {
  const { url, externalId } = metadata;

  // Shared with the call detail screen; its extra relations go unread here.
  const [call] = useCachedQuery(queries.callByExternalId({ callId: externalId }));
  const creator = useUser(call?.createdByUserId ?? '');
  const creatorName = getUserDisplayName(creator);

  // Ad-hoc calls have no title; name them after the creator, like the schedule modal.
  const title =
    call?.title ||
    (creatorName !== 'Unknown' ? `${creatorName.split(' ')[0]}'s Call` : 'Xyne call');
  const isLive = call?.status === CallStatus.ACTIVE;
  // An ended call renders like the "shared a call" row (EntitySharePill): duration and a
  // chevron into the call's detail screen instead of a status label.
  const isEnded = call?.status === CallStatus.ENDED;
  // A cancelled call is inert: struck-through title, plain "Cancelled", nothing to join or open.
  const isCancelled = call?.status === CallStatus.CANCELLED;
  // A scheduled call shows its start time and a neutral Join in place of a status label.
  const isScheduled = call?.status === CallStatus.SCHEDULED;
  const presentation =
    call && !isEnded && !isScheduled ? STATUS_PRESENTATION[call.status] : undefined;
  const durationMs = isEnded && call.endedAt ? Math.max(0, call.endedAt - call.startedAt) : null;
  const startsAtLabel =
    isScheduled && call.startsAt ? format(new Date(call.startsAt), 'EEE h:mm a') : null;

  const navigate = useNavigate();
  const openDetail = (event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    void navigate(`/calls/${encodeURIComponent(externalId)}/detail`);
  };

  const { user } = useAuth();
  // A live call shows who is in the room right now, from roomActor.activeCalls (the full
  // participant list, kept live by GlobalCallOverlay). participantPreviewUserIds can't be
  // used for this: its hasJoined flags are only refreshed when the room finishes, not on
  // each LiveKit join, so mid-call they are all false.
  const activeCalls = useSelector(roomActor, state => state.context.activeCalls) as LiveCall[];
  const liveParticipants = isLive
    ? activeCalls.find(activeCall => activeCall.externalId === externalId)?.participants
    : undefined;

  // An ended call nobody but its owner joined reads "No one joined" in place of duration and
  // avatars. Checked with the viewer included (no currentUserId), so a call only they joined
  // still counts; the preview lists joiners first, so a joiner is never cut off by its limit.
  const noOneJoined =
    isEnded &&
    !getPreviewParticipantEntries(call.participantPreviewUserIds, undefined).some(
      entry => entry.hasJoined && entry.userId !== call.createdByUserId,
    );

  // Avatars only for calls that happened: live shows who is in the room, ended shows who
  // joined. Scheduled and cancelled calls show none — nobody has been in them yet. Everyone
  // is included, the owner and the viewer too, so the card reads the same for every viewer.
  const participantUserIds = useMemo(() => {
    if (liveParticipants) {
      return getActiveParticipants(liveParticipants)
        .filter(participant => !participant.isExternal)
        .map(participant => participant.userId);
    }
    if (!isEnded) return [];
    return getPreviewParticipantEntries(call?.participantPreviewUserIds, undefined)
      .filter(entry => entry.hasJoined)
      .map(entry => entry.userId);
  }, [liveParticipants, call?.participantPreviewUserIds, isEnded]);

  // Every shown participant by full name, including the ones folded into "+N":
  // "Mayank Bansal, Priya Nair and Arjun Menon".
  const allUsers = useUsers();
  const participantNames = useMemo(() => {
    const usersById = new Map(allUsers.map(u => [u.id, u]));
    const names = participantUserIds.map(id => getUserDisplayName(usersById.get(id)));
    return names.length > 1
      ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
      : (names[0] ?? '');
  }, [allUsers, participantUserIds]);

  // ── Join (mirrors CallMessageOverlay) ──
  const currentCallId = useSelector(roomActor, state => state.context.externalId);
  const isUserInThisDevice = currentCallId === externalId;
  const userIsActiveInCall = isUserActiveInCall(call?.participants ?? [], user?.id ?? '');

  useAutoJoinOnAccept({ callId: externalId, userId: user?.id, isUserInCall: isUserInThisDevice });
  const { action, requestToJoin, cancelJoinRequest, isRequesting, isCancellingRequest } =
    useCallJoinState(externalId, user?.id);

  const channel = useChannel(call?.channelId ?? '');
  const { joinCall, isInCall } = useCallJoinOrInitiate();
  const { showConfirmModal, modalContent, handleCallAction, handleConfirmCall, closeModal } =
    useCallConfirmation({
      scopeType: channel?.scopeType,
      channelName: channel?.name,
      hasActiveCallInChannel: false,
      isUserInCurrentChannelCall: false,
      isInCall,
      onlyShowSwitchModal: true,
    });

  const joinThisCall = (): void => joinCall({ callId: externalId });
  // useCallJoinState only sees ACTIVE calls (roomActor.activeCalls), so a scheduled call's
  // access comes from the viewer's own participant row on this query instead. Request to
  // Join is live-only; an uninvited viewer still has the "Join call" chip in the message.
  const isScheduledInvitee =
    call?.status === CallStatus.SCHEDULED &&
    getUserCallAccessLevel(call.participants, user?.id) === 'canJoin';
  const showJoin = (isLive || isScheduledInvitee) && !isUserInThisDevice;

  const handleClose = (event: React.MouseEvent): void => {
    event.stopPropagation();
    onClose?.();
  };

  const handleCopy = (event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success('Link copied to clipboard'))
      .catch(() => toast.error('Failed to copy link'));
  };

  // Copy + close float over the card's top-right corner and appear on hover (or keyboard
  // focus). Closing is local: the bubble then shows the link chip again (MessageBubble's
  // callLinkCardShown).
  const rowActions = (
    <div className='absolute -right-2 -top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover/call-card:opacity-100 group-focus-within/call-card:opacity-100'>
      <button
        type='button'
        className='call-link-preview__copy-button rounded-full border border-border bg-card p-0.5 shadow-sm hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring'
        onClick={handleCopy}
        aria-label='Copy call link'
        title='Copy call link'
        data-track-category='MESSAGE'
        data-track-name='COPY_CALL_LINK_PREVIEW'
      >
        <Copy size={12} className='text-muted-foreground' />
      </button>
      {onClose && (
        <button
          type='button'
          className='call-link-preview__close-button rounded-full border border-border bg-card p-0.5 shadow-sm hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring'
          onClick={handleClose}
          aria-label='Close call preview'
          data-track-category='MESSAGE'
          data-track-name='CLOSE_CALL_LINK_PREVIEW'
        >
          <X size={12} className='text-muted-foreground' />
        </button>
      )}
    </div>
  );

  return (
    <>
      <div
        className='call-link-preview group/call-card relative flex w-full max-w-[520px] items-center gap-3 rounded-lg border border-border bg-card px-2 py-1 shadow-sm'
        aria-label={`Call preview: ${title}${presentation ? ` (${presentation.label})` : ''}`}
      >
        {/* Matches the "Join call" chip above. */}
        <span
          className='flex size-6 shrink-0 items-center justify-center rounded-md bg-muted'
          aria-hidden='true'
        >
          <Phone size={14} className='text-muted-foreground' />
        </span>

        {isCancelled ? (
          <span
            className='min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground line-through'
            title={title}
          >
            {title}
          </span>
        ) : isEnded ? (
          <button
            type='button'
            onClick={openDetail}
            className='min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:underline'
            title={title}
            data-track-category='MESSAGE'
            data-track-name='OPEN_ENDED_CALL_LINK_PREVIEW'
          >
            {title}
          </button>
        ) : (
          <a
            href={url}
            target='_blank'
            rel='noopener noreferrer'
            className='min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:underline'
            title={title}
            data-track-category='MESSAGE'
            data-track-name='OPEN_CALL_LINK_PREVIEW'
          >
            {title}
          </a>
        )}

        {startsAtLabel && (
          <span className='shrink-0 font-mono text-xs tabular-nums text-muted-foreground'>
            {startsAtLabel}
          </span>
        )}

        {noOneJoined ? (
          <span className='shrink-0 text-xs text-muted-foreground'>No one joined</span>
        ) : (
          durationMs !== null && (
            <span className='shrink-0 font-mono text-xs tabular-nums text-muted-foreground'>
              {formatElapsedTime(durationMs)}
            </span>
          )
        )}

        {presentation ? (
          <span
            className={cn(
              'flex shrink-0 items-center gap-1 text-xs font-medium',
              presentation.className,
            )}
          >
            {!presentation.noDot && (
              <span
                className={`h-1.5 w-1.5 rounded-full bg-current ${presentation.live ? 'animate-pulse' : ''}`}
                aria-hidden='true'
              />
            )}
            {presentation.label}
          </span>
        ) : null}

        {!noOneJoined && participantUserIds.length > 0 && (
          <Tooltip content={participantNames} side='top'>
            {/* Tooltip's trigger is asChild and needs a ref-able element. */}
            <span className='shrink-0'>
              <AvatarGroup userIds={participantUserIds} size='sm' count={3} shape='square' />
            </span>
          </Tooltip>
        )}

        {showJoin && (
          <CallJoinButton
            action={isLive ? action : 'canJoin'}
            onJoin={() => handleCallAction(joinThisCall)}
            onRequest={requestToJoin}
            onCancelRequest={cancelJoinRequest}
            isRequesting={isRequesting}
            isCancellingRequest={isCancellingRequest}
            variant='solid'
            className={cn(
              'call-join-pill shrink-0 bg-[#1cb454] px-2.5 py-0.5 text-xs font-semibold',
              // Not live yet: a neutral button, the green is kept for "happening now".
              isScheduled && 'bg-muted text-foreground hover:bg-accent hover:opacity-100',
            )}
            joinLabel={userIsActiveInCall ? 'Switch' : 'Join'}
            testId={
              action === 'canJoin'
                ? userIsActiveInCall
                  ? 'switch-call-button'
                  : 'join-button'
                : action === 'requested'
                  ? 'waiting-to-join-button'
                  : 'request-to-join-button'
            }
            trackCategory='CALLS'
            trackJoinName={
              userIsActiveInCall ? 'SWITCH_CALL_FROM_LINK_PREVIEW' : 'JOIN_CALL_FROM_LINK_PREVIEW'
            }
            trackRequestName='REQUEST_TO_JOIN_FROM_LINK_PREVIEW'
            trackMetadata={{ callId: externalId, isUserActiveInCall: userIsActiveInCall }}
          />
        )}

        {isEnded && (
          <button
            type='button'
            onClick={openDetail}
            className='shrink-0 rounded text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring'
            aria-label={`Open call ${title}`}
            data-track-category='MESSAGE'
            data-track-name='OPEN_ENDED_CALL_LINK_PREVIEW'
          >
            <ChevronRight size={16} strokeWidth={2.5} aria-hidden='true' />
          </button>
        )}

        {rowActions}
      </div>

      <CallConfirmationModal
        isOpen={showConfirmModal}
        onClose={closeModal}
        onConfirm={() => handleConfirmCall(joinThisCall)}
        title={modalContent.title}
        subtitle={modalContent.subtitle}
        description={modalContent.description}
      />
    </>
  );
};

export const CallLinkPreview = React.memo(CallLinkPreviewComponent);
export default CallLinkPreview;
