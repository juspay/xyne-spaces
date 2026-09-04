import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSelector } from '@xstate/react';
import { toast } from 'sonner';
import {
  CalendarDefault,
  ChevronLeft,
  CopyDefault,
  DownloadDown,
  ExternalLink,
  ChatDefault,
  Hashtag,
  Headphones,
  Lock02Close,
  MapPin,
  MultipleCrossCancelDefault,
  DeleteDustbin02,
  PencilEdit,
  SpeakerOn,
  Translate,
  VideoCallDefault,
  CopyCopied,
} from '@xyne/icons';
import { CallStatus, ChannelScopeType, ChannelVisibility, MeetingStatus } from '@xyne/shared';
import { useCachedQuery } from '@xyne/shared/hooks';
import { Button } from '../../ui/Button/Button';
import Avatar from '../../ui/Avatar/Avatar';
import { queries } from '../../../zero/queries';
import { useUser } from '../../../hooks/useUsers';
import { useNowWithBoundary } from '../../../hooks/useNowWithBoundary';
import { roomActor } from '../../../machines/roomMachine';
import { callService } from '../../../services/Call/callService';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { cn } from '../../../utils/classNames';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import { formatRelativeTime, formatTimeAmPm, formatTimeUntil } from '../../../utils/dateUtils';
import { GoogleCalendarIcon, MicrosoftIcon } from '../../../routes/CallHistoryScreen/CalendarIcons';
import {
  type Call,
  type CallParticipant,
  isGoogleCalendarCall,
  isMicrosoftCalendarCall,
  isScheduledCallJoinable,
  isScheduledCallManageable,
} from '../../../routes/CallHistoryScreen/callHistoryItem.utils';
import {
  didAttend,
  formatCallDuration,
  formatRecurrenceRule,
} from '../../../routes/CallHistoryScreen/CalenderViewUtils';
import type { XyneCalendarChannelPresentation } from './xyneCalendarSidebar.utils';

interface ExternalCalendarAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
}

interface CallDetailMetadata {
  htmlLink?: string;
  location?: string;
  conversationId?: string;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: ExternalCalendarAttendee[];
}

/** Fields present on the row but not surfaced by the `Call` list query type. */
type CallWithDetails = Call & {
  recurrenceRule?: string | null;
  recurringSeries?: { recurrenceRule?: string } | null;
  metadata?: CallDetailMetadata | null;
  organizerId?: string | null;
  roomLink?: string | null;
};

export interface CallDetailSidebarViewProps {
  call: Call;
  currentUserId?: string | undefined;
  /** Label for the back button — the day the timeline is showing, e.g. "Today". */
  dayLabel: string;
  channel?: XyneCalendarChannelPresentation | undefined;
  onBack: () => void;
  onClose: () => void;
  onJoinCall?: (() => void) | undefined;
  onOpenCallThread?: (() => void) | undefined;
  onDownloadTranscript?: (() => void) | undefined;
  onEditCall?: (() => void) | undefined;
  onDeleteCall?: (() => void) | undefined;
}

type RsvpChoice = MeetingStatus.ACCEPTED | MeetingStatus.DECLINED | MeetingStatus.MAYBE;

const SECTION_LABEL_CLASS = 'text-xs font-semibold uppercase tracking-wider text-muted-foreground';

