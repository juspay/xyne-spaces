import { MouseEvent, ReactElement, useMemo, useRef } from 'react';
import { Sparkles, Pencil } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import useMeasure from '../../../hooks/useMeasure';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import { useAuthContextValues } from '../../../hooks/useAuth';
import type { TicketListItem } from './TicketListView.types';
import { AssigneePicker } from './AssigneePicker';
import { StagePicker } from './StagePicker';
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

const extractSenderEmail = (fromEmailAddress: string | null | undefined): string | null => {
  if (!fromEmailAddress) return null;
  const bracketMatch = fromEmailAddress.match(/<([^>]+)>/);
  if (bracketMatch && bracketMatch[1]) return bracketMatch[1].trim();
  const plainMatch = fromEmailAddress.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (plainMatch && plainMatch[1]) return plainMatch[1];
  return null;
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
  const senderEmail = useMemo(() => extractSenderEmail(fromEmailAddress), [fromEmailAddress]);

  // Display the date that drives the row's sort position so the column
  // matches the order users see (Gmail-style: most recent activity first).
  const dueDate = useMemo(() => {
    return ticket.lastEmailAt ? new Date(ticket.lastEmailAt) : new Date();
  }, [ticket.lastEmailAt]);

  const displayEmail = senderEmail || (showExtraFields ? fromEmailAddress?.trim() || null : null);
  const statusLabel = isHumanInterventionTicket
    ? 'Human Intervention'
    : (ticket.stageName ?? formatStatusText(ticket.status));
  const emailCount = ticket.emails?.length ?? 0;
  // EmailDraftsACL already scopes to ctx.userID, so this is the current
  // user's unsent draft count for the ticket's conversation.
  const hasDraft = (ticket.emailDrafts?.length ?? 0) > 0;

  // Thread-level unread: compare the thread's most recent email id against
  // the id the current user last saw (stored in email_reads.lastReadEmailId).
  // Mismatch OR no stored row → unread. Assignment state doesn't short-circuit
  // — auto-assign boards would otherwise mark every inbound email read for
  // everyone instantly.
  const { userID } = useAuthContextValues();
  const ticketReads = ticket.emailReads as
    | ReadonlyArray<{ userId: string; lastReadEmailId: string }>
    | undefined;
  const latestEmailId = useMemo(() => {
    const emails = (ticket.emails ?? []) as ReadonlyArray<{ id: string; createdAt: number }>;
    if (emails.length === 0) return null;
    return emails.reduce((latest, e) => (e.createdAt > latest.createdAt ? e : latest)).id;
  }, [ticket.emails]);
  const userRow = (ticketReads ?? []).find(r => r.userId === userID);
  const hasUnread = emailCount > 0 && (!userRow || userRow.lastReadEmailId !== latestEmailId);
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
            <Checkbox checked={isSelected} onChange={() => onToggleSelect()} label='' />
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
            'text-sm min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-foreground',
            hasUnread ? 'font-semibold' : 'font-normal',
          )}
        >
          {ticket.title}
        </span>
        {emailCount > 0 && (
          <span
            className='inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-sm bg-muted text-[10px] font-medium text-muted-foreground flex-shrink-0'
            title={`${emailCount} email${emailCount === 1 ? '' : 's'}`}
          >
            {emailCount}
          </span>
        )}
        {hasDraft && (
          <Tooltip delayDuration={500} content='Unsent draft'>
            <span
              className='inline-flex items-center gap-1 h-[18px] px-1.5 rounded-sm bg-amber-100 text-[10px] font-medium text-amber-700 flex-shrink-0'
              aria-label='Unsent draft'
            >
              <Pencil size={10} />
              Draft
            </span>
          </Tooltip>
        )}
        {!shouldHideDetails && displayEmail && (
          <>
            <span className='size-1 rounded-full bg-muted flex-shrink-0' />
            <span
              className={cn(
                'text-xs flex-shrink-0 whitespace-nowrap',
                hasUnread ? 'text-foreground font-semibold' : 'text-muted-foreground font-normal',
              )}
            >
              {displayEmail}
            </span>
          </>
        )}
      </div>
      <div className='flex items-center justify-center gap-3 flex-shrink-0'>
        <StagePicker ticketId={ticket.id} stageName={ticket.stageName} stageLabel={statusLabel} />
        <AssigneePicker ticketId={ticket.id} assignedTo={ticket.assignedTo} />
        <span
          className={cn(
            'text-xs whitespace-nowrap',
            hasUnread ? 'text-foreground font-semibold' : 'text-muted-foreground font-normal',
          )}
        >
          {formatDate(dueDate)}
        </span>
      </div>
    </div>
  );
};
