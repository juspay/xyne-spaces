import { ReactElement, useMemo, useRef } from 'react';
import { Sparkles, Pencil } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import useMeasure from '../../../hooks/useMeasure';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import type { TicketListItem } from './TicketListView.types';
import { AssigneePicker } from './AssigneePicker';
import { StagePicker } from './StagePicker';
import { PriorityPicker } from './PriorityPicker';

interface TicketListRowProps {
  ticket: TicketListItem;
  onClick: () => void;
  isActive?: boolean;
  showExtraFields?: boolean;
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
}: TicketListRowProps): ReactElement => {
  const ticketIdValue = ticket.xyneId || ticket.id || '';
  const containerRef = useRef<HTMLDivElement>(null);
  const { width } = useMeasure({ ref: containerRef, observeResize: true });
  const isHumanInterventionTicket = ticket.stageName?.toLowerCase().includes('human') ?? false;
  const shouldHideDetails = width < 500;

  const metadata = ticket.metadata as { fromEmailAddress?: string | null } | null | undefined;
  const fromEmailAddress = metadata?.fromEmailAddress;
  const senderEmail = useMemo(() => extractSenderEmail(fromEmailAddress), [fromEmailAddress]);

  const dueDate = useMemo(() => {
    return ticket.createdAt ? new Date(ticket.createdAt) : new Date();
  }, [ticket.createdAt]);

  const displayEmail = senderEmail || (showExtraFields ? fromEmailAddress?.trim() || null : null);
  const statusLabel = isHumanInterventionTicket
    ? 'Human Intervention'
    : (ticket.stageName ?? formatStatusText(ticket.status));
  const emailCount = ticket.emails?.length ?? 0;
  // EmailDraftsACL already scopes to ctx.userID, so this is the current
  // user's unsent draft count for the ticket's conversation.
  const hasDraft = (ticket.emailDrafts?.length ?? 0) > 0;

  return (
    <div
      ref={containerRef}
      onClick={onClick}
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
        isActive ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-muted',
      )}
    >
      <div className='flex items-center gap-2 min-w-0 flex-1'>
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
        <span className='text-xs text-muted-foreground font-mono flex-shrink-0 font-medium'>
          {ticketIdValue}
        </span>
        <span className='text-sm font-medium text-foreground min-w-0 overflow-hidden text-ellipsis whitespace-nowrap'>
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
            <span className='text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap'>
              {displayEmail}
            </span>
          </>
        )}
      </div>
      <div className='flex items-center justify-center gap-3 flex-shrink-0'>
        <StagePicker ticketId={ticket.id} stageName={ticket.stageName} stageLabel={statusLabel} />
        <AssigneePicker ticketId={ticket.id} assignedTo={ticket.assignedTo} />
        <span className='text-xs text-foreground whitespace-nowrap'>{formatDate(dueDate)}</span>
      </div>
    </div>
  );
};
