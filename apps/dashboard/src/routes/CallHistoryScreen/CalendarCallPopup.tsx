import { useMemo, useState } from 'react';
import {
  Download,
  MessageSquare,
  X,
  Check,
  HelpCircle,
  Headphones,
  Headset,
  ChevronDown,
  Users,
  Pencil,
  Trash2,
  ExternalLink,
  MapPin,
  Video,
  Clock,
  Satellite,
  Circle,
  AudioLines,
  CalendarFold,
  Loader2,
} from 'lucide-react';
import { RRule } from 'rrule';
import { useSelector } from '@xstate/react';
import { GoogleCalendarIcon, MicrosoftIcon } from './CalendarIcons';
import { CallStatus, MeetingStatus } from '@xyne/shared';
import {
  Call,
  getPreviewParticipantUserIds,
  isGoogleCalendarCall,
  isMicrosoftCalendarCall,
  canJoinCall,
  isScheduledCallManageable,
  canEditScheduledCallParticipants,
} from './callHistoryItem.utils';
import Button from '../../components/ui/Button';
import Avatar from '../../components/ui/Avatar/Avatar';
import { AvatarStackItem } from '../../components/ui/Avatar/AvatarGroup';
import { useUser } from '../../hooks/useUsers';
import { useAllVisibleChannels } from '../../hooks/useChannels';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { callService } from '../../services/Call/callService';
import { toast } from 'sonner';
import { cn } from '../../utils/classNames';
import { formatRelativeTime, formatTimeAmPm, formatTimeUntil } from '../../utils/dateUtils';
import {
  didAttend,
  formatCallDuration,
  MAX_AVATARS_TO_SHOW,
  RSVP_BADGE_BASE_CLASS,
} from './CalenderViewUtils';
import { roomActor } from '../../machines/roomMachine';
import { useNowWithBoundary } from '../../hooks/useNowWithBoundary';
import { queries } from '../../zero/queries';

interface CalendarCallPopupProps {
  call: Call;
  currentUserId?: string | undefined;
  onClose: () => void;
  onJoinCall?: () => void;
  onGotoMessage?: () => void;
  onDownloadTranscript?: () => void;
  onEditClick?: (() => void) | undefined;
  onDeleteClick?: (() => void) | undefined;
  onHideClick?: ((options?: { isSeries?: boolean }) => void) | undefined;
}

