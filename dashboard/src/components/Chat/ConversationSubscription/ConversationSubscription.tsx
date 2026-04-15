import React from 'react';
import { Bell, BellOff } from 'lucide-react';
import { useQuery } from '../../../hooks/useQuery';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { v4 as uuidv4 } from 'uuid';
import { ConversationWithTicket } from '../../ui/MessageBubble/MessageBubble.types';

interface ConversationSubscriptionProps {
  conversationId: string;
  conversation?: ConversationWithTicket;
  variant?: 'icon-only' | 'full' | 'dropdown';
  className?: string;
  menuOpen?: boolean;
}

export const ConversationSubscription: React.FC<ConversationSubscriptionProps> = ({
  conversationId,
  variant = 'icon-only',
  className = '',
  menuOpen,
}) => {
  const zero = useZero();

  const shouldFetch = variant === 'dropdown' || variant === 'full' ? menuOpen === true : true;

  const [participant, participantDetails] = useQuery(
    queries.conversationParticipantByConversationId({ conversationId }),
    { enabled: shouldFetch },
  );

  if (!shouldFetch) return null;
  if (participantDetails.type !== 'complete') return null;

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

  if (variant === 'icon-only') {
    return (
      <button
        onClick={handleToggleSubscription}
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
          <Bell className='w-4 h-4 fill-blue-600 stroke-blue-600' />
        ) : (
          <BellOff className='w-4 h-4 stroke-current' />
        )}
      </button>
    );
  }

  if (variant === 'dropdown') {
    return (
      <button
        onClick={handleToggleSubscription}
        className={`flex items-center w-full text-foreground ${className}`}
        title={isSubscribed ? 'Unsubscribe from notifications' : 'Subscribe to notifications'}
        aria-label={isSubscribed ? 'Unsubscribe from conversation' : 'Subscribe to conversation'}
        data-track-category='CONVERSATION_SUBSCRIPTION'
        data-track-name='TOGGLE_SUBSCRIPTION_DROPDOWN'
      >
        <span className='w-4 h-4 mr-2 flex items-center justify-center'>
          {isSubscribed ? (
            <Bell className='w-4 h-4 fill-blue-600 stroke-blue-600' />
          ) : (
            <BellOff className='w-4 h-4 stroke-current' />
          )}
        </span>
        {isSubscribed ? 'Unsubscribe from notifications' : 'Subscribe to notifications'}
      </button>
    );
  }

  return (
    <button
      onClick={handleToggleSubscription}
      className={`flex items-center gap-2 px-3 py-2 rounded hover:bg-accent transition-colors ${className}`}
      title={isSubscribed ? 'Unsubscribe from notifications' : 'Subscribe to notifications'}
      aria-label={isSubscribed ? 'Unsubscribe from conversation' : 'Subscribe to conversation'}
      data-track-category='CONVERSATION_SUBSCRIPTION'
      data-track-name='TOGGLE_SUBSCRIPTION_BUTTON'
    >
      {isSubscribed ? (
        <>
          <BellOff size={16} className='text-muted-foreground' />
          <span className='text-sm'>Unsubscribe from notifications</span>
        </>
      ) : (
        <>
          <Bell size={16} className='text-blue-600' />
          <span className='text-sm text-muted-foreground'>Subscribe to notifications</span>
        </>
      )}
    </button>
  );
};
