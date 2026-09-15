import { MouseEvent, ReactElement, useMemo } from 'react';
import { Wand2 } from 'lucide-react';
import { SparkleAi02 as Sparkles, PencilEdit as Pencil, Spinner as Loader2 } from '@xyne/icons';
import { cn } from '../../../utils/classNames';
import { findEmailAddress, parseFirstEmailAddress } from '../../../utils/emailAddress';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import { TruncatedTooltip } from '../../ui/Tooltip/TruncatedTooltip';
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import { useAuthContextValues } from '../../../hooks/useAuth';
import type { TicketListItem } from './TicketListView.types';
import { AssigneePicker } from './AssigneePicker';
import { PriorityPicker } from './PriorityPicker';
import { AutoDraftStatus } from '@xyne/shared';
import { getTicketListColumnAlignClass } from './ticketListColumns';

interface TicketListRowProps {
  ticket: TicketListItem;
  onClick: () => void;
  isActive?: boolean;
  showExtraFields?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  gridTemplate: string;
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

// A "From" header can be "Jane Doe <jane.doe@example.com>", a bare address
// like "bitbucket-no-reply@example.com", an RFC 2047 encoded-word, or a list of
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
  gridTemplate,
}: TicketListRowProps): ReactElement => {
  const ticketIdValue = ticket.xyneId || ticket.id || '';
  const isHumanInterventionTicket = ticket.stageName?.toLowerCase().includes('human') ?? false;

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
  const createdDate = useMemo(() => new Date(ticket.createdAt), [ticket.createdAt]);

  const displayEmail = senderEmail || (showExtraFields ? fromEmailAddress?.trim() || null : null);
  // Show the sender's display name when the email carries one (like Gmail),
  // otherwise fall back to the email address.
  const displaySender = senderName || displayEmail;
  // Keep the full identity on hover even when only the name is shown. Mirrors the
  // rendered text exactly, so it is also what the truncation tooltip reveals.
  const senderTitle =
    senderName && displayEmail
      ? `${senderName} <${displayEmail}>`
      : (displayEmail ?? senderName ?? '');
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
    if (drafts.some(d => d.userId === null && d.autoDraftStatus === AutoDraftStatus.GENERATING))
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
        'grid items-center gap-x-3 px-6 py-3 border-b border-border last:border-b-0 w-full cursor-pointer transition-colors',
        isActive
          ? 'bg-primary/10 hover:bg-primary/15'
          : hasUnread
            ? 'bg-muted hover:bg-muted'
            : 'bg-background hover:bg-muted/50',
      )}
      style={{ gridTemplateColumns: gridTemplate }}
    >
      {onToggleSelect && (
        <div className='flex min-w-0 items-center justify-start'>
          <span
            data-ticket-row-checkbox
            className='inline-flex shrink-0 items-center'
            data-track-category='Tickets'
            data-track-name='ToggleTicketSelection'
          >
            <Checkbox checked={isSelected} onChange={() => onToggleSelect()} label='' />
          </span>
        </div>
      )}
      <div className={cn('flex min-w-0 items-center', getTicketListColumnAlignClass('priority'))}>
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
      </div>
      <div
        className={cn(
          'flex min-w-0 items-center gap-2 overflow-hidden',
          getTicketListColumnAlignClass('subject'),
        )}
      >
        <span
          className={cn(
            'shrink-0 text-xs font-mono',
            hasUnread ? 'text-foreground font-semibold' : 'text-muted-foreground font-medium',
          )}
        >
          {ticketIdValue}
        </span>
        <TruncatedTooltip content={ticket.title}>
          <span
            className={cn(
              'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-foreground',
              hasUnread ? 'font-semibold' : 'font-normal',
            )}
          >
            {ticket.title}
          </span>
        </TruncatedTooltip>
        {ticket.aiCategory && (
          <span
            className='inline-flex h-[18px] shrink-0 items-center justify-center whitespace-nowrap rounded-sm bg-blue-100 px-2 text-[10px] font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
            title={`AI Category: ${ticket.aiCategory}`}
          >
            {ticket.aiCategory}
          </span>
        )}
      </div>
      <div className={cn('flex min-w-0 items-center', getTicketListColumnAlignClass('emails'))}>
        {emailCount > 0 && (
          <span
            className='inline-flex h-[18px] min-w-[28px] items-center justify-center rounded-sm bg-muted px-1 text-[10px] font-medium tabular-nums text-muted-foreground'
            title={`${emailCount} email${emailCount === 1 ? '' : 's'}`}
          >
            {emailCount}
          </span>
        )}
      </div>
      <div
        className={cn(
          'flex min-w-0 items-center overflow-hidden',
          getTicketListColumnAlignClass('draft'),
        )}
      >
        {draftKind === 'user' && (
          <Tooltip delayDuration={500} content='Your unsent draft'>
            <span
              className='inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-sm bg-amber-100 px-1.5 text-[10px] font-medium text-amber-700'
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
              className='inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-sm bg-violet-100 px-1.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950/50 dark:text-violet-300'
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
              className='inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-sm bg-violet-100 px-1.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950/50 dark:text-violet-300'
              aria-label='Generating AI draft'
            >
              <Loader2 size={10} className='animate-spin' />
              Drafting…
            </span>
          </Tooltip>
        )}
      </div>
      <div
        className={cn(
          'flex min-w-0 items-center gap-2 overflow-hidden',
          getTicketListColumnAlignClass('sender'),
        )}
      >
        {displaySender && (
          <>
            <span className='size-1 shrink-0 rounded-full bg-muted' />
            <TruncatedTooltip content={senderTitle}>
              <span
                className={cn(
                  'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs',
                  hasUnread ? 'text-foreground font-semibold' : 'text-muted-foreground font-normal',
                )}
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
            </TruncatedTooltip>
          </>
        )}
      </div>
      <div
        className={cn(
          'flex min-w-0 items-center overflow-hidden',
          getTicketListColumnAlignClass('status'),
        )}
      >
        <span className='inline-flex max-w-full items-center rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>
          <TruncatedTooltip content={statusLabel}>
            <span className='min-w-0 truncate'>{statusLabel}</span>
          </TruncatedTooltip>
        </span>
      </div>
      <div className={cn('flex min-w-0 items-center', getTicketListColumnAlignClass('assignee'))}>
        <AssigneePicker
          ticketId={ticket.id}
          assignedTo={ticket.assignedTo}
          channelId={ticket.channelId ?? undefined}
        />
      </div>
      <div
        className={cn(
          'flex min-w-0 items-center overflow-hidden',
          getTicketListColumnAlignClass('createdAt'),
        )}
      >
        <Tooltip delayDuration={500} content={`Created: ${formatDateTime(createdDate)}`} side='top'>
          <span className='overflow-hidden text-ellipsis whitespace-nowrap text-xs tabular-nums text-muted-foreground'>
            {formatDate(createdDate)} · {formatTime(createdDate)}
          </span>
        </Tooltip>
      </div>
      <div
        className={cn(
          'flex min-w-0 items-center overflow-hidden',
          getTicketListColumnAlignClass('age'),
        )}
      >
        <span className='overflow-hidden text-ellipsis whitespace-nowrap text-xs tabular-nums text-muted-foreground'>
          {Math.max(0, Math.floor((Date.now() - ticket.createdAt) / 86400000))}d
        </span>
      </div>
      <div
        className={cn(
          'flex min-w-0 items-center gap-2 overflow-hidden',
          getTicketListColumnAlignClass('latestEmail'),
        )}
      >
        <Tooltip
          delayDuration={500}
          content={`Latest email: ${formatDateTime(dueDate)}`}
          side='top'
        >
          <span
            className={cn(
              'overflow-hidden text-ellipsis whitespace-nowrap text-xs tabular-nums',
              hasUnread ? 'text-foreground font-semibold' : 'text-muted-foreground font-normal',
            )}
          >
            {formatDate(dueDate)}
          </span>
        </Tooltip>
        <span
          className={cn(
            'shrink-0 whitespace-nowrap text-xs tabular-nums',
            hasUnread ? 'text-foreground font-semibold' : 'text-muted-foreground font-normal',
          )}
        >
          {formatTime(dueDate)}
        </span>
      </div>
    </div>
  );
};
