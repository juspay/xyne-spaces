import { useState } from 'react';
import {
  Download,
  MessageSquare,
  X,
  Check,
  HelpCircle,
  Headphones,
  ChevronDown,
  Users,
  Pencil,
  Trash2,
  ExternalLink,
  MapPin,
} from 'lucide-react';
import { RRule } from 'rrule';
import { GoogleCalendarIcon, MicrosoftIcon } from './CalendarIcons';
import { CallStatus, MeetingStatus } from '@xyne/shared';
import { Call, isGoogleCalendarCall, isMicrosoftCalendarCall } from './callHistoryItem.utils';
import Button from '../../components/ui/Button';
import Avatar from '../../components/ui/Avatar/Avatar';
import { useUser } from '../../hooks/useUsers';
import { callService } from '../../services/Call/callService';
import { toast } from 'sonner';
import { cn } from '../../utils/classNames';
import { formatTimeAmPm } from '../../utils/dateUtils';

interface CalendarCallPopupProps {
  call: Call;
  currentUserId?: string | undefined;
  onClose: () => void;
  onJoinCall?: () => void;
  onGotoMessage?: () => void;
  onDownloadTranscript?: () => void;
  onEditClick?: (() => void) | undefined;
  onDeleteClick?: (() => void) | undefined;
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
  if (!ruleStr) return 'Recurring event';
  try {
    // Strip the "RRULE:" prefix if present, then parse
    const cleaned = ruleStr.replace(/^RRULE:/i, '');
    const options = RRule.parseString(cleaned);
    const rule = new RRule(options);
    const text = rule.toText();
    return text.charAt(0).toUpperCase() + text.slice(1);
  } catch {
    return 'Recurring event';
  }
}

// Small RSVP badge overlaid on the avatar bottom-right corner
function RsvpBadge({ status }: { status: MeetingStatus }): React.ReactElement | null {
  if (status === MeetingStatus.PENDING) return null;

  if (status === MeetingStatus.ACCEPTED) {
    return (
      <span className='absolute -bottom-0.5 -right-0.5 flex items-center justify-center size-3.5 rounded-full bg-green-500 border border-background'>
        <Check className='size-2 text-white stroke-[3]' />
      </span>
    );
  }
  if (status === MeetingStatus.DECLINED) {
    return (
      <span className='absolute -bottom-0.5 -right-0.5 flex items-center justify-center size-3.5 rounded-full bg-red-500 border border-background'>
        <X className='size-2 text-white stroke-[3]' />
      </span>
    );
  }
  // MAYBE
  return (
    <span className='absolute -bottom-0.5 -right-0.5 flex items-center justify-center size-3.5 rounded-full bg-amber-400 border border-background'>
      <HelpCircle className='size-2 text-white stroke-[3]' />
    </span>
  );
}

