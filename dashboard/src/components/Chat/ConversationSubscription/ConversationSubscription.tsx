import React, { useState } from 'react';
import { NotificationBellOn, NotificationBellOff } from '@xyne/icons';
import { useQuery } from '../../../hooks/useQuery';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { v4 as uuidv4 } from 'uuid';
import { ConversationWithTicket } from '../../ui/MessageBubble/MessageBubble.types';

interface ParticipantData {
  id: string;
  isSubscribed: boolean;
  participationType?: string | null;
}

interface ConversationSubscriptionProps {
  conversationId: string;
  conversation?: ConversationWithTicket;
  /** When provided, skips the separate participant query (data comes from parent's combined query) */
  participant?: ParticipantData | null;
  variant?: 'icon-only' | 'full' | 'dropdown' | 'lazy-icon';
  className?: string;
  menuOpen?: boolean;
}

export const ConversationSubscription = React.forwardRef<
  HTMLButtonElement,
  ConversationSubscriptionProps
>(
  (
    {
      conversationId,
      participant: participantProp,
      variant = 'icon-only',
      className = '',
      menuOpen,
    },
    ref,
  ) => {
    const zero = useZero();
    const [activated, setActivated] = useState(false);

    // Query is only enabled when participant is NOT provided from parent
    const shouldFetch =
      participantProp !== undefined
        ? false
        : variant === 'lazy-icon'
          ? activated
          : variant === 'dropdown' || variant === 'full'
            ? menuOpen === true
            : true;

    const [queriedParticipant, participantDetails] = useQuery(
      queries.conversationParticipantByConversationId({ conversationId }),
      { enabled: shouldFetch },
    );

    const participant = participantProp !== undefined ? participantProp : queriedParticipant;

    if (participantProp === undefined && variant !== 'lazy-icon') {
      if (!shouldFetch) return null;
      if (participantDetails.type !== 'complete') return null;
    }

    const isSubscribed = participant?.isSubscribed ?? false;
    const participationType = participant?.participationType;

    const handleToggleSubscription = () => {
      const timestamp = Date.now();

      console.log('[ConversationSubscription] Toggle clicked:', {
        conversationId,
        currentState: isSubscribed ? 'SUBSCRIBED' : 'UNSUBSCRIBED',
        action: isSubscribed ? 'UNSUBSCRIBE' : 'SUBSCRIBE',
        participationType,
        timestamp,
      });

      if (isSubscribed) {
        console.log('[ConversationSubscription] Calling unsubscribeFromConversation mutator');
        void zero.mutate(
          mutators.conversations.unsubscribeFromConversation({
            conversationId,
          }),
        );
      } else {
        console.log('[ConversationSubscription] Calling subscribeToConversation mutator');
        void zero.mutate(
          mutators.conversations.subscribeToConversation({
            conversationId,
            timestamp,
            participantId: uuidv4(),
          }),
        );
      }
    };

    if (variant === 'icon-only' || variant === 'lazy-icon') {
      const handleClick = () => {
        if (variant === 'lazy-icon' && !activated) {
          setActivated(true);
          return; // First click activates the query; next click toggles
        }
        handleToggleSubscription();
      };

      return (
        <button
          ref={ref}
          onClick={handleClick}
          className={`text-foreground ${className}`}
          title={
            isSubscribed
              ? 'Subscribed • Click to unsubscribe from notifications'
              : 'Not subscribed • Click to subscribe to notifications'
          }
          aria-label={isSubscribed ? 'Unsubscribe from conversation' : 'Subscribe to conversation'}
          data-track-category='CONVERSATION_SUBSCRIPTION'
          data-track-name='TOGGLE_SUBSCRIPTION_ICON'
        >
          {isSubscribed ? (
            <NotificationBellOn size={16} className='text-sidebar-badge-accent' />
          ) : (
            <NotificationBellOff size={16} className='text-muted-foreground' />
          )}
        </button>
      );
    }

    if (variant === 'dropdown') {
      return (
        <button
          ref={ref}
          onClick={handleToggleSubscription}
          className={`flex items-center w-full text-foreground ${className}`}
          title={isSubscribed ? 'Unsubscribe from notifications' : 'Subscribe to notifications'}
          aria-label={isSubscribed ? 'Unsubscribe from conversation' : 'Subscribe to conversation'}
          data-track-category='CONVERSATION_SUBSCRIPTION'
          data-track-name='TOGGLE_SUBSCRIPTION_DROPDOWN'
        >
          <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
            {isSubscribed ? <NotificationBellOff size={16} /> : <NotificationBellOn size={16} />}
          </span>
          {isSubscribed ? 'Unsubscribe from notifications' : 'Subscribe to notifications'}
        </button>
      );
    }

    return (
      <button
        ref={ref}
        onClick={handleToggleSubscription}
        className={`flex items-center gap-2 px-3 py-2 rounded hover:bg-accent transition-colors ${className}`}
        title={isSubscribed ? 'Unsubscribe from notifications' : 'Subscribe to notifications'}
        aria-label={isSubscribed ? 'Unsubscribe from conversation' : 'Subscribe to conversation'}
        data-track-category='CONVERSATION_SUBSCRIPTION'
        data-track-name='TOGGLE_SUBSCRIPTION_BUTTON'
      >
        {isSubscribed ? (
          <>
            <NotificationBellOff size={16} className='text-muted-foreground' />
            <span className='text-sm'>Unsubscribe from notifications</span>
          </>
        ) : (
          <>
            <NotificationBellOn size={16} className='text-sidebar-badge-accent' />
            <span className='text-sm text-muted-foreground'>Subscribe to notifications</span>
          </>
        )}
      </button>
    );
  },
);

ConversationSubscription.displayName = 'ConversationSubscription';
