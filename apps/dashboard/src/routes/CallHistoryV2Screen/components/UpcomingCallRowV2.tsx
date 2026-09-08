import { format } from 'date-fns';
import { useMemo, useState } from 'react';
import { useSelector } from '@xstate/react';
import { LinkChainSlant, ThreeDotsMenuHorizontal, CheckTickDouble } from '@xyne/icons';
import { Pencil, Trash2 } from 'lucide-react';
import { CallStatus, InvitationResponse, type User } from '@xyne/shared';
import { toast } from 'sonner';
import { roomActor } from '../../../machines/roomMachine';
import { cn } from '../../../utils/classNames';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import {
  buildParticipantSummary,
  getParticipantDisplayData,
  getPreviewParticipantUsers,
  getCallParticipantCount,
  canEditScheduledCallParticipants,
  type Call,
} from '../../CallHistoryScreen/callHistoryItem.utils';
import { isDMChannel } from '../../../components/Chat/ChatDirectory/ChatDirectory.utils';
import { useAllChannels, useAllVisibleChannels } from '../../../hooks/useChannels';
import { formatParticipantText } from '../../../hooks/useCalls';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import Button from '../../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';

export interface UpcomingCallRowV2Props {
  call: Call;
  allUsers: User[];
  currentUserId?: string | undefined;
  onJoinCall: (call: Call) => void;
  onEditCall?: ((call: Call) => void) | undefined;
  onCancelCall?: ((call: Call) => void) | undefined;
}

