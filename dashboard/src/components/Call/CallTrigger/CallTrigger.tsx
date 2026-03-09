import React, { ReactElement } from 'react';
import { PhoneOff } from 'lucide-react';
import { useCallActions } from '../../../hooks/useCallActions';
import { cn } from '../../../utils/classNames';
import HuddleIcon from '../../icons/HuddleIcon';
import Tooltip from '../../ui/Tooltip';
import { ChannelScopeType } from '@xyne/shared';
import { CallConfirmationModal } from '../CallConfirmationModal';
import { useCallConfirmation } from '../../../hooks/useCallConfirmation';
import { useShortcutById } from '../../../shortcuts';
import { usePlatform } from '../../../hooks/usePlatform';

interface CallTriggerProps {
  channelId: string;
  targetUserIds?: string[] | undefined;
  children?: ReactElement;
  className?: string;
  scopeType?: ChannelScopeType | undefined;
  channelName?: string | undefined;
  participantCount?: number | undefined;
  callDisplayName?: string; // Display name for CallKit (DM: participant name, Channel: channel name)
  conversationId?: string; // Optional: for thread-initiated calls
}

/**
 * CallTrigger component
 *
 * A reusable component for triggering calls in a channel.
 * Handles all call logic including joining, leaving, and initiating calls.
 *
 * @param channelId - The ID of the channel for which the call is being triggered
 * @param targetUserIds - Optional array of target user IDs for inviting specific users
 * @param children - Optional custom trigger element. If not provided, uses default Button
 * @param className - Optional additional CSS classes for the trigger
 * @param scopeType - The scope type of the channel (DM, GROUP_DM, DEFAULT, etc.)
 */
export const CallTrigger: React.FC<CallTriggerProps> = ({
  channelId,
  targetUserIds,
  className,
  scopeType,
  channelName,
  participantCount,
  callDisplayName,
  conversationId,
}) => {
  const { handleCallClick, hasActiveCallInChannel, isUserInCurrentChannelCall, isInCall } =
    useCallActions({
      channelId,
      targetUserIds,
      callDisplayName,
      conversationId,
    });

  const { showConfirmModal, modalContent, handleCallAction, handleConfirmCall, closeModal } =
    useCallConfirmation({
      scopeType,
      channelName,
      participantCount,
      hasActiveCallInChannel,
      isUserInCurrentChannelCall,
      isInCall,
    });

  const handleButtonClick = (): void => {
    handleCallAction(handleCallClick);
  };

  // Keyboard shortcut for huddle toggle (Cmd+Shift+H)
  useShortcutById('huddle.toggle', handleButtonClick);

  const { isMobile } = usePlatform();

  // Check if user is alone in the channel
  const isAlone = participantCount === 1;

  // Determine tooltip content based on call state
  const tooltipContent = isAlone
    ? 'You are the only one here'
    : hasActiveCallInChannel
      ? isUserInCurrentChannelCall
        ? 'Leave call'
        : 'Join ongoing call'
      : isInCall
        ? 'End current call and start new one'
        : 'Start audio call';

  // Default Button trigger
  return (
    <>
      <Tooltip content={tooltipContent} side='left'>
        <button
          onClick={handleButtonClick}
          disabled={isAlone}
          data-testid='start-call-button'
          data-track-category='CALLS'
          data-track-name='Call_Trigger'
          data-track-metadata={JSON.stringify({
            hasActiveCall: hasActiveCallInChannel,
            isInCall,
            channelId: channelId,
            targetUserIds,
          })}
          className={cn(
            'h-full transition-colors w-8.5 p-2',
            'border ',
            hasActiveCallInChannel && !isUserInCurrentChannelCall && !isMobile
              ? '!bg-green-500 !hover:bg-green-600 !border-green-500'
              : '',
            isAlone ? 'opacity-50 cursor-not-allowed' : '',
            isMobile
              ? 'p-3 rounded-full border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5]'
              : 'rounded-lg bg-background border-border hover:bg-muted',
            className,
          )}
        >
          {isUserInCurrentChannelCall ? (
            <PhoneOff className={cn('h-4 w-4', isMobile ? 'text-black w-6' : 'text-red-500')} />
          ) : hasActiveCallInChannel && !isUserInCurrentChannelCall ? (
            <HuddleIcon color={isMobile ? 'black' : '#FFFFFF'} />
          ) : (
            <HuddleIcon />
          )}
        </button>
      </Tooltip>

      <CallConfirmationModal
        isOpen={showConfirmModal}
        onClose={closeModal}
        onConfirm={() => handleConfirmCall(handleCallClick)}
        title={modalContent.title}
        subtitle={modalContent.subtitle}
        description={modalContent.description}
      />
    </>
  );
};
