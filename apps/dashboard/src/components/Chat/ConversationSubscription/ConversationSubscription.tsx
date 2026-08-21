import { logger, Event as LogEvent } from '../../../utils/logger';
import React, { useState } from 'react';
import { NotificationBellOn, NotificationBellOff } from '@xyne/icons';
import { useQuery } from '../../../hooks/useQuery';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { v4 as uuidv4 } from 'uuid';
import { ConversationWithTicket } from '../../ui/MessageBubble/MessageBubble.types';
import { cn } from '../../../utils/classNames';

interface ParticipantData {
  id: string;
  isSubscribed: boolean;
  participationType?: string | null;
}

interface SubscriptionLabelProps {
  text: string;
  sizeClassName?: string;
  toneClassName?: string;
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

const WIDEST_SUBSCRIPTION_LABEL = 'Unsubscribe from notifications';
const LOADING_SUBSCRIPTION_LABEL = 'Loading…';

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

    const isResolving =
      participantProp === undefined &&
      variant !== 'lazy-icon' &&
      participantDetails.type !== 'complete';

    if (participantProp === undefined && variant !== 'lazy-icon' && !shouldFetch) return null;

    const isSubscribed = participant?.isSubscribed ?? false;
    const participationType = participant?.participationType;
    const subscriptionLabel = isResolving
      ? LOADING_SUBSCRIPTION_LABEL
      : isSubscribed
        ? WIDEST_SUBSCRIPTION_LABEL
        : 'Subscribe to notifications';
    const showBellOn = isResolving || !isSubscribed;

    const handleToggleSubscription = () => {
      const timestamp = Date.now();

      logger.info(LogEvent.INFO, {
        type: 'migrated_console_log',
        message: String('[ConversationSubscription] Toggle clicked:'),
        context: [
          {
            conversationId,
            currentState: isSubscribed ? 'SUBSCRIBED' : 'UNSUBSCRIBED',
            action: isSubscribed ? 'UNSUBSCRIBE' : 'SUBSCRIBE',
            participationType,
            timestamp,
          },
        ],
      });

      if (isSubscribed) {
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String('[ConversationSubscription] Calling unsubscribeFromConversation mutator'),
        });
        void zero.mutate(
          mutators.conversations.unsubscribeFromConversation({
            conversationId,
          }),
        );
      } else {
        logger.info(LogEvent.INFO, {
          type: 'migrated_console_log',
          message: String('[ConversationSubscription] Calling subscribeToConversation mutator'),
        });
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
            <NotificationBellOn size={16} className='text-primary' />
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
          disabled={isResolving}
          aria-busy={isResolving}
          className={`flex items-center w-full text-foreground ${className}`}
          title={isSubscribed ? 'Unsubscribe from notifications' : 'Subscribe to notifications'}
          aria-label={isSubscribed ? 'Unsubscribe from conversation' : 'Subscribe to conversation'}
          data-track-category='CONVERSATION_SUBSCRIPTION'
          data-track-name='TOGGLE_SUBSCRIPTION_DROPDOWN'
        >
          <span className='w-4 h-4 mr-2 flex items-center justify-center text-muted-foreground'>
            {showBellOn ? <NotificationBellOn size={16} /> : <NotificationBellOff size={16} />}
          </span>
          <SubscriptionLabel
            text={subscriptionLabel}
            {...(isResolving && { toneClassName: 'text-muted-foreground' })}
          />
        </button>
      );
    }

    return (
      <button
        ref={ref}
        onClick={handleToggleSubscription}
        disabled={isResolving}
        aria-busy={isResolving}
        className={`flex items-center gap-2 px-3 py-2 rounded hover:bg-accent transition-colors ${className}`}
        title={isSubscribed ? 'Unsubscribe from notifications' : 'Subscribe to notifications'}
        aria-label={isSubscribed ? 'Unsubscribe from conversation' : 'Subscribe to conversation'}
        data-track-category='CONVERSATION_SUBSCRIPTION'
        data-track-name='TOGGLE_SUBSCRIPTION_BUTTON'
      >
        {showBellOn ? (
          <NotificationBellOn
            size={16}
            className={cn(isResolving || isSubscribed ? 'text-muted-foreground' : 'text-primary')}
          />
        ) : (
          <NotificationBellOff size={16} className='text-muted-foreground' />
        )}
        <SubscriptionLabel
          text={subscriptionLabel}
          sizeClassName='text-sm'
          {...(!isSubscribed && { toneClassName: 'text-muted-foreground' })}
        />
      </button>
    );
  },
);

ConversationSubscription.displayName = 'ConversationSubscription';

const SubscriptionLabel = ({
  text,
  sizeClassName,
  toneClassName,
}: SubscriptionLabelProps): React.JSX.Element => (
  <span className={cn('relative inline-flex whitespace-nowrap', sizeClassName)}>
    <span className='invisible' aria-hidden='true'>
      {WIDEST_SUBSCRIPTION_LABEL}
    </span>
    <span className={cn('absolute inset-0 flex items-center', toneClassName)}>{text}</span>
  </span>
);
