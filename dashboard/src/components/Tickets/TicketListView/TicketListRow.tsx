import { MouseEvent, ReactElement, useMemo, useRef } from 'react';
import { Sparkles, Pencil, Wand2, Loader2 } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { findEmailAddress, parseFirstEmailAddress } from '../../../utils/emailAddress';
import useMeasure from '../../../hooks/useMeasure';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import { useAuthContextValues } from '../../../hooks/useAuth';
import type { TicketListItem } from './TicketListView.types';
import { AssigneePicker } from './AssigneePicker';
import { PriorityPicker } from './PriorityPicker';

interface TicketListRowProps {
  ticket: TicketListItem;
  onClick: () => void;
  isActive?: boolean;
  showExtraFields?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

const formatStatusText = (status: string): string => {
  return status
    .split('_')
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
};

const formatDate = (date: Date): string => {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[date.getMonth()]} ${date.getDate()}`;
};

// Full date + time used for the hover tooltip — gives users the exact
// timestamp behind the compact "May 1" label on the row.
const formatDateTime = (date: Date): string =>
  date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

const formatTime = (date: Date): string =>
  date.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

// A "From" header can be "Rahul Kumar <john.doe@gmail.com>", a bare address
// like "bitbucket-no-reply@juspay.email", an RFC 2047 encoded-word, or a list of
// several addresses — parseFirstEmailAddress handles all of those and returns
// the first sender. The name is null for bare addresses, so the row falls back
// to showing the email (Gmail-style).
const parseSender = (
  fromEmailAddress: string | null | undefined,
): { name: string | null; email: string | null } => {
  if (!fromEmailAddress) return { name: null, email: null };
  const { name, email } = parseFirstEmailAddress(fromEmailAddress);
  // Fall back to a loose scan for values that aren't a well-formed address
  // token at all, e.g. "Wrapper text (user@domain)".
  const resolvedEmail = email ?? findEmailAddress(fromEmailAddress);
  // Skip a "display name" that is just the address repeated (avoids "x@y <x@y>").
  // A real name that happens to contain "@" is kept — we only compare equality,
  // not a blanket "contains @" check.
  const resolvedName =
    name && name.toLowerCase() !== (resolvedEmail ?? '').toLowerCase() ? name : null;
  return { name: resolvedName, email: resolvedEmail };
};

export const TicketListRow = ({
  ticket,
  onClick,
  isActive = false,
  showExtraFields = false,
  isSelected = false,
  onToggleSelect,
}: TicketListRowProps): ReactElement => {
  const ticketIdValue = ticket.xyneId || ticket.id || '';
  const containerRef = useRef<HTMLDivElement>(null);
  const { width } = useMeasure({ ref: containerRef, observeResize: true });
  const isHumanInterventionTicket = ticket.stageName?.toLowerCase().includes('human') ?? false;
  const shouldHideDetails = width < 500;

  const metadata = ticket.metadata as { fromEmailAddress?: string | null } | null | undefined;
  const fromEmailAddress = metadata?.fromEmailAddress;
  const { name: senderName, email: senderEmail } = useMemo(
    () => parseSender(fromEmailAddress),
    [fromEmailAddress],
  );

  // Display the date that drives the row's sort position so the column
  // matches the order users see (Gmail-style: most recent activity first).
  const dueDate = useMemo(() => {
    return ticket.lastEmailAt ? new Date(ticket.lastEmailAt) : new Date();
  }, [ticket.lastEmailAt]);

  const displayEmail = senderEmail || (showExtraFields ? fromEmailAddress?.trim() || null : null);
  // Show the sender's display name when the email carries one (like Gmail),
  // otherwise fall back to the email address.
  const displaySender = senderName || displayEmail;
  // Keep the full identity on hover even when only the name is shown.
  const senderTitle = senderName && displayEmail ? `${senderName} <${displayEmail}>` : displayEmail;
  const statusLabel = isHumanInterventionTicket
    ? 'Human Intervention'
    : (ticket.stageName ?? formatStatusText(ticket.status));
  const emailCount = ticket.emailCount ?? 0;
  const draftKind = useMemo((): 'user' | 'auto' | 'generating' | null => {
    const drafts = (ticket.emailDrafts ?? []) as ReadonlyArray<{
      userId: string | null;
      autoDraftStatus?: string | null;
    }>;
    if (drafts.length === 0) return null;
    if (drafts.some(d => d.userId !== null)) return 'user';
    if (drafts.some(d => d.userId === null && d.autoDraftStatus === 'GENERATING'))
      return 'generating';
    return 'auto';
  }, [ticket.emailDrafts]);

  // Thread-level unread: email_reads.lastReadEmailAt is a snapshot of
  // ticket.lastEmailAt taken when the user last read. Unread = no row, or that
  // snapshot is older than the current lastEmailAt (a newer email arrived).
  // Assignment state doesn't short-circuit — auto-assign boards would otherwise
  // mark every inbound email read for everyone instantly.
  const { userID } = useAuthContextValues();
  const ticketReads = ticket.emailReads as
    | ReadonlyArray<{ userId: string; lastReadEmailAt: number }>
    | undefined;
  const userRow = (ticketReads ?? []).find(r => r.userId === userID);
  const ticketLastEmailAt = ticket.lastEmailAt ?? 0;
  const hasUnread = emailCount > 0 && (!userRow || userRow.lastReadEmailAt < ticketLastEmailAt);
  const handleRowClick = (e: MouseEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('[data-ticket-row-checkbox]')) return;
    onClick();
  };

  return (
    <div
      ref={containerRef}
      onClick={handleRowClick}
      data-track-category='Tickets'
      data-track-name='ClickTicketListRow'
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      role='button'
      tabIndex={0}
      data-slot='ticket-list-row'
      className={cn(
        'flex items-center justify-between px-6 py-3 border-b border-border last:border-b-0 w-full cursor-pointer transition-colors gap-10',
        isActive
          ? 'bg-primary/10 hover:bg-primary/15'
          : hasUnread
            ? 'bg-muted hover:bg-muted'
            : 'bg-background hover:bg-muted/50',
      )}
    >
      <div className='flex items-center gap-2 min-w-0 flex-1'>
        {onToggleSelect && (
          <span
            data-ticket-row-checkbox
            className='flex-shrink-0 inline-flex items-center mr-1'
            data-track-category='Tickets'
            data-track-name='ToggleTicketSelection'
          >
            <Checkbox checked={isSelected} onChange={() => onToggleSelect()} label='' accent />
          </span>
        )}
        {isHumanInterventionTicket ? (
          <Tooltip delayDuration={500} content='Human Intervention'>
            <span className='h-full rounded-sm text-xs whitespace-nowrap flex items-center justify-center'>
              <Sparkles
                size={14}
                className='text-status-paused'
                fill='currentColor'
                fillOpacity={0.3}
              />
            </span>
          </Tooltip>
        ) : (
          <PriorityPicker ticketId={ticket.id} priority={ticket.priority} compact />
        )}
        <span
          className={cn(
            'text-xs font-mono flex-shrink-0',
            hasUnread ? 'text-foreground font-semibold' : 'text-muted-foreground font-medium',
          )}
        >
          {ticketIdValue}
        </span>
        <span
          className={cn(
            'text-sm flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-foreground',
            hasUnread ? 'font-semibold' : 'font-normal',
          )}
        >
          {ticket.title}
        </span>
        {ticket.aiCategory && (
          <span
            className='inline-flex items-center justify-center h-[18px] px-2 rounded-sm bg-blue-100 dark:bg-blue-950/50 text-[10px] font-medium text-blue-700 dark:text-blue-300 whitespace-nowrap flex-shrink-0'
            title={`AI Category: ${ticket.aiCategory}`}
          >
            {ticket.aiCategory}
          </span>
        )}
        <div className='w-[28px] flex-shrink-0'>
          {emailCount > 0 && (
            <span
              className='inline-flex items-center justify-center w-[28px] h-[18px] px-1 rounded-sm bg-muted text-[10px] font-medium text-muted-foreground tabular-nums'
              title={`${emailCount} email${emailCount === 1 ? '' : 's'}`}
            >
              {emailCount}
            </span>
          )}
        </div>
        <div className='w-[80px] flex justify-start flex-shrink-0'>
          {draftKind === 'user' && (
            <Tooltip delayDuration={500} content='Your unsent draft'>
              <span
                className='inline-flex items-center gap-1 h-[18px] px-1.5 rounded-sm bg-amber-100 text-[10px] font-medium text-amber-700'
                aria-label='Unsent draft'
              >
                <Pencil size={10} />
                Draft
              </span>
            </Tooltip>
          )}
          {draftKind === 'auto' && (
            <Tooltip delayDuration={500} content='AI-generated draft suggestion'>
              <span
                className='inline-flex items-center gap-1 h-[18px] px-1.5 rounded-sm bg-violet-100 text-[10px] font-medium text-violet-700 dark:bg-violet-950/50 dark:text-violet-300'
                aria-label='AI draft suggestion'
              >
                <Wand2 size={10} />
                AI draft
              </span>
            </Tooltip>
          )}
          {draftKind === 'generating' && (
            <Tooltip delayDuration={500} content='Generating AI draft…'>
              <span
                className='inline-flex items-center gap-1 h-[18px] px-1.5 rounded-sm bg-violet-100 text-[10px] font-medium text-violet-700 dark:bg-violet-950/50 dark:text-violet-300'
                aria-label='Generating AI draft'
              >
                <Loader2 size={10} className='animate-spin' />
                Drafting…
              </span>
            </Tooltip>
          )}
        </div>
        {/* 280px is the preferred width of the sender column, not a floor:
            `shrink` + `min-w-0` let it give space back on narrow rows so the
            title (the only other flexible item in the row) isn't the sole thing
            squeezed to zero. The sender span inside already ellipsizes. */}
        {!shouldHideDetails && (
          <div className='w-[280px] min-w-0 shrink flex items-center gap-2 justify-end'>
            {displaySender && (
              <>
                <span className='size-1 rounded-full bg-muted flex-shrink-0' />
                <span
                  className={cn(
                    'text-xs whitespace-nowrap overflow-hidden text-ellipsis',
                    hasUnread
                      ? 'text-foreground font-semibold'
                      : 'text-muted-foreground font-normal',
                  )}
                  title={senderTitle ?? undefined}
                >
                  {senderName ? (
                    <>
                      {senderName}
                      {displayEmail && (
                        <span className='ml-1 font-normal text-muted-foreground'>
                          {`<${displayEmail}>`}
                        </span>
                      )}
                    </>
                  ) : (
                    displayEmail
                  )}
                </span>
              </>
            )}
          </div>
        )}
      </div>
      <div className='flex items-center justify-center gap-3 flex-shrink-0'>
        <div className='w-[100px] flex justify-start'>
          <span
            className='inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground truncate max-w-full'
            title={ticket.stageName ?? undefined}
          >
            {statusLabel}
          </span>
        </div>
        <AssigneePicker
          ticketId={ticket.id}
          assignedTo={ticket.assignedTo}
          channelId={ticket.channelId ?? undefined}
        />
        <Tooltip delayDuration={300} content={formatDateTime(dueDate)} side='top'>
          <span
            className={cn(
              'text-xs whitespace-nowrap w-[44px] text-right tabular-nums',
              hasUnread ? 'text-foreground font-semibold' : 'text-muted-foreground font-normal',
            )}
          >
            {formatDate(dueDate)}
          </span>
        </Tooltip>
        <span
          className={cn(
            'text-xs whitespace-nowrap w-[64px] text-right tabular-nums',
            hasUnread ? 'text-foreground font-semibold' : 'text-muted-foreground font-normal',
          )}
        >
          {formatTime(dueDate)}
        </span>
      </div>
    </div>
  );
};