function formatPopupDate(startsAt: number | string): string {
  return new Date(startsAt).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Convert an RRULE string to a short human-readable label.
 * e.g. "FREQ=WEEKLY;BYDAY=TU" → "Every week on Tuesday"
 */
function formatRecurrenceRule(ruleStr: string | null | undefined): string {
  if (!ruleStr) return 'This call repeats on a schedule';
  try {
    // Strip the "RRULE:" prefix if present, then parse
    const cleaned = ruleStr.replace(/^RRULE:/i, '');
    const options = RRule.parseString(cleaned);
    const rule = new RRule(options);
    const text = rule.toText();
    return text.charAt(0).toUpperCase() + text.slice(1);
  } catch {
    return 'This call repeats on a schedule';
  }
}

// Small RSVP badge overlaid on the avatar bottom-right corner
function RsvpBadge({ status }: { status: MeetingStatus }): React.ReactElement | null {
  if (status === MeetingStatus.PENDING) return null;

  if (status === MeetingStatus.ACCEPTED) {
    return (
      <span className={cn(RSVP_BADGE_BASE_CLASS, 'bg-green-500')}>
        <Check className='size-2.5 text-white stroke-[3]' />
      </span>
    );
  }
  if (status === MeetingStatus.DECLINED || status === MeetingStatus.HIDDEN) {
    return (
      <span className={cn(RSVP_BADGE_BASE_CLASS, 'bg-red-500')}>
        <X className='size-2.5 text-white stroke-[3]' />
      </span>
    );
  }
  // MAYBE
  return (
    <span className={cn(RSVP_BADGE_BASE_CLASS, 'bg-amber-500')}>
      <HelpCircle className='size-2.5 text-white stroke-[3]' />
    </span>
  );
}

function ParticipantItem({
  userId,
  displayName,
  email,
  isExternal,
  meetingStatus,
  isOrganizer,
  didAttend,
}: {
  userId: string;
  displayName?: string | null;
  email?: string | null;
  isExternal?: boolean | null;
  meetingStatus: MeetingStatus;
  isOrganizer?: boolean;
  didAttend: boolean | null;
}): React.ReactElement {
  const user = useUser(userId);
  const participantName = isExternal ? displayName || email || 'Guest' : (user?.name ?? '...');

  // Determine role label
  const roleLabel = isOrganizer ? 'Organizer' : isExternal ? 'External' : 'Invited';
  const participantStatusLabel =
    didAttend === null ? roleLabel : `${roleLabel} · ${didAttend ? 'Attended' : 'Didn’t attend'}`;

  return (
    <div className='flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors'>
      <div className='relative shrink-0'>
        <AvatarStackItem size={30} className='rounded-md'>
          <Avatar userId={isExternal ? null : userId} size='rg' showActiveStatus={false} />
        </AvatarStackItem>
        <RsvpBadge status={meetingStatus} />
      </div>
      <div className='flex flex-col min-w-0 flex-1'>
        <span className='text-sm font-medium text-foreground truncate'>{participantName}</span>
        <span className='text-xs text-muted-foreground'>{participantStatusLabel}</span>
      </div>
    </div>
  );
}

type RsvpChoice = 'ACCEPTED' | 'DECLINED' | 'MAYBE';
const RSVP_CHOICE = {
  ACCEPTED: 'ACCEPTED' as RsvpChoice,
  DECLINED: 'DECLINED' as RsvpChoice,
  MAYBE: 'MAYBE' as RsvpChoice,
} as const;

const CalendarCallPopup = ({
  call,
  currentUserId,
  onClose,
  onJoinCall,
  onGotoMessage,
  onDownloadTranscript,
  onEditClick,
  onDeleteClick,
  onHideClick,
}: CalendarCallPopupProps): React.ReactElement => {
  const currentCallExternalId = useSelector(roomActor, state => state.context.externalId);
  const isRoomActive = useSelector(
    roomActor,
    state => state.matches('joining') || state.matches('connecting') || state.matches('connected'),
  );
  const isEnded = call.status === CallStatus.ENDED;
  const startsAtTime = call.startsAt ? new Date(call.startsAt).getTime() : null;
  const startedAtTime = call.startedAt ? new Date(call.startedAt).getTime() : null;
  const isLive = call.status === CallStatus.ACTIVE || call.status === CallStatus.IN_PROGRESS;
  const isRecurring = !!call.recurringSeriesId;
  const isGoogleCalendar = isGoogleCalendarCall(call);
  const isMicrosoftCalendar = isMicrosoftCalendarCall(call);
  const isExternalCalendar = isGoogleCalendar || isMicrosoftCalendar;
  const hasFullParticipants =
    call.status === CallStatus.ACTIVE ||
    (call.participantCount !== null &&
      call.participantCount !== undefined &&
      call.participantCount <= (call.participants?.length ?? 0));
  const [fullParticipants, fullParticipantsDetails] = useCachedQuery(
    queries.callParticipantsByCallId({ callId: call.id }),
    {
      enabled: !isExternalCalendar && !hasFullParticipants,
    },
  );

  const now = useNowWithBoundary(
    startsAtTime,
    !isEnded && !isExternalCalendar && startsAtTime !== null,
  );
  const hasReachedScheduledStart = startsAtTime !== null && now >= startsAtTime;

  const [seriesPrompt, setSeriesPrompt] = useState<RsvpChoice | null>(null);
  const [showHideSeriesPrompt, setShowHideSeriesPrompt] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [localRsvp, setLocalRsvp] = useState<MeetingStatus | null>(null);
  const [isGuestsExpanded, setIsGuestsExpanded] = useState(false);

  const allVisibleChannels = useAllVisibleChannels();
  const currentParticipant = call.participants?.find(p => p.userId === currentUserId);
  const isCurrentUserInCall = isRoomActive && currentCallExternalId === call.externalId;
  const previewParticipantUserIds = useMemo(
    () => getPreviewParticipantUserIds(call.participantPreviewUserIds, currentUserId),
    [call.participantPreviewUserIds, currentUserId],
  );
  const previewParticipants = useMemo(() => {
    const nextParticipants: Array<
      { userId: string } & Partial<NonNullable<Call['participants']>[number]>
    > = [];
    const seen = new Set<string>();

    for (const participant of call.participants ?? []) {
      if (participant.userId && !seen.has(participant.userId)) {
        nextParticipants.push(participant);
        seen.add(participant.userId);
      }
    }

    for (const userId of previewParticipantUserIds) {
      if (!seen.has(userId)) {
        nextParticipants.push({ userId });
        seen.add(userId);
      }
    }

    return nextParticipants;
  }, [call.participants, previewParticipantUserIds]);
  const participants = useMemo(() => {
    const merged = [...previewParticipants];
    const indicesByUserId = new Map(
      merged.map((participant, index) => [participant.userId, index] as const),
    );

    for (const participant of fullParticipants ?? []) {
      if (!participant.userId) continue;

      const existingIndex = indicesByUserId.get(participant.userId);
      if (existingIndex !== undefined) {
        merged[existingIndex] = {
          ...merged[existingIndex],
          ...participant,
        };
      } else {
        merged.push(participant);
        indicesByUserId.set(participant.userId, merged.length - 1);
      }
    }

    return merged;
  }, [fullParticipants, previewParticipants]);
  const hydratedCurrentParticipant =
    participants.find(p => p.userId === currentUserId) ?? currentParticipant;
  const currentMeetingStatus: MeetingStatus =
    localRsvp ?? hydratedCurrentParticipant?.meetingStatus ?? MeetingStatus.PENDING;

  const dateLabel = call.startsAt ? formatPopupDate(call.startsAt) : '';
  const timeLabel = call.startsAt
    ? call.endsAt
      ? `${formatTimeAmPm(call.startsAt)} - ${formatTimeAmPm(call.endsAt)}`
      : formatTimeAmPm(call.startsAt)
    : '';

  const callExtended = call as Call & {
    recurringSeries?: { recurrenceRule?: string };
    organizerId?: string;
    createdByUserId?: string;
    callOrigin?: string;
    roomLink?: string;
    metadata?: {
      htmlLink?: string;
      location?: string;
      organizer?: { email?: string; displayName?: string; self?: boolean };
      attendees?: Array<{
        email?: string;
        displayName?: string;
        responseStatus?: string;
        self?: boolean;
      }>;
    };
  };
  const recurrenceRule = callExtended.recurringSeries?.recurrenceRule;
  const recurrenceLabel = isRecurring ? formatRecurrenceRule(recurrenceRule) : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const organizerUserId: string | undefined =
    callExtended.organizerId ?? callExtended.createdByUserId;

  const submitRsvp = async (status: RsvpChoice, isSeries: boolean): Promise<void> => {
    if (startsAtTime !== null && Date.now() >= startsAtTime) {
      setSeriesPrompt(null);
      return;
    }

    setIsLoading(true);
    try {
      await callService.updateMeetingStatus(call.externalId, {
        status: status as MeetingStatus,
        isSeries,
      });
      setLocalRsvp(status as MeetingStatus);
    } catch {
      toast.error('Failed to update RSVP');
    } finally {
      setIsLoading(false);
      setSeriesPrompt(null);
    }
  };

  const handleRsvpClick = (status: RsvpChoice): void => {
    if ((status as MeetingStatus) === currentMeetingStatus) return;
    if (isRecurring) {
      setSeriesPrompt(status);
    } else {
      void submitRsvp(status, false);
    }
  };

  const handleHideClick = (): void => {
    if (isRecurring) {
      setShowHideSeriesPrompt(true);
    } else {
      onHideClick?.();
    }
  };

  // ── Google Calendar read-only view ───────────────────────────────────────
  if (isExternalCalendar) {
    const location = callExtended.metadata?.location;
    const htmlLink = callExtended.metadata?.htmlLink;
    const organizer = callExtended.metadata?.organizer;
    const gcalAttendees = (callExtended.metadata?.attendees ?? []).filter(
      a => !organizer || a.email !== organizer.email,
    );
    const roomLink = callExtended.roomLink;
    // A Meet link exists when roomLink is set and different from the plain calendar htmlLink
    const meetLink = roomLink && roomLink !== htmlLink ? roomLink : undefined;

    return (
      <div className='p-5'>
        {/* Header */}
        <div className='flex items-start justify-between gap-2 mb-2'>
          <h3 className='font-semibold text-base leading-snug text-foreground flex-1 min-w-0'>
            {call.title ?? 'Event'}
          </h3>
          <div className='flex items-center gap-1 shrink-0'>
            <span className='flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted border border-border rounded px-1.5 py-0.5'>
              {isMicrosoftCalendar ? (
                <>
                  <MicrosoftIcon size={12} />
                  <span>Microsoft Calendar</span>
                </>
              ) : (
                <>
                  <GoogleCalendarIcon size={12} />
                  <span>Google Calendar</span>
                </>
              )}
            </span>
            <button
              onClick={onClose}
              data-track-category='CALLS'
              data-track-name='calendar-popup-close'
              className='text-muted-foreground hover:text-foreground transition-colors p-0.5 cursor-pointer'
            >
              <X className='size-4' />
            </button>
          </div>
        </div>

        {/* Date & time */}
        {(dateLabel || timeLabel) && (
          <p className='text-sm text-muted-foreground mb-1'>
            {dateLabel}
            {dateLabel && timeLabel && ' • '}
            {timeLabel}
          </p>
        )}

        {/* Location */}
        {location && (
          <div className='flex items-start gap-1.5 mb-2'>
            <MapPin className='size-4 text-muted-foreground shrink-0 mt-0.5' />
            <p className='text-sm text-muted-foreground'>{location}</p>
          </div>
        )}

        {/* Organizer */}
        {organizer && (
          <div className='flex items-center gap-1.5 mt-2 mb-1'>
            <Users className='size-3.5 text-muted-foreground shrink-0' />
            <span className='text-[12px] text-muted-foreground truncate'>
              {organizer.displayName ?? organizer.email ?? 'Unknown'}
              {organizer.self && <span className='ml-1 text-[10px]'>(you)</span>}
              <span className='ml-1 text-[10px]'>· Organizer</span>
            </span>
          </div>
        )}

        {/* Attendees */}
        {gcalAttendees.length > 0 && (
          <div className='mt-3'>
            <div className='flex items-center gap-1.5 mb-2'>
              <Users className='size-3.5 text-muted-foreground' />
              <span className='text-sm font-medium text-foreground'>
                {gcalAttendees.length} Guest{gcalAttendees.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className='flex flex-col gap-1 max-h-32 overflow-y-auto'>
              {gcalAttendees.map((attendee, i) => (
                <div key={i} className='flex items-center gap-2'>
                  <span className='text-sm text-foreground truncate'>
                    {attendee.displayName ?? attendee.email ?? 'Unknown'}
                  </span>
                  {attendee.responseStatus && attendee.responseStatus !== 'needsAction' && (
                    <span className='text-[10px] text-muted-foreground shrink-0'>
                      · {attendee.responseStatus}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className='mt-4 flex items-center gap-2 flex-wrap'>
          {meetLink && (
            <a
              href={meetLink}
              target='_blank'
              rel='noopener noreferrer'
              className='flex items-center gap-2 text-sm font-semibold bg-action-primary text-action-primary-foreground rounded-lg px-4 py-2 hover:opacity-90 transition-opacity'
            >
              Join
            </a>
          )}
          {htmlLink && (
            <a
              href={htmlLink}
              target='_blank'
              rel='noopener noreferrer'
              className='flex items-center gap-2 text-sm text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors'
            >
              <ExternalLink className='size-3.5 shrink-0' />
              {isMicrosoftCalendar ? 'View in Microsoft Outlook' : 'View in Google Calendar'}
            </a>
          )}
        </div>
      </div>
    );
  }

  // ── Series scope confirmation sub-view ────────────────────────────────────
  if (seriesPrompt && !hasReachedScheduledStart) {
    return (
      <div className='p-5'>
        {/* Call icon */}
        <div className='mb-4'>
          <div className='size-12 rounded-xl bg-blue-100 flex items-center justify-center'>
            <Headphones className='size-6 text-blue-500' />
          </div>
        </div>

        {/* Title */}
        <h3 className='font-semibold text-foreground text-base mb-1'>Respond to recurring event</h3>

        {/* Description */}
        <p className='text-sm text-muted-foreground mb-5'>
          This call repeats. Respond to just this one or all future calls?
        </p>

        {/* Buttons — right-aligned */}
        <div className='flex justify-end gap-2'>
          <button
            disabled={isLoading}
            onClick={() => void submitRsvp(seriesPrompt, false)}
            data-track-category='CALLS'
            data-track-name='rsvp-this-call'
            className='text-sm px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors cursor-pointer disabled:opacity-50 text-foreground'
          >
            This Call
          </button>
          <button
            disabled={isLoading}
            onClick={() => void submitRsvp(seriesPrompt, true)}
            data-track-category='CALLS'
            data-track-name='rsvp-all-calls'
            className='text-sm px-4 py-2 rounded-lg bg-action-primary text-action-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50'
          >
            All Calls
          </button>
        </div>
      </div>
    );
  }

  // ── Hide series scope confirmation ───────────────────────────────────────
  if (showHideSeriesPrompt) {
    return (
      <div className='p-5'>
        <div className='mb-4'>
          <div className='size-12 rounded-xl bg-blue-100 flex items-center justify-center'>
            <Headphones className='size-6 text-blue-500' />
          </div>
        </div>
        <h3 className='font-semibold text-foreground text-base mb-1'>Hide recurring event</h3>
        <p className='text-sm text-muted-foreground mb-5'>
          This call repeats. Hide just this occurrence or all future calls?
        </p>
        <div className='flex justify-end gap-2'>
          <button
            onClick={() => {
              onHideClick?.();
              setShowHideSeriesPrompt(false);
            }}
            data-track-category='CALLS'
            data-track-name='hide-this-call'
            className='text-sm px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors cursor-pointer text-foreground'
          >
            This Call
          </button>
          <button
            onClick={() => {
              onHideClick?.({ isSeries: true });
              setShowHideSeriesPrompt(false);
            }}
            data-track-category='CALLS'
            data-track-name='hide-all-calls'
            className='text-sm px-4 py-2 rounded-lg bg-action-primary text-action-primary-foreground hover:opacity-90 transition-opacity cursor-pointer'
          >
            All Calls
          </button>
        </div>
      </div>
    );
  }

  // ── Main popup view ───────────────────────────────────────────────────────
  const statusParticipants = hasFullParticipants ? participants : (fullParticipants ?? []);
  const rsvpCounts = new Map<MeetingStatus, number>();
  for (const p of statusParticipants) {
    const status =
      p.userId === currentUserId && localRsvp !== null
        ? localRsvp
        : (p.meetingStatus ?? MeetingStatus.PENDING);
    rsvpCounts.set(status, (rsvpCounts.get(status) ?? 0) + 1);
  }
  const goingCount = rsvpCounts.get(MeetingStatus.ACCEPTED) ?? 0;
  const notGoingCount =
    (rsvpCounts.get(MeetingStatus.DECLINED) ?? 0) + (rsvpCounts.get(MeetingStatus.HIDDEN) ?? 0);
  const waitingCount = statusParticipants.length - goingCount - notGoingCount;
  const attendedCount = statusParticipants.filter(didAttend).length;

  const sortedParticipants = [...participants].sort((a, b) => {
    if (a.userId === organizerUserId) return -1;
    if (b.userId === organizerUserId) return 1;
    return 0;
  });

  const previewAvatarUserIds =
    previewParticipantUserIds.length > 0
      ? previewParticipantUserIds.slice(0, MAX_AVATARS_TO_SHOW)
      : sortedParticipants.slice(0, MAX_AVATARS_TO_SHOW).map(p => p.userId);
  const previewParticipantCount =
    call.participantCount ?? (call.participants?.length || previewParticipantUserIds.length);

  // Duration for ended calls
  const callDuration = isEnded ? formatCallDuration(call.startedAt, call.endedAt) : '';
  const startsInLabel =
    !isEnded && !isLive && startsAtTime !== null && now < startsAtTime
      ? formatTimeUntil(startsAtTime, now)
      : null;
  const liveStartedLabel =
    isLive && startedAtTime !== null ? formatRelativeTime(startedAtTime) : null;

  const isCallUnavailable = !canJoinCall(call);
  const isJoinDisabled = isCurrentUserInCall || isCallUnavailable;
  const shouldUsePrimaryJoinStyle = isLive;
  const isManageableScheduledCall = isScheduledCallManageable(call, currentUserId);

  // A non-organizer participant can still open the modal, restricted to adding people.
  const canEdit =
    (isManageableScheduledCall ||
      canEditScheduledCallParticipants(call, currentUserId, allVisibleChannels)) &&
    !!onEditClick;
  const canDelete = isManageableScheduledCall && !!onDeleteClick;
  const canHide =
    !isEnded && currentUserId !== organizerUserId && !!hydratedCurrentParticipant && !!onHideClick;
  const canGotoMessage = isEnded && !!onGotoMessage;
  const isLoadingParticipants = !isExternalCalendar && !hasFullParticipants;
  const showParticipantsLoading =
    isLoadingParticipants && fullParticipantsDetails.type !== 'complete';
  const hasLoadedParticipantStatuses = !showParticipantsLoading;

  const visibleHeaderActionCount =
    1 + [canEdit, canDelete, canHide, canGotoMessage].filter(Boolean).length;

  return (
    <div className='relative p-4'>
      {/* Actions anchored to the popover edge */}
      <div className='absolute top-4 right-4 flex items-center'>
        {canEdit && (
          <Button
            onClick={onEditClick}
            title='Edit call'
            aria-label='Edit call'
            variant='ghost'
            size='iconSm'
            data-track-category='CALLS'
            data-track-name='popup-edit-call'
            className='text-muted-foreground'
          >
            <Pencil className='size-4' />
          </Button>
        )}
        {canDelete && (
          <Button
            onClick={onDeleteClick}
            title='Delete call'
            aria-label='Delete call'
            variant='ghost'
            size='iconSm'
            data-track-category='CALLS'
            data-track-name='popup-delete-call'
            className='text-destructive hover:bg-destructive/10 hover:text-destructive'
          >
            <Trash2 className='size-4' />
          </Button>
        )}
        {canHide && (
          <Button
            onClick={handleHideClick}
            title='Hide call'
            aria-label='Hide call'
            variant='ghost'
            size='iconSm'
            data-track-category='CALLS'
            data-track-name='popup-hide-call'
            className='text-destructive hover:bg-destructive/10 hover:text-destructive'
          >
            <Trash2 className='size-4' />
          </Button>
        )}
        {canGotoMessage && (
          <Button
            onClick={onGotoMessage}
            title='Go to message'
            aria-label='Go to message'
            variant='ghost'
            size='iconSm'
            data-track-category='CALLS'
            data-track-name='popup-goto-message'
            className='text-muted-foreground'
          >
            <MessageSquare className='size-4' />
          </Button>
        )}
        <Button
          onClick={onClose}
          title='Close'
          aria-label='Close'
          variant='ghost'
          size='iconSm'
          data-track-category='CALLS'
          data-track-name='popup-close'
          className='text-muted-foreground'
        >
          <X className='size-4' />
        </Button>
      </div>

      {/* Header: video icon + title and status */}
      <div
        className={cn(
          'flex items-start gap-3',
          visibleHeaderActionCount === 1 && 'pr-8',
          visibleHeaderActionCount === 2 && 'pr-16',
          visibleHeaderActionCount >= 3 && 'pr-24',
        )}
      >
        {/* Video icon container */}
        <div className='size-12 rounded-xl bg-stage-completed flex items-center justify-center shrink-0'>
          <Video className='size-5 text-action-primary' />
        </div>

        {/* Title and status */}
        <div className='flex-1 min-w-0 pt-0.5'>
          <h3 className='no-scrollbar overflow-x-auto whitespace-nowrap font-semibold text-base leading-snug text-foreground'>
            {call.title ?? 'Call'}
          </h3>

          {/* Status badges */}
          {isLive && (
            <div className='inline-flex items-center gap-1.5 mt-0.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-destructive'>
              <Circle className='size-2.5 fill-current animate-pulse' />
              <span>
                <span className='font-mono'>LIVE</span>
                {liveStartedLabel && (
                  <> · started {liveStartedLabel === 'Just now' ? 'just now' : liveStartedLabel}</>
                )}
              </span>
            </div>
          )}
          {isEnded && (
            <span className='inline-flex items-center mt-0.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground'>
              Ended{callDuration ? ` · lasted ${callDuration}` : ''}
            </span>
          )}
          {startsInLabel && (
            <span className='inline-flex items-center gap-1 mt-0.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground'>
              <Clock className='size-3' />
              Starts in {startsInLabel}
            </span>
          )}
        </div>
      </div>

      {/* Date and time with clock icon */}
      {(dateLabel || timeLabel) && (
        <div className='flex items-center gap-2 mt-2 text-muted-foreground'>
          <Clock className='size-4 shrink-0' />
          <span className='text-sm'>
            {dateLabel}
            {dateLabel && timeLabel && ' · '}
            {timeLabel}
          </span>
        </div>
      )}

      {/* Recurrence label */}
      {recurrenceLabel && (
        <div className='mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--mention-current-user-bg)] px-3 py-1.5 text-xs font-medium text-status-pending'>
          <Satellite className='size-4 shrink-0' />
          <span>{recurrenceLabel}</span>
        </div>
      )}

      {/* Guests section - card style */}
      {(previewParticipantCount > 0 || showParticipantsLoading) && (
        <div className='mt-4 rounded-xl border border-border overflow-hidden'>
          {/* Collapsible header */}
          <button
            onClick={() => setIsGuestsExpanded(prev => !prev)}
            data-track-category='CALLS'
            data-track-name='toggle-guests-list'
            className='w-full flex items-center gap-3 px-3 py-3 cursor-pointer hover:bg-muted/50 transition-colors'
          >
            {/* Avatar stack using AvatarStackItem - rounded square style */}
            <div className='flex items-center -space-x-1.5'>
              {previewAvatarUserIds.map((userId, index) => (
                <AvatarStackItem
                  key={`${userId}-${index}`}
                  size={24}
                  className='rounded-md flex items-center justify-center ring-[1px] ring-background z-10'
                  data-slot='avatar-stack-item'
                  data-index={index}
                >
                  <Avatar userId={userId} size='rg' showActiveStatus={false} />
                </AvatarStackItem>
              ))}
            </div>
            {previewParticipantCount > MAX_AVATARS_TO_SHOW && (
              <span className='text-xs text-muted-foreground tabular-nums'>
                +{previewParticipantCount - MAX_AVATARS_TO_SHOW}
              </span>
            )}

            {/* Guest count and status */}
            <div className='flex-1 min-w-0 text-left'>
              <span className='text-sm font-medium text-foreground'>
                {previewParticipantCount} Guest{previewParticipantCount !== 1 ? 's' : ''}
              </span>
              <div className='flex items-center gap-3 mt-0.5'>
                {!hasLoadedParticipantStatuses ? (
                  <span className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                    <Loader2 className='size-3 animate-spin' />
                    <span>Loading guest status...</span>
                  </span>
                ) : isEnded ? (
                  <span className='flex items-center gap-1.5 text-xs'>
                    <span className='size-1.5 rounded-full bg-green-500' />
                    <span className='text-green-600'>{attendedCount} attended</span>
                  </span>
                ) : (
                  <>
                    {goingCount > 0 && (
                      <span className='flex items-center gap-1.5 text-xs'>
                        <span className='size-1.5 rounded-full bg-green-500' />
                        <span className='text-green-600'>{goingCount} going</span>
                      </span>
                    )}
                    {waitingCount > 0 && (
                      <span className='flex items-center gap-1.5 text-xs'>
                        <span className='size-1.5 rounded-full bg-amber-500' />
                        <span className='text-amber-600'>{waitingCount} waiting</span>
                      </span>
                    )}
                    {notGoingCount > 0 && (
                      <span className='flex items-center gap-1.5 text-xs'>
                        <span className='size-1.5 rounded-full bg-red-500' />
                        <span className='text-red-600'>{notGoingCount} no</span>
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>

            <ChevronDown
              className={cn(
                'size-5 text-muted-foreground transition-transform duration-200 shrink-0',
                isGuestsExpanded && 'rotate-180',
              )}
            />
          </button>

          {/* Expanded participants list */}
          {isGuestsExpanded && (
            <div className='border-t border-border'>
              <div className='flex flex-col max-h-44 overflow-y-auto'>
                {sortedParticipants.map(p => (
                  <ParticipantItem
                    key={p.userId}
                    userId={p.userId}
                    {...(p.displayName !== undefined ? { displayName: p.displayName } : {})}
                    {...(p.email !== undefined ? { email: p.email } : {})}
                    {...(p.isExternal !== undefined ? { isExternal: p.isExternal } : {})}
                    meetingStatus={
                      p.userId === currentUserId && localRsvp !== null
                        ? localRsvp
                        : (p.meetingStatus ?? MeetingStatus.PENDING)
                    }
                    isOrganizer={p.userId === organizerUserId}
                    didAttend={isEnded ? didAttend(p) : null}
                  />
                ))}
                {showParticipantsLoading && (
                  <div className='flex items-center justify-center gap-2 px-3 py-3 text-xs text-muted-foreground'>
                    <Loader2 className='size-3.5 animate-spin' />
                    <span>Loading full participant list...</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action button: Join / Download */}
      {isEnded
        ? onDownloadTranscript && (
            <button
              onClick={onDownloadTranscript}
              data-track-category='CALLS'
              data-track-name='popup-download-transcript'
              className='w-full mt-3 h-8 flex items-center justify-center gap-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer'
            >
              <Download className='size-3.5' />
              <span>Download transcript</span>
            </button>
          )
        : onJoinCall &&
          hydratedCurrentParticipant && (
            <button
              onClick={onJoinCall}
              disabled={isJoinDisabled}
              data-track-category='CALLS'
              data-track-name='popup-join-call'
              className={cn(
                'w-full mt-3 h-10 flex items-center justify-center gap-1.5 rounded-xl text-sm font-medium transition-opacity',
                isJoinDisabled
                  ? 'bg-muted text-muted-foreground cursor-not-allowed'
                  : shouldUsePrimaryJoinStyle
                    ? 'bg-primary text-action-primary-foreground hover:opacity-90 cursor-pointer'
                    : 'border border-border text-foreground hover:bg-muted cursor-pointer',
              )}
            >
              {isCurrentUserInCall ? (
                <AudioLines className='size-4' />
              ) : isCallUnavailable ? (
                <CalendarFold className='size-4' />
              ) : (
                <Headset className='size-4' />
              )}

              <span>
                {isCurrentUserInCall
                  ? 'Already joined'
                  : isCallUnavailable
                    ? 'Unavailable'
                    : 'Join Call'}
              </span>
            </button>
          )}

      {/* RSVP footer */}
      {!isEnded && !hasReachedScheduledStart && (
        <div className='-mx-4 px-4 border-t border-border pt-3 mt-4'>
          <div className='flex items-center justify-between'>
            <span className='text-xs text-muted-foreground font-medium'>Going?</span>
            <div className='flex items-center gap-1.5'>
              <button
                disabled={isLoading}
                onClick={() => handleRsvpClick(RSVP_CHOICE.ACCEPTED)}
                data-track-category='CALLS'
                data-track-name='rsvp-accepted'
                className={cn(
                  'text-xs px-3 py-1 rounded-full border font-medium transition-colors cursor-pointer disabled:opacity-50',
                  currentMeetingStatus === MeetingStatus.ACCEPTED
                    ? 'bg-action-primary text-action-primary-foreground border-action-primary'
                    : 'border-border hover:bg-muted text-foreground',
                )}
              >
                Yes
              </button>
              <button
                disabled={isLoading}
                onClick={() => handleRsvpClick(RSVP_CHOICE.DECLINED)}
                data-track-category='CALLS'
                data-track-name='rsvp-declined'
                className={cn(
                  'text-xs px-3 py-1 rounded-full border font-medium transition-colors cursor-pointer disabled:opacity-50',
                  currentMeetingStatus === MeetingStatus.DECLINED
                    ? 'bg-red-500 text-white border-red-500'
                    : 'border-border hover:bg-muted text-foreground',
                )}
              >
                No
              </button>
              <button
                disabled={isLoading}
                onClick={() => handleRsvpClick(RSVP_CHOICE.MAYBE)}
                data-track-category='CALLS'
                data-track-name='rsvp-maybe'
                className={cn(
                  'text-xs px-3 py-1 rounded-full border font-medium transition-colors cursor-pointer disabled:opacity-50',
                  currentMeetingStatus === MeetingStatus.MAYBE
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'border-border hover:bg-muted text-foreground',
                )}
              >
                Maybe
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarCallPopup;
