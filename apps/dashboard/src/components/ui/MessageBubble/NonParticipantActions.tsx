import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../Button/Button';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { ChannelScopeType, type HistoryScope } from '@xyne/shared';
import { useChannel } from '../../../hooks/useChannels';
import { RenderMessageWithHTML } from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { useMutation } from '@tanstack/react-query';
import { channelService } from '../../../services/Chat/channelService';
import { buildHistoryScope } from '../../Chat/AddPeopleForm/AddPeopleForm.utils';
import { toast } from 'sonner';

interface MentionedUser {
  userId: string;
}

interface NonParticipantActionsProps {
  messageId: string;
  content: string; // HTML content from message
  metadata:
    | (Record<string, unknown> & {
        messageSubtype?: string;
        mentionedUsers?: MentionedUser[];
        channelId?: string;
        canAddUsers?: boolean;
      })
    | null;
  conversationId?: string;
  showText?: boolean;
  showButton?: boolean;
}

export const NonParticipantActions: React.FC<NonParticipantActionsProps> = ({
  messageId,
  content,
  metadata,
  showText = false,
  showButton = false,
}) => {
  const { channelId: routeChannelId } = useParams<{ channelId: string }>();
  // Use metadata.channelId first (best source of truth), then fallback to route param (unless it's "threads")
  const activeChannelId =
    metadata?.channelId || (routeChannelId !== 'threads' ? routeChannelId : undefined);

  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zero = useZero();
  // Query for channel information to check scopeType
  const channel = useChannel(activeChannelId || '');

  // Mutation for adding participants to GROUP_DM via backend API
  const addGroupDmParticipantsMutation = useMutation({
    mutationFn: ({
      channelId,
      userIds,
      historyScope,
    }: {
      channelId: string;
      userIds: string[];
      historyScope: HistoryScope;
    }) => channelService.addGroupDmParticipants(channelId, { userIds, historyScope }),
    onSuccess: (response, _variables) => {
      // Delete the non-participant suggestion message
      // The message deletion logic in mutators.ts will automatically handle conversation
      zero.mutate(mutators.messages.delete({ messageId }));
      setIsLoading(false);
      setError(null);
      // Navigate to the returned channelId (might be existing or new channel)
      void navigate(`/chat/dir/${response.channelId}`);
    },
    onError: () => {
      zero.mutate(mutators.messages.delete({ messageId }));
      toast.error('Unable to add requested member');
      setIsLoading(false);
      setError('Failed to add users to channel');
    },
  });

  // Only show UI if this is a non-participant message
  if (metadata?.messageSubtype !== 'user_not_in_channel') {
    return null;
  }

  const mentionedUsers: MentionedUser[] = metadata.mentionedUsers || [];

  if (mentionedUsers.length === 0) {
    return null;
  }

  // Check if user can add members (default to true for backward compatibility)
  const canAddMembers = metadata.canAddUsers !== false;

  const scrollToBottom = (): void => {
    const scrollContainer = document.querySelector('[data-component="ChatList"]') as HTMLElement;
    if (scrollContainer) {
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  const handleAddToChannel = (): void => {
    if (!activeChannelId || !zero) return;

    setIsLoading(true);
    setError(null);

    const userIds = mentionedUsers.map(u => u.userId);

    // Check if this is a GROUP_DM channel
    if (channel?.scopeType === ChannelScopeType.GROUP_DM) {
      // Use API for GROUP_DM channels
      addGroupDmParticipantsMutation.mutate({
        channelId: activeChannelId,
        userIds,
        historyScope: buildHistoryScope('today', ''),
      });
    } else {
      // Use existing Zero mutation for regular channels
      try {
        zero.mutate(
          mutators.messages.handleNonParticipantAction({
            messageId,
            action: 'add_all',
            userIds,
            channelId: activeChannelId,
          }),
        );
        setIsLoading(false);
      } catch {
        setError('Failed to add users to channel');
        setIsLoading(false);
      }
    }
  };

  const handleIgnore = (): void => {
    if (!activeChannelId || !zero) return;

    setIsLoading(true);
    setError(null);

    try {
      const userIds = mentionedUsers.map(u => u.userId);
      zero.mutate(
        mutators.messages.handleNonParticipantAction({
          messageId,
          action: 'ignore_all',
          userIds,
          channelId: activeChannelId,
        }),
      );

      setTimeout(scrollToBottom, 100);
    } catch {
      setError('Failed to dismiss suggestion');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className='flex flex-col mb-1'>
      {showText && (
        <div className='text-sm text-foreground'>
          <RenderMessageWithHTML message={content} />
        </div>
      )}
      {showButton && (
        <div className='mt-3'>
          <div className='flex gap-x-2'>
            {canAddMembers && (
              <Button
                className='bg-secondary text-secondary-foreground hover:bg-accent'
                size='sm'
                onClick={() => void handleAddToChannel()}
                data-track-category='MESSAGE'
                data-track-name='ADD_USER_TO_CHANNEL'
                disabled={isLoading}
              >
                {isLoading ? 'Adding...' : 'Add Them'}
              </Button>
            )}
            <Button
              className='bg-secondary text-secondary-foreground hover:bg-accent'
              size='sm'
              onClick={() => void handleIgnore()}
              data-track-category='MESSAGE'
              data-track-name='IGNORE_NON_PARTICIPANT'
              disabled={isLoading}
            >
              {canAddMembers ? 'Do Nothing' : 'Got it'}
            </Button>
          </div>
        </div>
      )}

      {error && <span className='text-xs text-destructive mt-2 block'>{error}</span>}
    </div>
  );
};
