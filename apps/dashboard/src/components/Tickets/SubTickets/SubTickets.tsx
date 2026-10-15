import { Fragment, useLayoutEffect, useRef, type ReactElement } from 'react';
import { ChevronDown, DoubleChevronUp, Spinner, Subtask } from '@xyne/icons';
import Tooltip from '../../ui/Tooltip';
import Avatar from '../../ui/Avatar/Avatar';
import { StagePicker } from '../TicketListView/StagePicker';
import { getPriorityIcon } from '../TicketCard/TicketCard.utils';
import { useTicketNoun } from '../../../contexts/TicketNounContext';
import { usePlatform } from '../../../hooks/usePlatform';
import { resolveAssigneeRef } from '../../../hooks/useTicketAssignee';
import { useUserGroupById } from '../../../hooks/useUserGroup';
import { cn } from '../../../utils/classNames';
import type {
  SubTicketCardProps,
  SubTicketsToggleProps,
  SubTicketsTreeProps,
} from './SubTickets.types';
import { SUB_TICKETS_PAGE_SIZE, isSubTicketDone, subTicketsFooterLabel } from './SubTickets.utils';
import { setSubTicketsShown, useSubTicketsPage, useSubTicketsShown } from './useSubTickets';

const TREE_LINE = 'border-border border-l-[1.5px]';

/** The done/total chip on a ticket with sub-tickets; opens and closes them under it. */
export function SubTicketsToggle({
  ticketId,
  progress,
  className,
}: SubTicketsToggleProps): ReactElement {
  const noun = useTicketNoun();
  const { isMobile } = usePlatform();
  const open = useSubTicketsShown(ticketId) > 0;

  return (
    <Tooltip content={`${progress.done} of ${progress.total} sub-${noun.plural} completed`}>
      <button
        type='button'
        aria-expanded={open}
        aria-label={`${open ? 'Hide' : 'Show'} sub-${noun.plural}`}
        onClick={event => {
          event.stopPropagation();
          setSubTicketsShown(ticketId, open ? 0 : SUB_TICKETS_PAGE_SIZE);
        }}
        // Enter and Space on the chip must not also open the ticket it sits on.
        onKeyDown={event => event.stopPropagation()}
        className={cn(
          'flex h-[22px] flex-shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs tabular-nums transition-colors',
          open
            ? 'border-border bg-muted text-foreground'
            : 'border-transparent text-muted-foreground',
          !isMobile && 'hover:bg-muted hover:text-foreground',
          className,
        )}
        data-track-category='Tickets'
        data-track-name={open ? 'SubTicketsCollapsed' : 'SubTicketsExpanded'}
        data-track-metadata={JSON.stringify({ ticketId })}
      >
        <Subtask className='size-3.5' />
        {progress.done}/{progress.total}
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
      </button>
    </Tooltip>
  );
}

/**
 * A ticket's sub-tickets under it, three at a time. Kanban draws them as small cards on a
 * tree; the list hands each row its connector to place beside the status column.
 */
