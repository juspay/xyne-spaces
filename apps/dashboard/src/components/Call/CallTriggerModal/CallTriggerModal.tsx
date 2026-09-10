import React, { useMemo, useState } from 'react';
import type { SdlcCallLink } from '@xyne/shared';
import { Headphones, ChevronDown } from '@xyne/icons';
import { Popover } from '../../ui/Popover/Popover';
import { Drawer } from '../../ui/Drawer/Drawer';

import { cn } from '../../../utils/classNames';
import { ChannelScopeType } from '@xyne/shared';
import { CallTrigger } from '../CallTrigger/CallTrigger';
import { useSelector } from '@xstate/react';
import { roomActor } from '../../../machines/roomMachine';
import { Badge } from '../../ui/Badge/Badge';
import { useCallActions } from '../../../hooks/useCallActions';
import { CallConfirmationModal } from '../CallConfirmationModal';
import { useCallConfirmation } from '../../../hooks/useCallConfirmation';
import { useCallJoinOrInitiate } from '../../../hooks/useCallJoinOrInitiate';
import { usePlatform } from '../../../hooks/usePlatform';
import { CallCard } from './CallCard';
import { CallOrigin, InvitationResponse } from '@xyne/shared';

interface CallParticipant {
  userId: string;
  response?: InvitationResponse | null;
}

export interface CallData {
  externalId?: string;
  createdByUserId?: string;
  channelId?: string;
  startedAt?: number;
  participantCount?: number | null;
  participantPreviewUserIds?: string | null;
  participants?: readonly CallParticipant[];
  callOrigin?: CallOrigin;
  // Every call's metadata carries the conversationId of the message it posted
  // into (the thread's own conversation for a thread call, a fresh one for a
  // channel call) — see callRepository.createCallWithParticipantsAndMessage.
  metadata?: { conversationId?: string } | null;
}

interface CallTriggerModalProps {
  channelId: string;
  targetUserIds?: string[];
  scopeType?: ChannelScopeType;
  channelName?: string;
  participantCount?: number;
  callDisplayName?: string;
  className?: string;
  disabled?: boolean;
  isMember: boolean;
  sdlcLink?: SdlcCallLink | undefined; // Optional: SDLC entity to link started calls to
}