function formatDetailDate(startsAt: number | string): string {
  return new Date(startsAt).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function getRsvpLabel(status: MeetingStatus): { label: string; className: string } {
  if (status === MeetingStatus.ACCEPTED) return { label: 'Yes', className: 'text-status-success' };
  if (status === MeetingStatus.MAYBE) return { label: 'Maybe', className: 'text-status-pending' };
  if (status === MeetingStatus.DECLINED || status === MeetingStatus.HIDDEN) {
    return { label: 'No', className: 'text-status-failure' };
  }
  return { label: 'Awaiting', className: 'text-muted-foreground' };
}

// ── Header ───────────────────────────────────────────────────────────────────

function CallDetailHeader({
  dayLabel,
  onBack,
  onEdit,
  onDelete,
  onClose,
}: {
  dayLabel: string;
  onBack: () => void;
  onEdit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onClose: () => void;
}): ReactElement {
  return (
    <header className='flex shrink-0 items-center gap-1 overflow-hidden py-3 pl-2 pr-3'>
      <Button
        variant='ghost'
        size='sm'
        onClick={onBack}
        title={`Back to ${dayLabel}`}
        aria-label={`Back to ${dayLabel}`}
        data-track-category='Calendar'
        data-track-name='CALL_DETAIL_BACK'
        className='h-7 min-w-0 gap-0.5 rounded-lg !pl-1 text-sm font-semibold text-foreground'
      >
        <ChevronLeft className='size-5' aria-hidden='true' />
        {dayLabel}
      </Button>

      <span className='min-w-0 flex-1' />

      {onEdit && (
        <Button
          variant='ghost'
          size='iconSm'
          title='Edit call'
          aria-label='Edit call'
          onClick={onEdit}
          data-track-category='Calendar'
          data-track-name='CALL_DETAIL_EDIT'
          className='size-7 rounded-lg text-muted-foreground'
        >
          <PencilEdit className='size-4' aria-hidden='true' />
        </Button>
      )}

      {onDelete && (
        <Button
          variant='ghost'
          size='iconSm'
          title='Delete call'
          aria-label='Delete call'
          onClick={onDelete}
          data-track-category='Calendar'
          data-track-name='CALL_DETAIL_DELETE'
          className='size-7 rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive'
        >
          <DeleteDustbin02 className='size-4' aria-hidden='true' />
        </Button>
      )}

      <Button
        variant='ghost'
        size='iconSm'
        title='Close'
        aria-label='Close Calendar sidebar'
        onClick={onClose}
        data-track-category='Calendar'
        data-track-name='CALL_DETAIL_CLOSE'
        className='size-7 rounded-lg text-muted-foreground'
      >
        <MultipleCrossCancelDefault className='size-4' strokeWidth={2} aria-hidden='true' />
      </Button>
    </header>
  );
}

// ── Creator line ─────────────────────────────────────────────────────────────

function CallCreatorLine({
  organizerUserId,
  externalOrganizerName,
  isCurrentUser,
  isLive,
}: {
  organizerUserId: string | undefined;
  externalOrganizerName: string | undefined;
  isCurrentUser: boolean;
  isLive: boolean;
}): ReactElement {
  const organizer = useUser(organizerUserId ?? '');
  const creatorName = isCurrentUser
    ? 'you'
    : (externalOrganizerName ?? organizer?.name ?? organizer?.email ?? 'someone');

  return (
    <div className='mb-2 flex h-4 items-center gap-2'>
      <span
        className={cn(
          'block size-2.5 flex-none rounded-sm border-2',
          isCurrentUser ? 'border-primary bg-primary' : 'border-primary',
        )}
        aria-hidden='true'
      />
      <span className='flex h-4 min-w-0 items-center truncate text-xs font-semibold uppercase leading-none tracking-normal text-muted-foreground pt-px'>
        Created by {creatorName}
      </span>
      {isLive && (
        <span className='flex h-4 shrink-0 items-center gap-1 text-xs font-semibold uppercase leading-none tracking-normal text-status-success'>
          <span className='block size-1.5 flex-none rounded-full bg-status-success motion-safe:animate-pulse' />
          Now
        </span>
      )}
    </div>
  );
}

// ── Participants ─────────────────────────────────────────────────────────────

function GuestUserInitial({ name }: { name: string }): ReactElement {
  const initial = name.trim().charAt(0).toUpperCase() || 'G';
  return (
    <div className='flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-sm font-semibold text-foreground/60'>
      {initial}
    </div>
  );
}

function CallParticipantRow({
  userId,
  displayName,
  email,
  isExternal,
  meetingStatus,
  roleLabel,
  attended,
}: {
  userId: string;
  displayName?: string | null;
  email?: string | null;
  isExternal?: boolean | null;
  meetingStatus: MeetingStatus;
  roleLabel: string;
  attended: boolean | null;
}): ReactElement {
  const user = useUser(isExternal ? '' : userId);
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();
  const { channelId } = useParams<{ channelId?: string }>();
  const participantName = isExternal ? (displayName ?? email ?? 'Guest') : (user?.name ?? '...');
  const rsvp = getRsvpLabel(meetingStatus);
  const status =
    attended === null
      ? rsvp
      : attended
        ? { label: 'Attended', className: 'text-status-success' }
        : { label: 'Didn’t attend', className: 'text-muted-foreground' };

  const canOpenProfile = !isExternal && !!channelId;

  const handleOpenProfile = (): void => {
    if (!canOpenProfile) return;
    void navigate(`${baseRoute}/${channelId}/profile/${userId}`);
  };

  return (
    <button
      type='button'
      className={cn(
        'flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50',
        canOpenProfile && 'cursor-pointer',
      )}
      onClick={canOpenProfile ? handleOpenProfile : undefined}
      onKeyDown={
        canOpenProfile
          ? event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleOpenProfile();
              }
            }
          : undefined
      }
      data-track-category='Calendar'
      data-track-name='CALL_DETAIL_PARTICIPANT_PROFILE'
    >
      {isExternal ? (
        <GuestUserInitial name={participantName} />
      ) : (
        <Avatar userId={userId} size='md' showActiveStatus={false} rounded />
      )}

      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='truncate text-sm font-semibold leading-tight text-foreground'>
          {participantName}
        </span>
        <span className='truncate text-xs leading-tight text-muted-foreground'>{roleLabel}</span>
      </div>

      <span className={cn('shrink-0 text-xs font-semibold', status.className)}>{status.label}</span>
    </button>
  );
}

