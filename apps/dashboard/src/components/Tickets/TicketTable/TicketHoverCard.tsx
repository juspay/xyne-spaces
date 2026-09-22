import React, { ReactElement, useMemo } from 'react';
import type { Ticket } from '@xyne/shared';
import { CalendarDefault as Calendar, UserDefault as User } from '@xyne/icons';
import Avatar from '../../ui/Avatar/Avatar';
import { getPriorityIcon, isEtaUrgent } from '../TicketCard/TicketCard.utils';
import { StatusOptions } from './TicketTableHelper';
import { htmlToFormattedText } from '../../../utils/clipboardUtils';
import { useUser } from '../../../hooks/useUsers';
import { useUserGroupById } from '../../../hooks/useUserGroup';
import { getUserDisplayName } from '../../../utils/userDisplayName';

const shortDate = (value: number | string | Date): string | null => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
};

const AssigneeFact: React.FC<{ ticket: Ticket }> = ({ ticket }) => {
  const assignedUserId =
    ticket.assignedTo && !ticket.assignedTo.startsWith('group:')
      ? ticket.assignedTo.replace(/^user:/, '')
      : '';
  const assignedGroupId = assignedUserId
    ? ''
    : ticket.assignedTo?.startsWith('group:')
      ? ticket.assignedTo.slice('group:'.length)
      : ticket.userGroupId || '';
  const assignedUser = useUser(assignedUserId);
  const assignedGroup = useUserGroupById(assignedGroupId);

  if (assignedUser) {
    return (
      <span className='flex min-w-0 items-center gap-1.5'>
        <Avatar userId={assignedUser.id} className='size-4 rounded-full' showActiveStatus={false} />
        <span className='truncate text-foreground'>{getUserDisplayName(assignedUser)}</span>
      </span>
    );
  }
  if (assignedGroup) {
    return (
      <span className='flex min-w-0 items-center gap-1.5'>
        <span className='flex size-4 items-center justify-center rounded-full bg-border text-[9px] font-medium text-muted-foreground'>
          {assignedGroup.name.charAt(0).toUpperCase()}
        </span>
        <span className='truncate text-foreground'>{assignedGroup.name}</span>
      </span>
    );
  }
  return (
    <span className='flex items-center gap-1.5'>
      <span className='flex size-4 items-center justify-center rounded-full border border-dashed border-muted-foreground'>
        <User className='h-2.5 w-2.5' strokeWidth={1.5} />
      </span>
      Unassigned
    </span>
  );
};

/**
 * Linear-style ticket preview shown on hovering a list row's title: title and
 * key facts up top, the description clamped with an ellipsis below.
 */
export const TicketHoverCard = ({ ticket }: { ticket: Ticket }): ReactElement => {
  const statusOption = StatusOptions.find(opt => opt.value === (ticket.statusV2 as string));
  const priorityLabel = ticket.priority
    ? ticket.priority.charAt(0) + ticket.priority.slice(1).toLowerCase()
    : null;
  const dueShort = ticket.eta ? shortDate(ticket.eta) : null;

  // Descriptions can carry HTML — clamp the plain text, not the markup.
  const descriptionText = useMemo(
    () => htmlToFormattedText(ticket.description || '').trim(),
    [ticket.description],
  );

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center gap-2'>
        <span className='font-mono text-xs font-medium text-muted-foreground'>{ticket.xyneId}</span>
        {statusOption && (
          <span className='ml-auto flex items-center gap-1.5 text-xs text-muted-foreground'>
            {statusOption.icon}
            {statusOption.label}
          </span>
        )}
      </div>

      <p className='line-clamp-2 text-sm font-medium text-foreground'>{ticket.title}</p>

      {descriptionText && (
        <p className='line-clamp-3 whitespace-pre-line text-xs text-muted-foreground'>
          {descriptionText}
        </p>
      )}

      <div className='h-px bg-border' />

      <div className='flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground'>
        {priorityLabel && (
          <span className='flex items-center gap-1.5'>
            {getPriorityIcon(ticket.priority)}
            {priorityLabel}
          </span>
        )}

        <AssigneeFact ticket={ticket} />

        {ticket.stageName && (
          <span className='max-w-[140px] truncate text-foreground'>{ticket.stageName}</span>
        )}

        {dueShort && (
          <span
            className={`flex items-center gap-1 ${
              isEtaUrgent(ticket.eta, ticket.statusV2) ? 'text-red-500' : ''
            }`}
          >
            <Calendar className='h-3 w-3' />
            {dueShort}
          </span>
        )}
      </div>
    </div>
  );
};