export const CallTriggerModal: React.FC<CallTriggerModalProps> = ({
  channelId,
  targetUserIds,
  scopeType,
  channelName,
  participantCount,
  callDisplayName,
  className,
  disabled = false,
  isMember,
  sdlcLink,
}) => {
  const { isMobile } = usePlatform();
  const usesCustomTriggerStyle = Boolean(className?.trim());

  const { hasActiveCallInChannel, isUserInCurrentChannelCall, isInCall } = useCallActions({
    channelId,
    targetUserIds,
    callDisplayName,
    sdlcLink,
  });

  // Use the new hook for initiating calls
  const { initiateCall, joinCall } = useCallJoinOrInitiate();

  // Use call confirmation hook (same as CallTrigger)
  const { showConfirmModal, modalContent, handleCallAction, handleConfirmCall, closeModal } =
    useCallConfirmation({
      scopeType,
      channelName,
      participantCount,
      hasActiveCallInChannel,
      isUserInCurrentChannelCall,
      isInCall,
    });

  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);
  const currentCallId = useSelector(roomActor, state => state.context.externalId);

  const validActiveCalls = useMemo(
    () =>
      activeCalls && Array.isArray(activeCalls)
        ? (activeCalls as CallData[]).filter(call => call.channelId === channelId)
        : [],
    [activeCalls, channelId],
  );

  const hasActiveCalls = validActiveCalls.length > 0;

  const currentCallData = useMemo((): CallData | null => {
    if (!currentCallId) return null;
    return validActiveCalls.find(call => call.externalId === currentCallId) || null;
  }, [currentCallId, validActiveCalls]);

  const liveCalls = useMemo(
    () => validActiveCalls.filter(call => call.externalId !== currentCallId),
    [validActiveCalls, currentCallId],
  );

  const hasChannelCall = useMemo(
    () => validActiveCalls.some(call => call.callOrigin !== CallOrigin.CONVERSATION),
    [validActiveCalls],
  );

  const [isOpen, setIsOpen] = useState(false);
  const handleClose = (): void => setIsOpen(false);
  const handleOpenChange = (open: boolean): void => setIsOpen(open);

  const handleInitiateCall = (): void => {
    initiateCall({
      channelId,
      ...(targetUserIds && { targetUserIds }),
      ...(callDisplayName && { callDisplayName }),
      ...(sdlcLink && { sdlcLink }),
      onComplete: handleClose,
    });
  };

  const triggerButton = (
    <button
      disabled={disabled}
      className={cn(
        'h-full transition-colors rounded-lg w-8.5 !p-2',
        usesCustomTriggerStyle && 'w-full',
        !usesCustomTriggerStyle && 'bg-primary',
        'flex items-center justify-center gap-2',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
        className,
      )}
    >
      <Headphones
        className={cn(
          'h-4 w-4',
          isMobile && '!w-6',
          !usesCustomTriggerStyle && (isMobile ? 'text-foreground' : 'text-background'),
        )}
      />
      {!isMobile && hasActiveCalls && (
        <Badge className='bg-background text-primary'>{validActiveCalls.length}</Badge>
      )}
      {!isMobile && <div className='h-4 w-px bg-muted-foreground/50' />}
      {!isMobile && (
        <ChevronDown className={cn('w-4 h-4', !usesCustomTriggerStyle && 'text-background')} />
      )}
    </button>
  );

  if (!hasActiveCalls || (validActiveCalls.length === 1 && hasChannelCall && !isMobile)) {
    if (disabled) return null;
    return (
      <CallTrigger
        channelId={channelId}
        targetUserIds={targetUserIds}
        scopeType={scopeType}
        channelName={channelName}
        participantCount={participantCount}
        isMember={isMember}
        sdlcLink={sdlcLink}
        {...(className ? { className } : {})}
        {...(callDisplayName && { callDisplayName })}
      />
    );
  }

  const content = (
    <div className={cn('flex flex-col pb-2', isMobile ? 'pt-4' : '')}>
      <div>
        {currentCallData && (isMobile ? hasChannelCall && validActiveCalls.length === 1 : true) && (
          <CallCard
            call={currentCallData}
            currentCallId={currentCallId}
            onActionClick={handleClose}
            isMobileLiveCall={isMobile && hasChannelCall && validActiveCalls.length === 1}
            joinCall={joinCall}
            isInCall={isInCall}
          />
        )}
      </div>
      {liveCalls.length > 0 && (
        <div>
          <div
            className={cn(
              'text-xs font-medium text-muted-foreground p-6 pb-2 font-mono',
              isMobile ? '!pt-2' : '',
            )}
          >
            Live Calls
          </div>
          <div>
            {liveCalls.map(call => (
              <CallCard
                key={call.externalId}
                call={call}
                currentCallId={currentCallId}
                onActionClick={handleClose}
                joinCall={joinCall}
                isInCall={isInCall}
              />
            ))}
          </div>
        </div>
      )}
      {!hasChannelCall && (
        <div>
          <div
            className={cn(
              'text-xs font-medium text-muted-foreground p-6 pb-2 font-mono',
              isMobile && validActiveCalls.length === 1 && currentCallData ? '!pt-2' : '',
            )}
          >
            Other Options
          </div>
          <button
            className='flex items-center gap-3 w-full h-auto justify-start px-6 py-4 rounded-lg hover:bg-muted transition-colors'
            onClick={() => handleCallAction(handleInitiateCall)}
            data-track-category='CALLS'
            data-ph-capture-attribute-track-id='start_call_now'
            data-track-name='StartCallNow'
            data-track-metadata={JSON.stringify({ channelId, targetUserIds })}
          >
            <div className='rounded-md bg-border p-2'>
              <Headphones className='w-5 h-5 text-foreground' />
            </div>
            <span className='text-sm font-semibold text-foreground'>Start call now</span>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {isMobile ? (
        <Drawer
          trigger={triggerButton}
          open={isOpen}
          onOpenChange={handleOpenChange}
          title='Active Calls'
          description='View and manage active calls'
        >
          {content}
        </Drawer>
      ) : (
        <Popover
          trigger={triggerButton}
          side='left'
          sideOffset={-100}
          className='w-auto min-w-[400px] rounded-lg border border-border bg-background shadow-lg p-0 mt-24 z-[1000]'
          open={isOpen}
          onOpenChange={handleOpenChange}
        >
          {content}
        </Popover>
      )}
      <CallConfirmationModal
        isOpen={showConfirmModal}
        onClose={closeModal}
        onConfirm={() => handleConfirmCall(handleInitiateCall)}
        title={modalContent.title}
        subtitle={modalContent.subtitle}
        description={modalContent.description}
      />
    </>
  );
};