function ExternalAttendeeRow({ attendee }: { attendee: ExternalCalendarAttendee }): ReactElement {
  const responseStatus = attendee.responseStatus;
  const statusLabel =
    responseStatus && responseStatus !== 'needsAction' ? responseStatus : 'Awaiting';
  const attendeeName = attendee.displayName ?? attendee.email ?? 'Guest';

  return (
    <li className='flex min-h-12 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50'>
      <GuestUserInitial name={attendeeName} />
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='truncate text-sm font-semibold leading-tight text-foreground'>
          {attendeeName}
        </span>
        <span className='truncate text-xs leading-tight text-muted-foreground'>
          {attendee.self ? 'You' : 'Invited'}
        </span>
      </div>
      <span className='shrink-0 text-xs font-semibold capitalize text-muted-foreground'>
        {statusLabel}
      </span>
    </li>
  );
}

// ── Where ────────────────────────────────────────────────────────────────────

function CallLocationSection({
  originLabel,
  originIcon,
  copyLink,
  externalLink,
  externalLinkLabel,
  channel,
  location,
}: {
  originLabel: string;
  originIcon: ReactElement;
  copyLink: string | null;
  externalLink: string | null;
  externalLinkLabel: string;
  channel: XyneCalendarChannelPresentation | undefined;
  location: string | undefined;
}): ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = (): void => {
    if (!copyLink) {
      return;
    }
    void copyTextToClipboard(copyLink)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        setCopied(false);
      });
  };

  return (
    <section className='mt-6'>
      <h2 className='text-xs font-semibold uppercase tracking-normal text-muted-foreground'>
        Where
      </h2>

      <div className='mt-2 flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3 shadow-sm'>
        <div className='flex items-center gap-2'>
          <span className='flex size-4 shrink-0 items-center justify-center text-muted-foreground'>
            {originIcon}
          </span>
          <span className='min-w-0 flex-1 truncate text-sm font-medium text-card-foreground'>
            {originLabel}
          </span>
          {copyLink && (
            <Button
              variant='outline'
              size='sm'
              onClick={handleCopyLink}
              data-track-category='Calendar'
              data-track-name='CALL_DETAIL_COPY_LINK'
              className='!w-24 h-7 shrink-0 rounded-lg border-border bg-background px-2.5 text-xs font-semibold text-foreground shadow-none hover:bg-muted'
            >
              <span className='relative flex size-3.5 shrink-0 items-center justify-center'>
                <CopyDefault
                  className={`absolute size-3.5 ${copied ? 'invisible' : 'visible'}`}
                  aria-hidden='true'
                />
                <CopyCopied
                  className={`absolute size-3.5 text-status-success ${copied ? 'visible' : 'invisible'}`}
                  aria-hidden='true'
                />
              </span>

              <span>{copied ? 'Copied!' : 'Copy link'}</span>
            </Button>
          )}
        </div>

        {channel && (
          <div className='flex min-w-0 items-start gap-2'>
            {channel.scopeType === ChannelScopeType.DM ||
            channel.scopeType === ChannelScopeType.GROUP_DM ? (
              <ChatDefault
                className='mt-0.5 size-4 shrink-0 text-muted-foreground'
                aria-hidden='true'
              />
            ) : channel.visibility === ChannelVisibility.PRIVATE ? (
              <Lock02Close
                className='mt-0.5 size-4 shrink-0 text-muted-foreground'
                aria-hidden='true'
              />
            ) : (
              <Hashtag
                className='mt-0.5 size-4 shrink-0 text-muted-foreground'
                aria-hidden='true'
              />
            )}
            <span className='min-w-0 flex-1 whitespace-normal break-words text-sm font-medium leading-relaxed text-muted-foreground'>
              {channel.label}
            </span>
          </div>
        )}

        {location && (
          <div className='flex min-w-0 items-start gap-2'>
            <MapPin className='mt-0.5 size-4 shrink-0 text-muted-foreground' aria-hidden='true' />
            <span className='min-w-0 flex-1 text-sm font-medium text-muted-foreground'>
              {location}
            </span>
          </div>
        )}
      </div>

      {externalLink && (
        <a
          href={externalLink}
          target='_blank'
          rel='noopener noreferrer'
          data-track-category='Calendar'
          data-track-name='CALL_DETAIL_OPEN_EXTERNAL'
          className='mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground'
        >
          <ExternalLink className='size-3.5' aria-hidden='true' />
          {externalLinkLabel}
        </a>
      )}
    </section>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

const CallDetailSidebarView = ({
  call,
  currentUserId,
  dayLabel,
  channel,
  onBack,
  onClose,
  onJoinCall,
  onOpenCallThread,
  onDownloadTranscript,
  onEditCall,
  onDeleteCall,
}: CallDetailSidebarViewProps): ReactElement => {
  const callDetails = call as CallWithDetails;

  const isGoogleCalendar = isGoogleCalendarCall(call);
  const isMicrosoftCalendar = isMicrosoftCalendarCall(call);
  const isExternalCalendar = isGoogleCalendar || isMicrosoftCalendar;
  const isEnded = call.status === CallStatus.ENDED;
  const isLive = call.status === CallStatus.ACTIVE || call.status === CallStatus.IN_PROGRESS;
  const isRecurring = !!call.recurringSeriesId;

  const startsAtTime = call.startsAt ? new Date(call.startsAt).getTime() : null;
  const startedAtTime = call.startedAt ? new Date(call.startedAt).getTime() : null;
  const now = useNowWithBoundary(
    startsAtTime,
    !isEnded && !isExternalCalendar && startsAtTime !== null,
  );
  const hasReachedScheduledStart = startsAtTime !== null && now >= startsAtTime;

  const currentCallExternalId = useSelector(roomActor, state => state.context.externalId);
  const isRoomActive = useSelector(
    roomActor,
    state => state.matches('joining') || state.matches('connecting') || state.matches('connected'),
  );

  const [seriesPrompt, setSeriesPrompt] = useState<RsvpChoice | null>(null);
  const [isSubmittingRsvp, setIsSubmittingRsvp] = useState(false);
  const [localRsvp, setLocalRsvp] = useState<MeetingStatus | null>(null);

  // The list queries only load the current user's participant row, so the full
  // guest list has to be fetched per call.
  const [participantRows] = useCachedQuery(queries.callParticipantsByCallId({ callId: call.id }), {
    enabled: !isExternalCalendar,
  });

  const organizerUserId = callDetails.organizerId ?? call.createdByUserId;
  const metadata = callDetails.metadata ?? null;

  const participants = useMemo<readonly CallParticipant[]>(() => {
    const rows = participantRows ?? call.participants ?? [];
    return [...rows].sort((first, second) => {
      if (first.userId === organizerUserId) return -1;
      if (second.userId === organizerUserId) return 1;
      if (first.userId === currentUserId) return -1;
      if (second.userId === currentUserId) return 1;
      return first.invitedAt - second.invitedAt;
    });
  }, [call.participants, currentUserId, organizerUserId, participantRows]);

  const currentParticipant = participants.find(participant => participant.userId === currentUserId);
  const currentMeetingStatus =
    localRsvp ?? currentParticipant?.meetingStatus ?? MeetingStatus.PENDING;

  const dateLabel = call.startsAt ? formatDetailDate(call.startsAt) : '';
  const timeLabel = call.startsAt
    ? call.endsAt
      ? `${formatTimeAmPm(call.startsAt)} – ${formatTimeAmPm(call.endsAt)}`
      : formatTimeAmPm(call.startsAt)
    : '';
  const recurrenceLabel = isRecurring
    ? formatRecurrenceRule(
        callDetails.recurrenceRule ?? callDetails.recurringSeries?.recurrenceRule,
      )
    : 'One-off';

  const isCurrentUserInCall = isRoomActive && currentCallExternalId === call.externalId;
  const isUnavailableUntilScheduledStart = !isScheduledCallJoinable(call, now);
  const isJoinDisabled = isCurrentUserInCall || isUnavailableUntilScheduledStart;
  const callDuration = isEnded ? formatCallDuration(call.startedAt, call.endedAt) : '';
  const startsInLabel =
    !isEnded && !isLive && startsAtTime !== null && now < startsAtTime
      ? formatTimeUntil(startsAtTime, now)
      : null;
  const liveStartedLabel =
    isLive && startedAtTime !== null ? formatRelativeTime(startedAtTime) : null;

  const submitRsvp = async (status: RsvpChoice, isSeries: boolean): Promise<void> => {
    if (startsAtTime !== null && Date.now() >= startsAtTime) {
      setSeriesPrompt(null);
      return;
    }

    setIsSubmittingRsvp(true);
    try {
      await callService.updateMeetingStatus(call.externalId, { status, isSeries });
      setLocalRsvp(status);
    } catch {
      toast.error('Failed to update RSVP');
    } finally {
      setIsSubmittingRsvp(false);
      setSeriesPrompt(null);
    }
  };

  const handleRsvpClick = (status: RsvpChoice): void => {
    if (status === currentMeetingStatus) return;
    if (isRecurring) {
      setSeriesPrompt(status);
      return;
    }
    void submitRsvp(status, false);
  };

  const externalAttendees = (metadata?.attendees ?? []).filter(
    attendee => !metadata?.organizer || attendee.email !== metadata.organizer.email,
  );
  const externalOrganizerName = isExternalCalendar
    ? (metadata?.organizer?.displayName ?? metadata?.organizer?.email ?? undefined)
    : undefined;
  const htmlLink = metadata?.htmlLink ?? null;
  const roomLink = callDetails.roomLink ?? null;
  const meetLink = roomLink && roomLink !== htmlLink ? roomLink : null;
  const isOrganizerCurrentUser = isExternalCalendar
    ? metadata?.organizer?.self === true || organizerUserId === currentUserId
    : organizerUserId === currentUserId;

  const canRsvp =
    !isExternalCalendar && !isEnded && !hasReachedScheduledStart && !!currentParticipant;
  const canJoin = !isExternalCalendar && !isEnded && !!onJoinCall && !!currentParticipant;
  const canDownloadTranscript =
    isEnded &&
    !!onDownloadTranscript &&
    (isOrganizerCurrentUser || currentParticipant !== undefined);
  const canManageScheduledCall =
    !isCurrentUserInCall && isScheduledCallManageable(call, currentUserId);

  return (
    <div className='flex h-full min-h-0 w-full flex-col'>
      <CallDetailHeader
        dayLabel={dayLabel}
        onBack={onBack}
        onEdit={canManageScheduledCall ? onEditCall : undefined}
        onDelete={canManageScheduledCall ? onDeleteCall : undefined}
        onClose={onClose}
      />

      <div className='shrink-0 px-4 pb-3 pt-1'>
        <CallCreatorLine
          organizerUserId={organizerUserId}
          externalOrganizerName={externalOrganizerName}
          isCurrentUser={isOrganizerCurrentUser}
          isLive={isLive}
        />

        <h1 className='text-xl font-semibold leading-snug tracking-tight text-foreground'>
          {call.title ?? 'Call'}
        </h1>

        <div className='mt-1 flex flex-col text-xs leading-relaxed text-muted-foreground'>
          {(dateLabel || timeLabel) && (
            <p>
              {dateLabel}
              {dateLabel && timeLabel && ' · '}
              {timeLabel}
            </p>
          )}
          <div className='flex flex-wrap items-center gap-x-2'>
            <span>{recurrenceLabel}</span>
            {isEnded && callDuration && (
              <span className='inline-flex items-center rounded-md bg-muted px-2 py-1 font-semibold leading-none text-muted-foreground'>
                Ended · lasted {callDuration}
              </span>
            )}
            {liveStartedLabel && (
              <span className='font-medium text-status-success'>
                Started {liveStartedLabel === 'Just now' ? 'just now' : liveStartedLabel}
              </span>
            )}
            {startsInLabel && (
              <span className='inline-flex items-center rounded-md bg-secondary px-2 py-1 font-semibold leading-none text-secondary-foreground'>
                Starts in {startsInLabel}
              </span>
            )}
          </div>
        </div>

        {/* ── Primary action ── */}
        {canJoin && (
          <Button
            onClick={onJoinCall}
            disabled={isJoinDisabled}
            data-track-category='Calendar'
            data-track-name='CALL_DETAIL_JOIN_CALL'
            className={cn(
              'mt-3 h-9 w-full rounded-lg text-sm font-semibold',
              isUnavailableUntilScheduledStart
                ? 'border border-border bg-background text-muted-foreground shadow-sm hover:bg-background disabled:bg-background disabled:text-muted-foreground disabled:opacity-100 font-medium select-none text-xs'
                : 'bg-foreground text-background hover:bg-foreground/90 disabled:bg-muted disabled:text-muted-foreground',
            )}
          >
            {isCurrentUserInCall ? (
              <SpeakerOn className='size-4' strokeWidth={2} aria-hidden='true' />
            ) : isUnavailableUntilScheduledStart ? (
              <CalendarDefault className='size-4' strokeWidth={2} aria-hidden='true' />
            ) : (
              <Headphones className='size-4' strokeWidth={2} aria-hidden='true' />
            )}
            {isCurrentUserInCall
              ? 'Already joined'
              : isUnavailableUntilScheduledStart
                ? 'Available at scheduled time'
                : isLive
                  ? 'Join call — in progress'
                  : 'Join call'}
          </Button>
        )}

        {isExternalCalendar && meetLink && (
          <a
            href={meetLink}
            target='_blank'
            rel='noopener noreferrer'
            data-track-category='Calendar'
            data-track-name='CALL_DETAIL_JOIN_EXTERNAL'
            className='mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-foreground text-sm font-semibold text-background hover:bg-foreground/90'
          >
            <VideoCallDefault className='size-4' aria-hidden='true' />
            Join call
          </a>
        )}

        {/* ── Ended call resources ── */}
        {isEnded && onOpenCallThread && (
          <Button
            onClick={onOpenCallThread}
            data-track-category='Calendar'
            data-track-name='CALL_DETAIL_OPEN_CALL_THREAD'
            className='mt-4 h-8 w-full rounded-lg bg-foreground text-xs font-semibold text-background hover:bg-foreground/90'
          >
            <Translate className='size-4' aria-hidden='true' />
            View summary &amp; transcript
          </Button>
        )}

        {canDownloadTranscript && (
          <Button
            variant='outline'
            onClick={onDownloadTranscript}
            data-track-category='Calendar'
            data-track-name='CALL_DETAIL_DOWNLOAD_TRANSCRIPT'
            className='mt-2 h-8 w-full rounded-lg text-xs font-medium'
          >
            <DownloadDown className='size-3.5' aria-hidden='true' />
            Download transcript
          </Button>
        )}

        {/* ── RSVP ── */}
        {canRsvp && (
          <section className='mt-4 rounded-xl border border-border bg-card px-3 py-3 shadow-sm'>
            <h2 className='text-sm font-semibold text-card-foreground'>You&apos;re going</h2>
            <div className='mt-2 flex gap-1.5'>
              <RsvpButton
                label='Yes'
                isSelected={currentMeetingStatus === MeetingStatus.ACCEPTED}
                isDisabled={isSubmittingRsvp}
                onClick={() => handleRsvpClick(MeetingStatus.ACCEPTED)}
                trackName='CALL_DETAIL_RSVP_YES'
              />
              <RsvpButton
                label='Maybe'
                isSelected={currentMeetingStatus === MeetingStatus.MAYBE}
                isDisabled={isSubmittingRsvp}
                onClick={() => handleRsvpClick(MeetingStatus.MAYBE)}
                trackName='CALL_DETAIL_RSVP_MAYBE'
              />
              <RsvpButton
                label='No'
                isSelected={currentMeetingStatus === MeetingStatus.DECLINED}
                isDisabled={isSubmittingRsvp}
                onClick={() => handleRsvpClick(MeetingStatus.DECLINED)}
                trackName='CALL_DETAIL_RSVP_NO'
              />
            </div>

            {seriesPrompt !== null && (
              <div className='mt-3 border-t border-border pt-3'>
                <p className='text-xs text-muted-foreground'>
                  This call repeats. Respond to just this one or all future calls?
                </p>
                <div className='mt-2 flex gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={isSubmittingRsvp}
                    onClick={() => void submitRsvp(seriesPrompt, false)}
                    data-track-category='Calendar'
                    data-track-name='CALL_DETAIL_RSVP_THIS_CALL'
                    className='h-8 flex-1 rounded-lg text-xs'
                  >
                    This call
                  </Button>
                  <Button
                    size='sm'
                    disabled={isSubmittingRsvp}
                    onClick={() => void submitRsvp(seriesPrompt, true)}
                    data-track-category='Calendar'
                    data-track-name='CALL_DETAIL_RSVP_ALL_CALLS'
                    className='h-8 flex-1 rounded-lg text-xs'
                  >
                    All calls
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Participants heading — stays put; the list below scrolls on its own ── */}
        {(participants.length > 0 || externalAttendees.length > 0) && (
          <div className='mt-6 flex items-baseline gap-2'>
            <h2 className={SECTION_LABEL_CLASS}>Participants</h2>
            <span className='text-xs text-muted-foreground'>
              {isExternalCalendar ? externalAttendees.length : participants.length} invited
            </span>
          </div>
        )}
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto px-4 pb-4'>
        {(participants.length > 0 || externalAttendees.length > 0) && (
          <ul className='mt-2 flex flex-col gap-1'>
            {isExternalCalendar
              ? externalAttendees.map((attendee, index) => (
                  <ExternalAttendeeRow
                    key={attendee.email ?? `attendee-${index}`}
                    attendee={attendee}
                  />
                ))
              : participants.map(participant => (
                  <CallParticipantRow
                    key={participant.id}
                    userId={participant.userId}
                    displayName={participant.displayName}
                    email={participant.email}
                    isExternal={participant.isExternal}
                    meetingStatus={
                      participant.userId === currentUserId && localRsvp !== null
                        ? localRsvp
                        : (participant.meetingStatus ?? MeetingStatus.PENDING)
                    }
                    roleLabel={
                      participant.userId === organizerUserId
                        ? 'Organizer'
                        : participant.userId === currentUserId
                          ? 'You'
                          : participant.isExternal
                            ? 'External'
                            : 'Invited'
                    }
                    attended={isEnded ? didAttend(participant) : null}
                  />
                ))}
          </ul>
        )}
      </div>
      {/* ── Where ── */}
      <div className='shrink-0 px-4 pb-3'>
        <CallLocationSection
          originLabel={
            isGoogleCalendar
              ? 'Google Calendar'
              : isMicrosoftCalendar
                ? 'Microsoft Outlook'
                : 'Xyne call'
          }
          originIcon={
            isGoogleCalendar ? (
              <GoogleCalendarIcon size={14} />
            ) : isMicrosoftCalendar ? (
              <MicrosoftIcon size={14} />
            ) : (
              <VideoCallDefault className='size-4' aria-hidden='true' />
            )
          }
          copyLink={roomLink ?? htmlLink}
          externalLink={isExternalCalendar ? htmlLink : null}
          externalLinkLabel={
            isMicrosoftCalendar ? 'View in Microsoft Outlook' : 'View in Google Calendar'
          }
          channel={channel}
          location={metadata?.location}
        />
      </div>
    </div>
  );
};

function RsvpButton({
  label,
  isSelected,
  isDisabled,
  onClick,
  trackName,
}: {
  label: string;
  isSelected: boolean;
  isDisabled: boolean;
  onClick: () => void;
  trackName: string;
}): ReactElement {
  return (
    <Button
      variant='outline'
      size='sm'
      disabled={isDisabled}
      onClick={onClick}
      aria-pressed={isSelected}
      data-track-category='Calendar'
      data-track-name={trackName}
      className={cn(
        'h-8 min-w-0 flex-1 rounded-lg border-border bg-background px-2 text-xs font-semibold text-foreground shadow-none hover:bg-muted',
        isSelected &&
          'border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background',
      )}
    >
      {label}
    </Button>
  );
}

export default CallDetailSidebarView;
