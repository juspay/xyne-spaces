import { X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUsers } from '../../../hooks/useUsers';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import Avatar from '../../ui/Avatar/Avatar';
import Button from '../../ui/Button';
import Dialog from '../../ui/Dialog';
import { EntityMultiSelector } from '../../ui/EntitySelector/EntityMultiSelector';
import { useCallJoinOrInitiate } from '../../../hooks/useCallJoinOrInitiate';
import { useChannel } from '../../../hooks/useChannels';
import { usePlatform } from '../../../hooks/usePlatform';
import { ChannelScopeType } from '@xyne/shared';
import { useAuth } from '../../../hooks/useAuth';
import { getUserDisplayName, isUserDeactivated } from '../../../utils/userDisplayName';
import { rankParticipantOptions } from '../../../utils/participantSearch';

interface InstantCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  conversationId?: string;
  onCallInitiated?: () => void;
}

export const InstantCallModal: React.FC<InstantCallModalProps> = ({
  isOpen,
  onClose,
  channelId,
  conversationId,
  onCallInitiated,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const hasAutoInitiatedRef = useRef(false);
  const hasUserModifiedRef = useRef(false);
  const selectorContainerRef = useRef<HTMLDivElement>(null);
  const selectorInputFocusRef = useRef<HTMLElement | null>(null);
  const { isMobile } = usePlatform();

  // Synchronously discover the EntityMultiSelector's input and assign it
  // to selectorInputFocusRef so Dialog's onOpenAutoFocus can use it.
  const selectorContainerRefCallback = (node: HTMLDivElement | null): void => {
    selectorContainerRef.current = node;
    if (node) {
      const input = node.querySelector('input');
      if (input instanceof HTMLElement) {
        selectorInputFocusRef.current = input;
      }
    }
  };

  const { initiateCall } = useCallJoinOrInitiate();
  const { user: currentUser } = useAuth();
  const channel = useChannel(channelId);
  const [channelParticipants] = useCachedQuery(queries.channelParticipants({ channelId }), {
    enabled: isOpen,
  });
  const [conversation] = useCachedQuery(
    queries.getConversationById({ conversationId: conversationId ?? '' }),
    { enabled: isOpen && !!conversationId },
  );
  const allUsers = useUsers();

  const channelParticipantUserIds = useMemo(() => {
    if (!channelParticipants) return new Set<string>();
    return new Set(channelParticipants.map(p => p.userId));
  }, [channelParticipants]);

  // Filter users to only show those in the current channel, excluding current user
  const channelUsers = useMemo(() => {
    if (!allUsers) return [];
    return allUsers.filter(
      user => channelParticipantUserIds.has(user.id) && user.id !== currentUser?.id,
    );
  }, [allUsers, channelParticipantUserIds, currentUser?.id]);

  // Normalize the channel-member payload before passing it to the shared
  // participant matcher. Some channel members have no email, which the raw
  // `searchUsers` matcher assumes is always present.
  const rankedChannelUsers = useMemo(() => {
    const options = channelUsers.map(user => ({
      ...user,
      label: getUserDisplayName(user),
      value: `user:${user.id}`,
    }));

    return rankParticipantOptions(options, searchQuery);
  }, [channelUsers, searchQuery]);

  const inviteUserOptions = useMemo(
    () =>
      rankedChannelUsers.map(user => ({
        label: user.label,
        value: user.value,
        icon: (
          <Avatar
            userId={user.id}
            size='sm'
            showActiveStatus={false}
            className='rounded-md size-[18px] flex items-center justify-center bg-background'
          />
        ),
        subtitle: user.email,
        isDeactivated: isUserDeactivated(user),
      })),
    [rankedChannelUsers],
  );

  // Get selected users for display
  const selectedUsers = useMemo(() => {
    return selectedParticipants
      .filter(p => p.startsWith('user:'))
      .map(p => {
        const userId = p.replace('user:', '');
        return allUsers?.find(u => u.id === userId);
      })
      .filter((user): user is NonNullable<typeof user> => user !== undefined);
  }, [selectedParticipants, allUsers]);

  const initiateCallWithParticipants = useCallback(
    (targetUserIds: string[]) => {
      initiateCall({
        channelId,
        ...(targetUserIds.length > 0 && { targetUserIds }),
        ...(conversationId && { conversationId }),
        onComplete: () => {
          onCallInitiated?.();
          onClose();
        },
      });
    },
    [channelId, conversationId, initiateCall, onCallInitiated, onClose],
  );

  useEffect(() => {
    if (
      isOpen &&
      channel?.scopeType === ChannelScopeType.DM &&
      channelParticipants &&
      !hasAutoInitiatedRef.current
    ) {
      const targetUserIds = channelParticipants.map(p => p.userId);
      if (currentUser?.id && !targetUserIds.includes(currentUser.id)) {
        targetUserIds.push(currentUser.id);
      }
      hasAutoInitiatedRef.current = true;
      initiateCallWithParticipants(targetUserIds);
    }

    if (!isOpen) {
      hasAutoInitiatedRef.current = false;
      hasUserModifiedRef.current = false;
    }
  }, [
    isOpen,
    channel?.scopeType,
    channelParticipants,
    initiateCallWithParticipants,
    currentUser?.id,
  ]);
  // Pre-populate selected participants with thread participants when conversationId is provided.
  // Uses hasUserModifiedRef instead of a one-shot flag so that Zero cache updates (e.g. a
  // newly-mentioned user being added to participants) are reflected while the modal is open,
  // as long as the user hasn't manually changed the selection themselves.
  // NOTE: Only include participants with a valid participationType (AUTHOR or MENTIONED).
  // Exclude participants with null participationType (users who were auto-added via
  // markActivityAsRead or other side effects but haven't explicitly engaged with the thread).
  useEffect(() => {
    if (
      isOpen &&
      conversationId &&
      conversation?.participants &&
      !hasUserModifiedRef.current &&
      channel?.scopeType !== ChannelScopeType.DM
    ) {
      const threadParticipantIds = conversation.participants
        .filter(p => p.participationType !== null && p.participationType !== undefined)
        .map(p => p.userId)
        .filter(userId => userId !== currentUser?.id);
      const preSelected = threadParticipantIds.map(userId => `user:${userId}`);
      setSelectedParticipants(preSelected);
    }
  }, [isOpen, conversationId, conversation?.participants, currentUser?.id, channel?.scopeType]);

  const handleSubmit = () => {
    const targetUserIds = selectedParticipants
      .filter(p => p.startsWith('user:'))
      .map(p => p.replace('user:', ''));

    if (currentUser?.id && !targetUserIds.includes(currentUser.id)) {
      targetUserIds.push(currentUser.id);
    }

    setSelectedParticipants([]);
    setSearchQuery('');
    initiateCallWithParticipants(targetUserIds);
  };

  const handleClose = () => {
    setSelectedParticipants([]);
    setSearchQuery('');
    hasUserModifiedRef.current = false;
    onClose();
  };

  if (channel?.scopeType === ChannelScopeType.DM) {
    return null;
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => !open && handleClose()}
      className='max-w-[584px] rounded-xl overflow-hidden'
      {...(!isMobile ? { focusRef: selectorInputFocusRef } : {})}
    >
      <div className='flex flex-col w-full'>
        <div className='flex items-start justify-between px-5 py-3.5 border-b border-border h-14'>
          <h2 className='text-[15px] font-semibold text-foreground leading-5'>
            Start an Instant Call
          </h2>
          <Button
            variant='outline'
            size='icon'
            className='size-7 rounded-lg'
            onClick={handleClose}
            data-track-category='CALL_PARTICIPANTS_SELECTION_MODAL'
            data-track-name='CLOSE_PARTICIPANTS_MODAL'
          >
            <X className='size-4' />
          </Button>
        </div>
        <div className='p-5 space-y-5'>
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <p className='text-[#788187] text-[13px] leading-5'>Add Participants</p>
              {selectedUsers.length > 0 && (
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-auto p-0 text-[13px] text-muted-foreground hover:text-foreground'
                  onClick={() => {
                    hasUserModifiedRef.current = true;
                    setSelectedParticipants([]);
                  }}
                  data-track-category='CALL_PARTICIPANTS_SELECTION_MODAL'
                  data-track-name='ClearAllCallParticipants'
                  data-track-metadata={JSON.stringify({
                    count: selectedUsers.length,
                    channelId,
                    conversationId,
                  })}
                >
                  Clear All
                </Button>
              )}
            </div>
            {/* Selected participants list - horizontal with wrap */}
            {selectedUsers.length > 0 && (
              <div className='flex flex-wrap gap-2 mb-3'>
                {selectedUsers.map(user => (
                  <div
                    key={user.id}
                    className='flex items-center gap-1.5 rounded-md bg-muted border border-border px-2 py-1.5'
                  >
                    <Avatar
                      userId={user.id}
                      size='sm'
                      showActiveStatus={false}
                      className='rounded-md flex-shrink-0'
                    />
                    <span className='text-sm font-medium text-foreground whitespace-nowrap'>
                      {getUserDisplayName(user)}
                    </span>
                    <button
                      type='button'
                      onClick={() => {
                        hasUserModifiedRef.current = true;
                        const valueToRemove = `user:${user.id}`;
                        setSelectedParticipants(
                          selectedParticipants.filter(p => p !== valueToRemove),
                        );
                      }}
                      className='text-muted-foreground hover:text-muted-foreground flex-shrink-0'
                      data-track-category='CALL_PARTICIPANTS_SELECTION_MODAL'
                      data-track-name='RemoveCallParticipant'
                      data-track-metadata={JSON.stringify({
                        userId: user.id,
                        channelId,
                        conversationId,
                      })}
                    >
                      <X className='size-4' strokeWidth={2.5} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div ref={selectorContainerRefCallback} className='[&_span]:hidden'>
              <EntityMultiSelector
                options={inviteUserOptions.filter(opt => !selectedParticipants.includes(opt.value))}
                selectedValues={selectedParticipants}
                onMultiSelect={values => {
                  hasUserModifiedRef.current = true;
                  setSelectedParticipants(values);
                }}
                placeholder='Select participants'
                searchPlaceholder='Select participants'
                onSearchChange={setSearchQuery}
                disableClientFiltering
                variant='inline'
                width='100%'
              />
            </div>
          </div>
          <div className='flex items-center justify-between'>
            <Button
              variant='outline'
              size='sm'
              className='rounded-lg text-[13px]'
              onClick={handleClose}
              data-track-category='CALL_PARTICIPANTS_SELECTION_MODAL'
              data-track-name='CANCEL_PARTICIPANTS_SELECTION'
            >
              Cancel
            </Button>
            <Button
              size='sm'
              onClick={handleSubmit}
              data-track-category='CALL_PARTICIPANTS_SELECTION_MODAL'
              data-track-name='CONFIRM_PARTICIPANTS_SELECTION'
              disabled={selectedParticipants.length === 0}
              className='rounded-lg text-[13px] bg-primary hover:bg-primary hover:opacity-80 disabled:opacity-20 disabled:cursor-not-allowed'
            >
              Start Call
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
