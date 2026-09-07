import React, { ReactElement } from 'react';
import type { SdlcCallLink } from '@xyne/shared';
import { PhoneDefault, PhoneCancel } from '@xyne/icons';
import { useCallActions } from '../../../hooks/useCallActions';
import { cn } from '../../../utils/classNames';
import Tooltip from '../../ui/Tooltip';
import { ShortcutHint } from '../../ui/ShortcutHint';
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
  sdlcLink?: SdlcCallLink | undefined; // Optional: SDLC entity to link the call to
  isMember: boolean; // Whether the current user is a member of the channel
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
  sdlcLink,
  isMember,
}) => {
  const {
    handleCallClick,
    hasActiveCallInChannel,
    isUserInCurrentChannelCall,
    isInCall,
    isUserInChannelCallElsewhere,
  } = useCallActions({
    channelId,
    targetUserIds,
    callDisplayName,
    conversationId,
    sdlcLink,
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
  const usesCustomTriggerStyle = Boolean(className?.trim());

  // Check if user is alone in the channel
  const isAlone = participantCount === 1;

  // Check if user is not a member of the channel
  const isNotMember = !isMember;

  // Determine tooltip content based on call state
  const tooltipContent = isNotMember
    ? 'You need to be a part of the channel to start a call'
    : isAlone
      ? 'You are the only one here'
      : hasActiveCallInChannel
        ? isUserInCurrentChannelCall
          ? 'Leave call'
          : isUserInChannelCallElsewhere
            ? 'Switch'
            : 'Join ongoing call'
        : isInCall
          ? 'End current call and start new one'
          : 'Start audio call';

  // Default Button trigger
  return (
    <>
      <Tooltip
        content={
          isAlone || isNotMember ? (
            tooltipContent
          ) : (
            <span className='flex items-center gap-2'>
              {tooltipContent}
              <ShortcutHint shortcut='huddle.toggle' />
            </span>
          )
        }
        side='left'
      >
        <button
          onClick={handleButtonClick}
          disabled={isAlone || isNotMember}
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
            'flex items-center justify-center transition-colors',
            // Desktop default: matches the other header action buttons (28px ghost)
            !isMobile &&
              !usesCustomTriggerStyle &&
              'h-7 w-7 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground',
            // Desktop custom trigger: keep the bordered pill
            !isMobile &&
              usesCustomTriggerStyle &&
              'h-full w-full p-2 border border-border rounded-lg bg-background hover:bg-muted',
            // Mobile: floating rounded button
            isMobile && 'h-full w-8.5 p-2 border',
            isMobile &&
              (usesCustomTriggerStyle
                ? 'w-full rounded-full'
                : 'p-3 rounded-full border-border bg-background shadow-sm hover:bg-accent'),
            // Active call in channel (started by someone else): green filled
            hasActiveCallInChannel &&
              !isUserInCurrentChannelCall &&
              !isMobile &&
              // hover:text-background pins the glyph against the default
              // branch's hover:text-foreground (twMerge: last one wins).
              'bg-status-success text-background hover:text-background hover:opacity-90 border border-status-success',
            isAlone || isNotMember ? 'opacity-50 cursor-not-allowed' : '',
            className,
          )}
        >
          {isUserInCurrentChannelCall ? (
            <PhoneCancel
              size={16}
              className={cn(
                isMobile && '!h-6 !w-6',
                !usesCustomTriggerStyle && isMobile ? 'text-foreground' : 'text-destructive',
              )}
            />
          ) : (
            <PhoneDefault size={16} className={cn(isMobile && '!h-6 !w-6')} />
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
