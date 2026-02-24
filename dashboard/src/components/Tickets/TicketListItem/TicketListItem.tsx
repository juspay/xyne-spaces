import { ReactElement, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Sparkles, CircleDashed, Circle, Clock, XCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import useMeasure from '../../../hooks/useMeasure';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import { TicketStatus } from '@xyne/shared';

export interface TicketListItemProps {
  ticket: {
    id: string;
    xyneId?: string | null;
    title: string;
    status: TicketStatus | string;
    stageName?: string | null;
    createdAt: number;
    metadata?: unknown;
  };
  onClick: () => void;
  showExtraFields?: boolean;
}

const ticketStatusConfig: Record<TicketStatus, ReactElement> = {
  [TicketStatus.NEW]: <CircleDashed size={14} className='text-gray-600' />,
  [TicketStatus.IN_PROGRESS]: (
    <Circle size={14} className='text-yellow-600' fill='currentColor' fillOpacity={0.2} />
  ),
  [TicketStatus.WAIT_FOR_APPROVAL]: <Clock size={14} className='text-orange-600' />,
  [TicketStatus.REJECTED]: <XCircle size={14} className='text-red-600' />,
  [TicketStatus.RESOLVED]: (
    <CheckCircle2 size={14} className='text-green-600' fill='currentColor' fillOpacity={0.2} />
  ),
};

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

const extractNameFromEmail = (fromEmailAddress: string | null | undefined): string | null => {
  if (!fromEmailAddress) return null;
  const nameMatch = fromEmailAddress.match(/^"?(.+?)"?\s*</);
  if (nameMatch && nameMatch[1]) return nameMatch[1].trim();
  const emailMatch = fromEmailAddress.match(/<(.+?)>/);
  if (emailMatch && emailMatch[1]) return emailMatch[1].split('@')[0] || null;
  return null;
};

const extractDomainFromEmail = (fromEmailAddress: string | null | undefined): string | null => {
  if (!fromEmailAddress) return null;
  const emailMatch = fromEmailAddress.match(/<(.+?)>/);
  if (emailMatch && emailMatch[1]) return emailMatch[1].split('@')[1] || null;
  const directEmailMatch = fromEmailAddress.match(
    /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/,
  );
  if (directEmailMatch && directEmailMatch[1]) return directEmailMatch[1].split('@')[1] || null;
  return null;
};

export const TicketListItem = ({
  ticket,
  onClick,
  showExtraFields = false,
}: TicketListItemProps): ReactElement => {
  const { ticketId } = useParams<{ ticketId?: string }>();
  const ticketIdValue = ticket.xyneId || ticket.id || '';
  const isActive = ticketId === ticketIdValue;
  const containerRef = useRef<HTMLDivElement>(null);
  const { width } = useMeasure({ ref: containerRef, observeResize: true });
  const isHumanInterventionTicket = ticket.stageName?.toLowerCase().includes('human') ?? false;
  const shouldHideDetails = width < 500;

  const metadata = ticket.metadata as { fromEmailAddress?: string | null } | null | undefined;
  const fromEmailAddress = metadata?.fromEmailAddress;
  const createdBy = useMemo(() => extractNameFromEmail(fromEmailAddress), [fromEmailAddress]);
  const company = useMemo(() => extractDomainFromEmail(fromEmailAddress), [fromEmailAddress]);

  const dueDate = useMemo(() => {
    return ticket.createdAt ? new Date(ticket.createdAt) : new Date();
  }, [ticket.createdAt]);

  let statusIcon =
    ticketStatusConfig[ticket.status as TicketStatus] ?? ticketStatusConfig[TicketStatus.NEW];
  if (isHumanInterventionTicket) {
    statusIcon = (
      <Sparkles size={14} className='text-indigo-600' fill='currentColor' fillOpacity={0.3} />
    );
  }

  const displayName = createdBy || (showExtraFields ? 'Unknown' : null);
  const displayCompany = company || (showExtraFields ? 'unknown.com' : null);

  return (
    <div
      ref={containerRef}
      onClick={onClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      role='button'
      tabIndex={0}
      className={cn(
        'flex items-center justify-between px-6 py-3 border-b border-gray-200 w-full cursor-pointer transition-colors gap-10',
        isActive ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50',
      )}
      data-track-category='Tickets'
      data-track-name='OpenTicket'
      data-track-metadata={JSON.stringify({ ticketId: ticket.id, xyneId: ticket.xyneId })}
    >
      <div className='flex items-center gap-2 min-w-0 flex-1'>
        <Tooltip
          delayDuration={500}
          content={
            isHumanInterventionTicket ? 'Human Intervention' : formatStatusText(ticket.status)
          }
        >
          <span className='h-full rounded-sm text-xs whitespace-nowrap flex items-center justify-center cursor-pointer'>
            {statusIcon}
          </span>
        </Tooltip>
        <span className='text-xs text-[#8492A1] font-mono flex-shrink-0 font-medium'>
          {ticketIdValue}
        </span>
        <span className='text-sm font-medium text-[#181B1D] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap'>
          {ticket.title}
        </span>
        {!shouldHideDetails && (
          <>
            {displayName && (
              <>
                <span className='size-1 rounded-full bg-gray-300 flex-shrink-0' />
                <span className='text-xs text-[#8492A1] flex-shrink-0 whitespace-nowrap'>
                  {displayName}
                </span>
              </>
            )}
            {displayCompany && (
              <>
                <span className='size-1 rounded-full bg-gray-300 flex-shrink-0' />
                <span className='text-xs text-[#8492A1] flex-shrink-0 whitespace-nowrap'>
                  {displayCompany}
                </span>
              </>
            )}
          </>
        )}
      </div>
      <div className='flex items-center justify-center gap-2 flex-shrink-0'>
        <span className='text-xs text-gray-900 whitespace-nowrap'>{formatDate(dueDate)}</span>
      </div>
    </div>
  );
};