export function UpcomingCallRowV2({
  call,
  allUsers,
  currentUserId,
  onJoinCall,
  onEditCall,
  onCancelCall,
}: UpcomingCallRowV2Props): React.JSX.Element {
  const userMap = useMemo(
    () => new Map(allUsers.map(u => [u.id, { id: u.id, name: getUserDisplayName(u) }])),
    [allUsers],
  );
  const allChannels = useAllChannels();
  const channel = allChannels.find(c => c.id === call.channelId);
  const channelName = channel && !isDMChannel(channel.scopeType) ? channel.name : undefined;

  const isOwner = currentUserId === call.createdByUserId;
  const visibleChannels = useAllVisibleChannels();
  const canEdit = isOwner || canEditScheduledCallParticipants(call, currentUserId, visibleChannels);

  const currentUserParticipant = call.participants?.find(p => p.userId === currentUserId);
  const isUserInvited = !!currentUserParticipant;
  const hasCurrentUserJoined = currentUserParticipant?.response === InvitationResponse.ACCEPTED;
  const currentCallId = useSelector(roomActor, state => state.context.externalId);
  const isUserInThisDevice = currentCallId === call.externalId;

  const isActive =
    call.status === CallStatus.ACTIVE ||
    call.status === CallStatus.IN_PROGRESS ||
    (call.status === CallStatus.SCHEDULED &&
      Boolean(call.startsAt) &&
      new Date(call.startsAt!).getTime() <= Date.now());
  const isEnded = call.status === CallStatus.ENDED;

  const previewParticipantUsers = getPreviewParticipantUsers(
    call.participantPreviewUserIds,
    allUsers,
    currentUserId,
  );
  const fallbackParticipantData = getParticipantDisplayData(
    call.participants,
    allUsers,
    currentUserId,
  );
  const previewUserIds =
    previewParticipantUsers.length > 0
      ? previewParticipantUsers.map(user => user.id)
      : fallbackParticipantData.userIds;
  const participantDisplayNames =
    previewParticipantUsers.length > 0
      ? previewParticipantUsers.map(user => user.name || user.email || 'Unknown')
      : fallbackParticipantData.displayNames;
  const participants = formatParticipantText(
    previewUserIds.map(userId => ({ userId })),
    userMap,
    getCallParticipantCount(call),
  );
  const otherParticipantCount = Math.max(
    getCallParticipantCount(call) - (currentUserParticipant ? 1 : 0),
    previewUserIds.length,
  );
  const participantSummary = buildParticipantSummary(
    participantDisplayNames,
    otherParticipantCount,
  );
  const title = call.title || participantSummary;
  const startedAtOrScheduled = call.startsAt || call.startedAt;
  const startTime = startedAtOrScheduled ? format(new Date(startedAtOrScheduled), 'h:mm a') : '';

  const [isCopied, setIsCopied] = useState(false);

  const handleCopyLink = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (!call.roomLink) {
      toast.error('No link available');
      return;
    }
    copyTextToClipboard(call.roomLink)
      .then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 1500);
      })
      .catch(() => toast.error('Failed to copy link'));
  };

  return (
    <div className='flex items-center gap-4 bg-background py-3 pl-5 pr-3.5'>
      <div className='w-16 shrink-0 whitespace-nowrap font-mono text-xs font-medium text-muted-foreground/80 tabular-nums'>
        {startTime}
      </div>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <p className='truncate text-sm font-semibold tracking-tight text-foreground'>{title}</p>
          {isActive && (
            <span className='inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/50 bg-primary/10 py-px pl-1 pr-1.5 text-[10px] font-bold text-status-failure uppercase'>
              <span className='size-1 shrink-0 animate-live-pulse rounded-full bg-status-failure' />
              now
            </span>
          )}
        </div>
        <p className='mt-0.5 truncate text-xs text-muted-foreground'>
          {participants}
          {channelName && ` · #${channelName}`}
        </p>
      </div>
      <div className='flex shrink-0 items-center gap-1'>
        <button
          type='button'
          onClick={handleCopyLink}
          data-track-category='CALLS'
          data-track-name='COPY_UPCOMING_CALL_LINK'
          aria-label='Copy call link'
          className={cn(
            'flex size-8 items-center justify-center rounded-lg border transition-colors',
            isCopied
              ? 'border-status-success/30 text-status-success'
              : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {isCopied ? (
            <CheckTickDouble className='size-4' />
          ) : (
            <LinkChainSlant className='size-4' />
          )}
        </button>
        {!isEnded && isUserInvited && (
          <Button
            onClick={e => {
              e.stopPropagation();
              onJoinCall(call);
            }}
            disabled={isUserInThisDevice}
            data-track-category='CALLS'
            data-track-name='JOIN_UPCOMING_CALL'
            className={cn(
              'h-8 shrink-0 rounded-lg px-3.5 py-0 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60',
              isActive
                ? 'bg-status-success text-background hover:bg-status-success/90'
                : 'border border-border bg-background text-foreground hover:bg-accent',
            )}
          >
            {isUserInThisDevice ? 'Joined' : hasCurrentUserJoined ? 'Switch' : 'Join'}
          </Button>
        )}
        {!isActive && ((canEdit && onEditCall) || (isOwner && onCancelCall)) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='outline'
                size='icon'
                className='size-8 shrink-0 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground'
                onClick={e => e.stopPropagation()}
                data-track-category='CALLS'
                data-track-name='upcoming-call-more-options'
                aria-label='More options'
              >
                <ThreeDotsMenuHorizontal className='size-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='rounded-xl p-1.5 w-44 shadow-sm'>
              {canEdit && onEditCall && (
                <DropdownMenuItem
                  onClick={e => {
                    e.stopPropagation();
                    onEditCall(call);
                  }}
                  data-track-category='CALLS'
                  data-track-name='EDIT_UPCOMING_CALL'
                  className='flex items-center gap-2 text-sm font-medium rounded-lg'
                >
                  <Pencil className='size-4' strokeWidth={2.2} />
                  Edit Call
                </DropdownMenuItem>
              )}
              {isOwner && onCancelCall && (
                <DropdownMenuItem
                  onClick={e => {
                    e.stopPropagation();
                    onCancelCall(call);
                  }}
                  data-track-category='CALLS'
                  data-track-name='CANCEL_UPCOMING_CALL'
                  className='flex items-center gap-2 text-sm font-medium text-destructive focus:text-destructive rounded-lg'
                >
                  <Trash2 className='size-4' strokeWidth={2.2} />
                  Delete Call
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
