import React, { ReactElement, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Ticket, TicketTag } from '@xyne/shared';
import { CalendarDefault as Calendar, CheckTickSingle as Check } from '@xyne/icons';
import { Popover } from '../../ui/Popover/Popover';
import Tooltip from '../../ui/Tooltip';
import { DatePicker } from '../../ui/DatePicker/DatePicker';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { surfaceMutationError } from '../../../utils/zeroMutationToast';
import { isEtaUrgent } from '../TicketCard/TicketCard.utils';
import { StatusOptions } from './TicketTableHelper';
import { dueDateToEta } from './useBulkTicketActions';
import { cn } from '../../../utils/classNames';

/** Row-level inline pickers: icon triggers that swallow the row click. */

export function StatusPicker({
  ticketId,
  statusV2,
}: {
  ticketId: string;
  statusV2: string | null | undefined;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const zero = useZero();
  const current = StatusOptions.find(opt => opt.value === statusV2);

  const setStatus = (value: string): void => {
    if (value !== statusV2) {
      void surfaceMutationError(
        zero.mutate(
          mutators.ticket.update({ id: ticketId, statusV2: value, updatedAt: Date.now() }),
        ),
        'Failed to update status',
      );
    }
    setOpen(false);
  };

  const trigger = (
    <button
      type='button'
      onClick={e => {
        e.stopPropagation();
        setOpen(prev => !prev);
      }}
      onKeyDown={e => e.stopPropagation()}
      className='inline-flex h-5 w-5 items-center justify-center rounded-md hover:bg-muted'
      aria-label='Change status'
      data-track-category='Tickets'
      data-track-name='ToggleRowStatus'
    >
      <Tooltip content={current ? `Status: ${current.label}` : 'Set status'}>
        <span className='inline-flex items-center justify-center'>{current?.icon}</span>
      </Tooltip>
    </button>
  );

  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      modal
      onCloseAutoFocus={event => event.preventDefault()}
      align='start'
      sideOffset={4}
      className='p-1 w-44'
    >
      <div className='flex flex-col'>
        {StatusOptions.map(opt => (
          <button
            key={opt.value}
            type='button'
            onClick={e => {
              e.stopPropagation();
              setStatus(opt.value);
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted',
              statusV2 === opt.value && 'bg-muted',
            )}
            data-track-category='Tickets'
            data-track-name='SelectRowStatus'
          >
            {opt.icon}
            <span className='text-foreground'>{opt.label}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

export function DueDatePicker({
  ticketId,
  eta,
  statusV2,
  display,
}: {
  ticketId: string;
  eta: Ticket['eta'];
  statusV2: Ticket['statusV2'];
  display: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const zero = useZero();

  // The server rejects an eta in the past — midnight, so today itself stays pickable.
  const startOfToday = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }, []);

  const trigger = (
    <button
      type='button'
      onClick={e => {
        e.stopPropagation();
        setOpen(prev => !prev);
      }}
      onKeyDown={e => e.stopPropagation()}
      title='Change due date'
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs hover:bg-muted',
        isEtaUrgent(eta, statusV2)
          ? 'border-red-500/40 text-red-500'
          : 'border-border text-muted-foreground',
      )}
      aria-label='Change due date'
      data-track-category='Tickets'
      data-track-name='ToggleRowDueDate'
    >
      <Calendar className='h-3 w-3' />
      {display}
    </button>
  );

  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      modal
      onCloseAutoFocus={event => event.preventDefault()}
      align='end'
      sideOffset={4}
    >
      <DatePicker
        selectedDate={eta ? new Date(eta) : null}
        minDate={startOfToday}
        onSelect={date => {
          // `ticket.update` has no way to null an eta, so only a picked date applies.
          if (date) {
            void surfaceMutationError(
              zero.mutate(
                mutators.ticket.update({
                  id: ticketId,
                  eta: dueDateToEta(date),
                  updatedAt: Date.now(),
                }),
              ),
              'Failed to update due date',
            );
          }
          setOpen(false);
        }}
        isInitialOpen={true}
      />
    </Popover>
  );
}

export function LabelPicker({
  ticket,
  tags,
  availableTags,
  children,
}: {
  ticket: Ticket;
  tags: TicketTag[];
  availableTags: string[];
  children: React.ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const zero = useZero();

  const currentNames = useMemo(() => new Set(tags.map(tag => tag.name)), [tags]);
  // A row can carry a tag that's no longer in the project list — keep it toggleable.
  const allNames = useMemo(
    () => Array.from(new Set([...availableTags, ...tags.map(tag => tag.name)])).sort(),
    [availableTags, tags],
  );

  const toggle = (name: string): void => {
    const existing = tags.find(tag => tag.name === name);
    if (existing?.id) {
      void surfaceMutationError(
        zero.mutate(mutators.ticketTagV2.delete({ tagId: existing.id, mappingId: existing.id })),
        'Failed to remove tag',
      );
    } else {
      void surfaceMutationError(
        zero.mutate(
          mutators.ticketTagV2.create({
            ticketId: ticket.id,
            tagId: uuidv4(),
            projectTagId: uuidv4(),
            mappingId: uuidv4(),
            projectId: ticket.projectId,
            tagName: name,
          }),
        ),
        'Failed to add tag',
      );
    }
  };

  if (allNames.length === 0) return <>{children}</>;

  const trigger = (
    <button
      type='button'
      onClick={e => {
        e.stopPropagation();
        setOpen(prev => !prev);
      }}
      onKeyDown={e => e.stopPropagation()}
      title='Edit labels'
      className='inline-flex items-center gap-2 rounded-md hover:bg-muted'
      aria-label='Edit labels'
      data-track-category='Tickets'
      data-track-name='ToggleRowLabels'
    >
      {children}
    </button>
  );

  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      modal
      onCloseAutoFocus={event => event.preventDefault()}
      align='end'
      sideOffset={4}
      className='p-1 w-48 max-h-64 overflow-y-auto'
    >
      <div className='flex flex-col'>
        {allNames.map(name => (
          <button
            key={name}
            type='button'
            onClick={e => {
              e.stopPropagation();
              toggle(name);
            }}
            className='flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted'
            data-track-category='Tickets'
            data-track-name='ToggleRowLabel'
          >
            <span className='h-1.5 w-1.5 flex-shrink-0 rounded-full bg-xyne-purple-400' />
            <span className='flex-1 truncate text-foreground'>{name}</span>
            {currentNames.has(name) && <Check className='h-3 w-3 text-muted-foreground' />}
          </button>
        ))}
      </div>
    </Popover>
  );
}
