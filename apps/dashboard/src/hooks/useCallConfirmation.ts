import { useState } from 'react';
import { ChannelScopeType } from '@xyne/shared';
import { posthogService, EVENTS, EVENT_PROPERTIES } from '../services/Analytics/posthogService';

interface CallConfirmationState {
  title: string;
  subtitle: string;
  description?: string;
}

interface UseCallConfirmationParams {
  scopeType?: ChannelScopeType | undefined;
  channelName?: string | undefined;
  participantCount?: number | undefined;
  hasActiveCallInChannel: boolean;
  isUserInCurrentChannelCall: boolean;
  isInCall: boolean;
  onlyShowSwitchModal?: boolean;
}

interface UseCallConfirmationReturn {
  showConfirmModal: boolean;
  modalContent: CallConfirmationState;
  handleCallAction: (onProceed: () => void) => void;
  handleConfirmCall: (onProceed: () => void) => void;
  closeModal: () => void;
}

/**
 * Centralized hook for managing call confirmation logic
 *
 * This hook handles all the decision logic for when to show confirmation modals
 * before starting/joining a call. It considers:
 * - Whether the user is already in a call
 * - Whether there's an active call in the target channel
 * - Whether it's a channel vs DM call
 * - The appropriate messaging for each scenario
 *
 * @example
 * ```tsx
 * const { showConfirmModal, modalContent, handleCallAction, handleConfirmCall, closeModal } =
 *   useCallConfirmation({
 *     scopeType: channel.scopeType,
 *     channelName: displayName,
 *     participantCount: channel.participantCount,
 *     hasActiveCallInChannel,
 *     isUserInCurrentChannelCall,
 *     isInCall,
 *   });
 *
 * // In your button click handler:
 * handleCallAction(handleCallClick);
 * ```
 */
export const useCallConfirmation = ({
  scopeType,
  channelName,
  hasActiveCallInChannel,
  isUserInCurrentChannelCall,
  isInCall,
  onlyShowSwitchModal = false,
}: UseCallConfirmationParams): UseCallConfirmationReturn => {
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [modalContent, setModalContent] = useState<CallConfirmationState>({
    title: '',
    subtitle: '',
  });

  /**
   * Main decision logic for call actions
   * Determines whether to proceed directly or show a confirmation modal
   */
  const handleCallAction = (onProceed: () => void): void => {
    const isChannel = scopeType === ChannelScopeType.DEFAULT;
    const isUserInAnyCall = isInCall;

    // Case 1: joining an existing call - proceed directly (no confirmation)
    if (hasActiveCallInChannel && !isUserInAnyCall) {
      posthogService.capture(EVENTS.INITIATE_ACTION, {
        type: EVENT_PROPERTIES.ACTION_TYPES.START_CALL,
      });
      onProceed();
      return;
    }

    // Case 2: User is leaving their call
    if (isUserInCurrentChannelCall) {
      posthogService.capture(EVENTS.INITIATE_ACTION, {
        type: EVENT_PROPERTIES.ACTION_TYPES.END_CALL,
      });
      onProceed();
      return;
    }

    // Case 3: User is initiating a NEW call in a channel while not in any call - show confirmation
    if (isChannel && !isUserInAnyCall && !onlyShowSwitchModal) {
      setModalContent({
        title: `Start a call in this channel?`,
        subtitle: `You'll be starting a call that all members of # ${channelName || 'this channel'} can join.`,
      });
      setShowConfirmModal(true);
      return;
    }

    // Case 4: User is in another call and initiating a NEW call - show confirmation with different message
    if (isUserInAnyCall) {
      const subtitle = isChannel
        ? `You're already in a call. Would you like to leave it and join a new call in # ${channelName || 'this channel'} instead?`
        : `You're already in a call. Would you like to leave it and join a new call instead?`;

      setModalContent({
        title: 'Switch to a new call?',
        subtitle,
      });
      setShowConfirmModal(true);
      return;
    }

    // Case 5: DM call when not in any call - proceed directly
    posthogService.capture(EVENTS.INITIATE_ACTION, {
      type: EVENT_PROPERTIES.ACTION_TYPES.START_CALL,
    });
    onProceed();
  };

  /**
   * Handle confirmation from the modal
   * Tracks analytics and proceeds with the call action
   */
  const handleConfirmCall = (onProceed: () => void): void => {
    setShowConfirmModal(false);
    posthogService.capture(EVENTS.INITIATE_ACTION, {
      type: EVENT_PROPERTIES.ACTION_TYPES.START_CALL,
    });
    onProceed();
  };

  /**
   * Close the confirmation modal without taking action
   */
  const closeModal = (): void => {
    setShowConfirmModal(false);
  };

  return {
    showConfirmModal,
    modalContent,
    handleCallAction,
    handleConfirmCall,
    closeModal,
  };
};
