import { createReactStyleSpec } from '@blocknote/react';
import { CircleHelp, Clock3, Flag, UserRound } from 'lucide-react';
import { useCallback, useRef, useState, type ReactElement } from 'react';

import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useUser } from '../../../hooks/useUsers';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { queries } from '../../../zero/queries';
import Avatar from '../../ui/Avatar/Avatar';
import { HoverCard } from '../../ui/HoverCard/HoverCard';

export const CANVAS_TICKET_ATTR = 'data-canvas-ticket-id';
export const CANVAS_TICKET_SELECTOR = `[${CANVAS_TICKET_ATTR}]`;

interface CanvasTicketAnchorProps {
  ticketId: string;
  contentRef: (element: HTMLElement | null) => void;
}

const formatTicketStatus = (status: string | null | undefined): string => {
  if (!status) return 'No status';
  return status
    .toLowerCase()
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

function CanvasTicketAnchor({ ticketId, contentRef }: CanvasTicketAnchorProps): ReactElement {
  const [ticket, ticketDetails] = useCachedQuery(queries.ticketRowById({ ticketId }), {
    enabled: Boolean(ticketId),
  });
  const assignedUser = useUser(ticket?.assignedTo ?? '');
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const contentElementRef = useRef<HTMLElement | null>(null);
  const [previewText, setPreviewText] = useState('');
  const statusLabel = ticket?.stageName?.trim() || formatTicketStatus(ticket?.statusV2);
  const isUnavailable = ticketDetails.type === 'complete' && !ticket;
  const assigneeLabel = ticket?.assignedTo
    ? assignedUser
      ? getUserDisplayName(assignedUser)
      : 'Assigned'
    : 'Unassigned';
  const priorityLabel = ticket?.priority ? formatTicketStatus(ticket.priority) : 'No priority';

  const setContentElement = useCallback(
    (element: HTMLElement | null): void => {
      contentElementRef.current = element;
      contentRef(element);
    },
    [contentRef],
  );

  const handlePreviewOpenChange = useCallback(
    (open: boolean): void => {
      if (!open) return;
      setPreviewText(contentElementRef.current?.textContent?.trim() || ticket?.title || 'Ticket');
    },
    [ticket?.title],
  );

  const trigger = (
    <span
      ref={anchorRef}
      data-canvas-ticket-id={ticketId}
      data-canvas-ticket-channel-id={ticket?.channelId ?? undefined}
      data-canvas-ticket-conversation-id={ticket?.conversationId ?? undefined}
      data-canvas-ticket-status={ticket?.statusV2 ?? undefined}
      className='canvas-ticket-anchor'
      role='link'
      tabIndex={0}
      aria-label={ticket ? `Open ${ticket.xyneId}: ${ticket.title}` : 'Open ticket'}
    >
      {ticket?.xyneId && (
        <span className='canvas-ticket-anchor__id' contentEditable={false}>
          {ticket.xyneId}
        </span>
      )}
      <span ref={setContentElement} className='canvas-ticket-anchor__text' />
      {ticket && (
        <span className='canvas-ticket-anchor__status' contentEditable={false}>
          <Clock3 aria-hidden='true' />
          <span>{statusLabel}</span>
        </span>
      )}
      {ticket && (
        <span
          className={`canvas-ticket-anchor__assignee${ticket.assignedTo ? '' : ' canvas-ticket-anchor__assignee--unassigned'}`}
          contentEditable={false}
        >
          {ticket.assignedTo ? (
            <Avatar
              userId={ticket.assignedTo}
              size='xs'
              rounded={true}
              showActiveStatus={false}
              className='canvas-ticket-avatar canvas-ticket-anchor__avatar'
            />
          ) : (
            <UserRound aria-label='Unassigned' />
          )}
        </span>
      )}
      {isUnavailable && (
        <span className='canvas-ticket-anchor__unavailable' contentEditable={false}>
          Ticket unavailable
        </span>
      )}
    </span>
  );

  if (!ticket) return trigger;

  return (
    <HoverCard
      trigger={trigger}
      onOpenChange={handlePreviewOpenChange}
      openDelay={180}
      closeDelay={100}
      side='bottom'
      align='start'
      sideOffset={6}
      collisionPadding={12}
      className='w-80 rounded-xl p-3'
    >
      <div className='flex min-w-0 flex-col gap-3' data-canvas-ticket-preview={ticketId}>
        <div className='flex min-w-0 items-center gap-2 text-xs'>
          <span className='font-medium text-primary'>{ticket.xyneId}</span>
          <span className='max-w-32 truncate rounded-full bg-muted px-2 py-0.5 text-muted-foreground'>
            {statusLabel}
          </span>
        </div>

        <p className='m-0 whitespace-normal text-sm font-semibold leading-5 text-foreground'>
          {previewText || ticket.title}
        </p>

        <div className='flex min-w-0 items-center gap-4 text-xs text-muted-foreground'>
          <span className='flex min-w-0 items-center gap-1.5'>
            {ticket.assignedTo ? (
              <Avatar
                userId={ticket.assignedTo}
                size='xs'
                rounded={true}
                showActiveStatus={false}
                className='canvas-ticket-avatar'
              />
            ) : (
              <CircleHelp className='size-4' aria-hidden='true' />
            )}
            <span className='max-w-24 truncate'>{assigneeLabel}</span>
          </span>

          <span className='flex min-w-0 items-center gap-1.5'>
            <Flag className='size-3.5' aria-hidden='true' />
            <span className='max-w-24 truncate'>{priorityLabel}</span>
          </span>

          <button
            type='button'
            className='ml-auto shrink-0 rounded-md border border-border bg-background px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent'
            data-track-category='CANVAS'
            data-track-name='OPEN_CANVAS_TICKET_PREVIEW'
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              anchorRef.current?.click();
            }}
          >
            Open
          </button>
        </div>
      </div>
    </HoverCard>
  );
}

export const canvasTicketStyleSpec = createReactStyleSpec(
  {
    type: 'canvasTicket',
    propSchema: 'string',
  },
  {
    render: ({ value, contentRef }) => (
      <CanvasTicketAnchor ticketId={value} contentRef={contentRef} />
    ),
    runsBefore: [
      'bold',
      'italic',
      'underline',
      'strike',
      'code',
      'textColor',
      'backgroundColor',
      'canvasCommentThread',
    ],
  },
);
