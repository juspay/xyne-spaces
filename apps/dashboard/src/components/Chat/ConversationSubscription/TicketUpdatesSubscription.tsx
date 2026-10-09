import React from 'react';
import { v4 as uuidv4 } from 'uuid';
import { NotificationBellOn, NotificationBellOff } from '@xyne/icons';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { DropdownMenuItem } from '../../ui/dropdown-menu';
import { useIsTicketStakeholder } from './useIsTicketStakeholder';

const UNSUBSCRIBE_LABEL = 'Unsubscribe from ticket updates';
const SUBSCRIBE_LABEL = 'Subscribe to ticket updates';

interface TicketUpdatesSubscriptionProps {
  conversationId: string;
  ticketId: string;
  participant: { ticketUpdatesUnsubscribedAt?: number | null } | null | undefined;
}

export const TicketUpdatesSubscription = ({
  conversationId,
  ticketId,
  participant,
}: TicketUpdatesSubscriptionProps): React.JSX.Element | null => {
  const zero = useZero();
  const { isStakeholder, isResolving } = useIsTicketStakeholder(ticketId, true);
  const isUnsubscribed = Boolean(participant?.ticketUpdatesUnsubscribedAt);

  if (participant === undefined || isResolving || (!isStakeholder && !isUnsubscribed)) return null;

  const label = isUnsubscribed ? SUBSCRIBE_LABEL : UNSUBSCRIBE_LABEL;

  return (
    <DropdownMenuItem className='p-0' onSelect={e => e.preventDefault()}>
      <button
        type='button'
        onClick={() => {
          void zero.mutate(
            mutators.conversations.setTicketUpdatesSubscription({
              conversationId,
              subscribed: isUnsubscribed,
              timestamp: Date.now(),
              participantId: uuidv4(),
            }),
          );
        }}
        className='flex items-center w-full px-2 py-1.5 text-foreground'
        title={label}
        data-track-category='TICKET_UPDATES_SUBSCRIPTION'
        data-track-name='TOGGLE_TICKET_UPDATES'
      >
        <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
          {isUnsubscribed ? <NotificationBellOn size={16} /> : <NotificationBellOff size={16} />}
        </span>
        <span className='relative inline-flex whitespace-nowrap'>
          <span className='invisible' aria-hidden='true'>
            {UNSUBSCRIBE_LABEL}
          </span>
          <span className='absolute inset-0 flex items-center'>{label}</span>
        </span>
      </button>
    </DropdownMenuItem>
  );
};