export function SubTicketsTree(props: SubTicketsTreeProps): ReactElement | null {
  const { ticketId, total, onResize } = props;
  const noun = useTicketNoun();
  const { isMobile } = usePlatform();
  const shown = useSubTicketsShown(ticketId);
  const { items, isComplete } = useSubTicketsPage(ticketId, shown);
  const onResizeRef = useRef(onResize);
  useLayoutEffect(() => {
    onResizeRef.current = onResize;
  });
  const renderedCount = shown === 0 || total === 0 ? 0 : Math.min(items.length, shown);
  // Before paint, so the rows below move in the same frame the tree opens, grows or closes.
  useLayoutEffect(() => {
    onResizeRef.current?.();
  }, [renderedCount, total]);

  if (shown === 0 || total === 0) return null;

  const visible = items.slice(0, shown);
  // Loading only while rows that exist are still missing here, not when the page asks past the end.
  const isLoading = !isComplete && visible.length < Math.min(shown, total);
  const hasFooter = total > SUB_TICKETS_PAGE_SIZE;
  const hasMore = shown < total;
  const actionClass = cn(
    'flex h-6 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-colors',
    !isMobile && 'hover:bg-muted hover:text-foreground',
  );

  const collapseButton = (
    <button
      type='button'
      onClick={event => {
        event.stopPropagation();
        setSubTicketsShown(ticketId, 0);
      }}
      className={cn(actionClass, 'font-normal')}
      data-track-category='Tickets'
      data-track-name='SubTicketsCollapsed'
      data-track-metadata={JSON.stringify({ ticketId })}
    >
      <DoubleChevronUp className='size-3' />
      Collapse
    </button>
  );
  // Everything shown: only the way to close it. While a page loads, its progress stays.
  const footerControls =
    hasMore || isLoading ? (
      <>
        <button
          type='button'
          aria-busy={isLoading}
          onClick={event => {
            event.stopPropagation();
            if (isLoading) return;
            setSubTicketsShown(ticketId, Math.min(shown + SUB_TICKETS_PAGE_SIZE, total));
          }}
          className={actionClass}
          data-track-category='Tickets'
          data-track-name='SubTicketsShowMore'
          data-track-metadata={JSON.stringify({ ticketId })}
        >
          {isLoading ? (
            <Spinner className='size-3 animate-spin' />
          ) : (
            <ChevronDown className='size-3' />
          )}
          {subTicketsFooterLabel(shown, total, isLoading)}
          <span className='font-normal tabular-nums text-muted-foreground/70'>
            {Math.min(visible.length, total)} of {total}
          </span>
        </button>
        <span className='flex-1' />
        {collapseButton}
      </>
    ) : (
      collapseButton
    );

  if (props.layout === 'list') {
    const { renderItem, renderListLine } = props;
    const connector = (continues: boolean): ReactElement => (
      <span aria-hidden className='relative w-5 flex-shrink-0 self-stretch'>
        <span
          className={cn(
            TREE_LINE,
            'absolute -top-px left-[9px] h-[calc(50%+1px)] w-[11px] rounded-bl-md border-b-[1.5px]',
          )}
        />
        {continues && <span className={cn(TREE_LINE, 'absolute -bottom-px left-[9px] top-1/2')} />}
      </span>
    );
    return (
      <div role='group' aria-label={`Sub-${noun.plural}`}>
        {visible.map((item, index) => {
          const line = connector(index < visible.length - 1 || hasFooter);
          return (
            <Fragment key={item.id}>
              {item.ticket
                ? renderItem(item.ticket, line)
                : renderListLine(
                    <span className='min-w-0 truncate text-sm text-muted-foreground'>
                      {item.title}
                    </span>,
                    line,
                    'item',
                  )}
            </Fragment>
          );
        })}
        {hasFooter && renderListLine(footerControls, connector(false), 'footer')}
      </div>
    );
  }

  const { renderItem } = props;
  const branch = (continues: boolean): ReactElement => (
    <>
      <span
        aria-hidden
        className={cn(
          TREE_LINE,
          'absolute -left-[13px] -top-1.5 h-[calc(50%+6px)] w-3 rounded-bl-[7px] border-b-[1.5px]',
        )}
      />
      {continues && (
        <span aria-hidden className={cn(TREE_LINE, 'absolute -bottom-1 -left-[13px] top-1/2')} />
      )}
    </>
  );
  return (
    <div
      role='group'
      aria-label={`Sub-${noun.plural}`}
      className='ml-3 mt-1 flex flex-col gap-1 pl-3.5'
    >
      {visible.map((item, index) => (
        <div key={item.id} className='relative'>
          {branch(index < visible.length - 1 || hasFooter)}
          {item.ticket ? (
            renderItem(item.ticket)
          ) : (
            <div className='truncate rounded-lg border border-dashed border-border px-2.5 py-2 text-[13px] text-muted-foreground'>
              {item.title}
            </div>
          )}
        </div>
      ))}
      {hasFooter && (
        <div className='relative flex h-7 items-center gap-1'>
          {branch(false)}
          {footerControls}
        </div>
      )}
    </div>
  );
}

/** A sub-ticket in a kanban column: the card's key facts, smaller. */
export function SubTicketCard({ ticket, onOpen }: SubTicketCardProps): ReactElement {
  const { isMobile } = usePlatform();
  const { userId, groupId } = resolveAssigneeRef(ticket.assignedTo, ticket.userGroupId);
  const group = useUserGroupById(groupId ?? '');
  const done = isSubTicketDone(ticket);

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={event => {
        event.stopPropagation();
        onOpen(event);
      }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onOpen(event.nativeEvent);
      }}
      className={cn(
        'flex w-full cursor-pointer flex-col gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors',
        !isMobile && 'hover:border-input',
      )}
      data-track-category='Tickets'
      data-track-name='OpenSubTicketCard'
      data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
    >
      <div className='flex min-w-0 items-center gap-2'>
        <span className='font-mono text-[11px] font-medium text-muted-foreground'>
          {ticket.xyneId}
        </span>
        <StagePicker
          ticketId={ticket.id}
          stageName={ticket.stageName}
          stageLabel={ticket.stageName || 'To Do'}
          statusV2={ticket.statusV2}
          boardId={ticket.boardId}
        />
        <span className='flex-1' />
        {getPriorityIcon(ticket.priority)}
      </div>
      <div className='flex min-w-0 items-center gap-2'>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[13px] font-medium',
            done ? 'text-muted-foreground' : 'text-foreground',
          )}
          title={ticket.title ?? ''}
        >
          {ticket.title}
        </span>
        {userId ? (
          <Avatar userId={userId} size='xs' showActiveStatus={false} />
        ) : group ? (
          <span className='flex size-4 items-center justify-center rounded bg-border text-[9px] font-medium text-muted-foreground'>
            {group.name.charAt(0).toUpperCase()}
          </span>
        ) : null}
      </div>
    </div>
  );
}