function ParticipantItem({
  userId,
  meetingStatus,
  isOrganizer,
}: {
  userId: string;
  meetingStatus: MeetingStatus;
  isOrganizer?: boolean;
}): React.ReactElement {
  const user = useUser(userId);

  return (
    <div className='flex items-center gap-2.5'>
      <div className='relative shrink-0'>
        <Avatar userId={userId} size='sm' showActiveStatus={false} rounded />
        <RsvpBadge status={meetingStatus} />
      </div>
      <div className='flex flex-row gap-2 items-center min-w-0'>
        <span className='text-[12px] text-foreground truncate'>{user?.name ?? '…'}</span>
        {isOrganizer && <span className='text-[10px] text-muted-foreground'>Organizer</span>}
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
}: CalendarCallPopupProps): React.ReactElement => {
  const isEnded = call.status === CallStatus.ENDED;
  const isRecurring = !!call.recurringSeriesId;
  const isGoogleCalendar = isGoogleCalendarCall(call);
  const isMicrosoftCalendar = isMicrosoftCalendarCall(call);
  const isExternalCalendar = isGoogleCalendar || isMicrosoftCalendar;

  const [seriesPrompt, setSeriesPrompt] = useState<RsvpChoice | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [localRsvp, setLocalRsvp] = useState<MeetingStatus | null>(null);
  const [isGuestsExpanded, setIsGuestsExpanded] = useState(false);

  const currentParticipant = call.participants?.find(p => p.userId === currentUserId);
  const currentMeetingStatus: MeetingStatus =
    localRsvp ?? currentParticipant?.meetingStatus ?? MeetingStatus.PENDING;

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
    if (isRecurring) {
      setSeriesPrompt(status);
    } else {
      void submitRsvp(status, false);
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
      <div className='p-4'>
        {/* Header */}
        <div className='flex items-start justify-between gap-2 mb-2'>
          <h3
            className='font-medium flex-1 min-w-0 text-foreground'
            style={{ fontSize: '16px', lineHeight: '22px' }}
          >
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
              data-track-category='Calls'
              data-track-name='calendar-popup-close'
              className='text-muted-foreground hover:text-foreground transition-colors p-0.5 cursor-pointer'
            >
              <X className='size-4' />
            </button>
          </div>
        </div>

        {/* Date & time */}
        {(dateLabel || timeLabel) && (
          <p className='text-muted-foreground mb-1' style={{ fontSize: '13px' }}>
            {dateLabel}
            {dateLabel && timeLabel && ' • '}
            {timeLabel}
          </p>
        )}

        {/* Location */}
        {location && (
          <div className='flex items-start gap-1.5 mb-2'>
            <MapPin className='size-3.5 text-muted-foreground shrink-0 mt-0.5' />
            <p className='text-muted-foreground' style={{ fontSize: '13px' }}>
              {location}
            </p>
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
            <div className='flex flex-col gap-1 max-h-36 overflow-y-auto'>
              {gcalAttendees.map((attendee, i) => (
                <div key={i} className='flex items-center gap-2'>
                  <span className='text-[12px] text-foreground truncate'>
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
  if (seriesPrompt) {
    return (
      <div className='p-4'>
        {/* Call icon */}
        <div className='mb-4'>
          <div className='size-12 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center'>
            <Headphones className='size-6 text-blue-500 dark:text-blue-400' />
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
            data-track-category='Calls'
            data-track-name='rsvp-this-call'
            className='text-sm px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors cursor-pointer disabled:opacity-50 text-foreground'
          >
            This Call
          </button>
          <button
            disabled={isLoading}
            onClick={() => void submitRsvp(seriesPrompt, true)}
            data-track-category='Calls'
            data-track-name='rsvp-all-calls'
            className='text-sm px-4 py-2 rounded-lg bg-action-primary text-action-primary-foreground hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50'
          >
            All Calls
          </button>
        </div>
      </div>
    );
  }

  // ── Main popup view ───────────────────────────────────────────────────────
  const participants = call.participants ?? [];

  const rsvpCounts = new Map<MeetingStatus, number>();
  for (const p of participants) {
    const status = p.userId === currentUserId && localRsvp !== null ? localRsvp : p.meetingStatus;
    rsvpCounts.set(status, (rsvpCounts.get(status) ?? 0) + 1);
  }
  const yesCount = rsvpCounts.get(MeetingStatus.ACCEPTED) ?? 0;
  const noCount = rsvpCounts.get(MeetingStatus.DECLINED) ?? 0;
  const waitingCount = participants.length - yesCount - noCount;
  const rsvpSummaryParts: string[] = [];
  if (yesCount > 0) rsvpSummaryParts.push(`${yesCount} yes`);
  if (noCount > 0) rsvpSummaryParts.push(`${noCount} no`);
  if (waitingCount > 0) rsvpSummaryParts.push(`${waitingCount} waiting`);

  const sortedParticipants = [...participants].sort((a, b) => {
    if (a.userId === organizerUserId) return -1;
    if (b.userId === organizerUserId) return 1;
    return 0;
  });

  return (
    <div className='p-4'>
      {/* Header: title + (message icon for ended) + close */}
      <div className='flex items-start justify-between gap-2 mb-2'>
        {/* Title — 16px, medium, 22px line-height */}
        <h3
          className='font-medium flex-1 min-w-0 text-foreground'
          style={{ fontSize: '16px', lineHeight: '22px' }}
        >
          {call.title ?? 'Call'}
        </h3>
        <div className='flex items-center gap-1 shrink-0 -mt-0.5'>
          {!isEnded && !isExternalCalendar && currentUserId === organizerUserId && onEditClick && (
            <button
              onClick={onEditClick}
              title='Edit call'
              data-track-category='Calls'
              data-track-name='popup-edit-call'
              className='text-muted-foreground hover:text-foreground transition-colors p-0.5 cursor-pointer'
            >
              <Pencil className='size-4' />
            </button>
          )}
          {!isEnded &&
            !isExternalCalendar &&
            currentUserId === organizerUserId &&
            onDeleteClick && (
              <button
                onClick={onDeleteClick}
                title='Delete call'
                data-track-category='Calls'
                data-track-name='popup-delete-call'
                className='text-muted-foreground hover:text-destructive transition-colors p-0.5 cursor-pointer'
              >
                <Trash2 className='size-4' />
              </button>
            )}
          {isEnded && onGotoMessage && (
            <button
              onClick={onGotoMessage}
              title='Go to message'
              data-track-category='Calls'
              data-track-name='popup-goto-message'
              className='text-muted-foreground hover:text-foreground transition-colors p-0.5 cursor-pointer'
            >
              <MessageSquare className='size-4' />
            </button>
          )}
          <button
            onClick={onClose}
            title='Close'
            data-track-category='Calls'
            data-track-name='popup-close'
            className='text-muted-foreground hover:text-foreground transition-colors p-0.5 cursor-pointer'
          >
            <X className='size-4' />
          </button>
        </div>
      </div>

      {/* Date and time — 14px, weight 450 */}
      {(dateLabel || timeLabel) && (
        <p className='text-muted-foreground' style={{ fontSize: '13px', fontWeight: 400 }}>
          {dateLabel}
          {dateLabel && timeLabel && ' • '}
          {timeLabel}
        </p>
      )}

      {/* Recurrence label — human-readable rule */}
      {recurrenceLabel && (
        <p className='text-muted-foreground mb-3' style={{ fontSize: '13px', fontWeight: 400 }}>
          {recurrenceLabel}
        </p>
      )}

      {/* Guests section */}
      {participants.length > 0 && (
        <div className='mb-3 mt-2'>
          {/* Collapsible header */}
          <button
            onClick={() => setIsGuestsExpanded(prev => !prev)}
            data-track-category='Calls'
            data-track-name='toggle-guests-list'
            className='w-full flex items-center justify-between cursor-pointer group'
          >
            <div className='flex items-center gap-1.5'>
              <span className='text-sm font-medium text-foreground'>
                {participants.length} Guest{participants.length !== 1 ? 's' : ''}
              </span>
              <Users className='size-4 text-muted-foreground' />
            </div>
            <ChevronDown
              className={cn(
                'size-4 text-muted-foreground transition-transform duration-200',
                isGuestsExpanded && 'rotate-180',
              )}
            />
          </button>

          {/* RSVP summary counts */}
          {rsvpSummaryParts.length > 0 && (
            <p className='text-xs text-muted-foreground mt-0.5'>{rsvpSummaryParts.join(', ')}</p>
          )}

          {/* Expanded participants list */}
          {isGuestsExpanded && (
            <div className='flex flex-col gap-1 max-h-48 overflow-y-auto mt-2'>
              {sortedParticipants.map(p => (
                <ParticipantItem
                  key={p.userId}
                  userId={p.userId}
                  meetingStatus={
                    p.userId === currentUserId && localRsvp !== null
                      ? localRsvp
                      : ((p.meetingStatus as MeetingStatus | undefined) ?? MeetingStatus.PENDING)
                  }
                  isOrganizer={p.userId === organizerUserId}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action button: Join / Download */}
      <div className='mb-3 mt-[20px]'>
        {isEnded
          ? onDownloadTranscript && (
              <button
                onClick={onDownloadTranscript}
                data-track-category='Calls'
                data-track-name='popup-download-transcript'
                className='flex items-center gap-2 text-sm text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors cursor-pointer'
              >
                <Download className='size-3.5 shrink-0' />
                Download transcript
              </button>
            )
          : onJoinCall && (
              <Button
                onClick={onJoinCall}
                className='!bg-action-primary !text-action-primary-foreground hover:opacity-90 duration-200 rounded-lg gap-1.5 px-4 py-2 h-8'
              >
                <span className='text-sm font-semibold'>Join Call</span>
              </Button>
            )}
      </div>

      {/* RSVP footer — justify-between so "Going?" sits at left, buttons at right */}
      {!isEnded && (
        <div className='border-t border-border pt-3'>
          <div className='flex items-center justify-between'>
            <span className='text-xs text-muted-foreground'>Going?</span>
            <div className='flex items-center gap-2'>
              <button
                disabled={isLoading}
                onClick={() => handleRsvpClick(RSVP_CHOICE.ACCEPTED)}
                data-track-category='Calls'
                data-track-name='rsvp-accepted'
                className={cn(
                  'text-xs px-3 py-1.5 rounded-full border transition-colors cursor-pointer disabled:opacity-50',
                  currentMeetingStatus === MeetingStatus.ACCEPTED
                    ? 'bg-green-500 text-white border-green-500'
                    : 'border-border hover:bg-muted text-foreground',
                )}
              >
                Yes
              </button>
              <button
                disabled={isLoading}
                onClick={() => handleRsvpClick(RSVP_CHOICE.DECLINED)}
                data-track-category='Calls'
                data-track-name='rsvp-declined'
                className={cn(
                  'text-xs px-3 py-1.5 rounded-full border transition-colors cursor-pointer disabled:opacity-50',
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
                data-track-category='Calls'
                data-track-name='rsvp-maybe'
                className={cn(
                  'text-xs px-3 py-1.5 rounded-full border transition-colors cursor-pointer disabled:opacity-50',
                  currentMeetingStatus === MeetingStatus.MAYBE
                    ? 'bg-amber-400 text-white border-amber-400'
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
