import React from 'react';
import type { Ticket, TicketTag } from '@xyne/shared';
import { CheckTickSingle as Check, Subtask } from '@xyne/icons';
import Tooltip from '../../ui/Tooltip';
import { HoverCard } from '../../ui/HoverCard/HoverCard';
import { TicketHoverCard } from './TicketHoverCard';
import { PriorityPicker } from '../TicketListView/PriorityPicker';
import { UserSelector } from '../CreateTicketModal/UserSelector';
import { useTicketAssignee, resolveAssigneeRef } from '../../../hooks/useTicketAssignee';
import { StatusPicker, DueDatePicker, LabelPicker } from './TicketListRowPickers';

export type SubTicketProgress = { done: number; total: number };

type TicketListRowProps = {
  ticket: Ticket;
  isSelected: boolean;
  onToggleSelect: (ticket: Ticket) => void;
  tags: TicketTag[];
  availableTags: string[];
  visibleColumns: Set<string>;
  subProgress?: SubTicketProgress | undefined;
  /** Board the ticket belongs to — shown as the row's capsule with a hover preview. */
  boardName?: string | undefined;
  isComfortView?: boolean;
  onOpen: (ticket: Ticket) => void;
};

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

const fullTimestamp = (value: number | string | Date): string =>
  new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

export const TicketListRow: React.FC<TicketListRowProps> = ({
  ticket,
  isSelected,
  onToggleSelect,
  tags,
  availableTags,
  visibleColumns,
  subProgress,
  boardName,
  isComfortView = false,
  onOpen,
}) => {
  const createdShort = shortDate(ticket.createdAt);
  const assignee = resolveAssigneeRef(ticket.assignedTo, ticket.userGroupId);
  const onAssign = useTicketAssignee(ticket.id, assignee);
  const ageDays = (() => {
    if (!visibleColumns.has('age') || !ticket.createdAt) return null;
    const created = new Date(ticket.createdAt);
    if (Number.isNaN(created.getTime())) return null;
    return Math.max(0, Math.floor((Date.now() - created.getTime()) / 86400000));
  })();
  const dueShort = visibleColumns.has('dueDate') && ticket.eta ? shortDate(ticket.eta) : null;

  return (
    <div
      className={`group/listrow flex h-full min-w-0 cursor-pointer items-center px-3 ${
        isComfortView ? 'gap-2.5' : 'gap-2'
      }`}
      onClick={() => onOpen(ticket)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(ticket);
        }
      }}
      role='button'
      tabIndex={0}
      data-track-category='Tickets'
      data-track-name='TicketListRow'
    >
      <span
        className={`flex w-4 flex-shrink-0 items-center justify-center transition-opacity ${
          isSelected ? '' : 'opacity-0 group-hover/listrow:opacity-100'
        }`}
      >
        {isSelected ? (
          <button
            className='flex h-4 w-4 cursor-pointer items-center justify-center rounded bg-blue-600'
            onClick={e => {
              e.stopPropagation();
              onToggleSelect(ticket);
            }}
            data-track-category='Tickets'
            data-track-name='DeselectRow'
          >
            <Check className='h-3 w-3 text-white' strokeWidth={3} />
          </button>
        ) : (
          <button
            aria-label='Select ticket'
            className='h-4 w-4 cursor-pointer rounded border border-border bg-transparent transition-colors hover:border-muted-foreground'
            onClick={e => {
              e.stopPropagation();
              onToggleSelect(ticket);
            }}
            data-track-category='Tickets'
            data-track-name='SelectRow'
          />
        )}
      </span>

      {visibleColumns.has('priority') && (
        <span className='flex w-5 flex-shrink-0 items-center justify-center'>
          <PriorityPicker ticketId={ticket.id} priority={ticket.priority} compact />
        </span>
      )}

      <span className='w-[4.5rem] flex-shrink-0 truncate font-mono text-xs font-medium text-muted-foreground'>
        {ticket.xyneId}
      </span>

      {visibleColumns.has('status') && (
        <span className='flex w-5 flex-shrink-0 items-center justify-center'>
          <StatusPicker ticketId={ticket.id} statusV2={ticket.statusV2 as string} />
        </span>
      )}

      {/* Native title, not TruncatedTooltip — its rewrap cycle loops in flex cells. */}
      <span
        className='min-w-0 truncate text-sm font-medium text-foreground'
        title={ticket.title ?? ''}
      >
        {ticket.title}
      </span>

      {subProgress && subProgress.total > 0 && (
        <Tooltip content={`${subProgress.done} of ${subProgress.total} sub-tickets completed`}>
          <span className='flex flex-shrink-0 items-center gap-1 text-xs text-muted-foreground'>
            <Subtask className='h-3.5 w-3.5' />
            {subProgress.done}/{subProgress.total}
          </span>
        </Tooltip>
      )}

      <span className='ml-auto flex flex-shrink-0 items-center gap-2.5 pl-3'>
        {visibleColumns.has('tags') && tags.length > 0 && (
          <LabelPicker ticket={ticket} tags={tags} availableTags={availableTags}>
            {tags.slice(0, 2).map(tag => (
              <span
                key={tag.id}
                className='flex max-w-[120px] items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground'
              >
                <span className='h-1.5 w-1.5 flex-shrink-0 rounded-full bg-xyne-purple-400'></span>
                <span className='truncate'>{tag.name}</span>
              </span>
            ))}
            {tags.length > 2 && (
              <span className='rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground'>
                +{tags.length - 2}
              </span>
            )}
          </LabelPicker>
        )}

        {visibleColumns.has('stage') && boardName && (
          <HoverCard
            trigger={
              <span className='max-w-[140px] truncate rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground'>
                {boardName}
              </span>
            }
            openDelay={300}
            closeDelay={100}
            side='bottom'
            align='end'
            className='w-80'
          >
            <TicketHoverCard ticket={ticket} />
          </HoverCard>
        )}

        {visibleColumns.has('merchantId') && ticket.merchantId && (
          <Tooltip content={`Merchant ID: ${ticket.merchantId}`}>
            <span className='max-w-[140px] truncate rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground'>
              {ticket.merchantId}
            </span>
          </Tooltip>
        )}

        {ageDays !== null && ageDays > 0 && (
          <Tooltip content={`Age: ${ageDays} day${ageDays === 1 ? '' : 's'} since created`}>
            <span className='text-xs text-muted-foreground'>{ageDays}d</span>
          </Tooltip>
        )}

        {dueShort && (
          <DueDatePicker
            ticketId={ticket.id}
            eta={ticket.eta}
            statusV2={ticket.statusV2}
            display={dueShort}
          />
        )}

        {visibleColumns.has('assignee') && (
          <UserSelector
            selectedUserId={assignee.userId}
            assignedGroupId={assignee.groupId}
            onUserSelect={onAssign}
            channelId={ticket.channelId}
            variant='compact'
          />
        )}

        {createdShort && (
          <Tooltip content={`Created ${fullTimestamp(ticket.createdAt)}`}>
            <span className='text-xs text-muted-foreground'>{createdShort}</span>
          </Tooltip>
        )}
      </span>
    </div>
  );
};
