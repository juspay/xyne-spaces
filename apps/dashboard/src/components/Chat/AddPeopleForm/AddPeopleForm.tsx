import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../ui/Button';
import { SearchUser } from '../../ui/SearchUser/SearchUser';
import { User, ChannelScopeType, MessageType } from '@xyne/shared';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { toast } from 'sonner';
import { Checkbox } from '@juspay/blend-design-system';
import { mutators } from '../../../zero/mutators';
import { useChannel } from '../../../hooks/useChannels';
import { channelService } from '../../../services/Chat/channelService';
import { useMutation } from '@tanstack/react-query';
import { v4 as uuidv4 } from 'uuid';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { isOneToOneDMChannel } from '../ChatDirectory/ChatDirectory.utils';
import { usePlatform } from '../../../hooks/usePlatform';

interface AddPeopleFormProps {
  channelId: string;
  existingUserIds?: string[];
  onSuccess?: () => void;
  onCancel?: () => void;
  loading?: boolean;
}

export const AddPeopleForm: React.FC<AddPeopleFormProps> = ({
  channelId,
  existingUserIds: propExistingUserIds,
  onSuccess,
  onCancel,
  loading = false,
}) => {
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [includeHistory, setIncludeHistory] = useState(true);
  const { isMobile } = usePlatform();
  const zero = useZero();
  const navigate = useNavigate();
  const channel = useChannel(channelId);
  const [participantsData] = useCachedQuery(queries.channelParticipants({ channelId }));
  const isDM = channel ? isOneToOneDMChannel(channel.scopeType) : false;

  const existingUserIds = useMemo(
    () => propExistingUserIds || (participantsData || []).map(p => p.userId),
    [propExistingUserIds, participantsData],
  );

  const createGroupDmFromDmMutation = useMutation({
    mutationFn: (participantIds: string[]) => channelService.createDm({ participantIds }),
    onSuccess: response => {
      onSuccess?.();
      void navigate(`/chat/dir/${response.id}`);
    },
    onError: () => {
      toast.error('Failed to create group DM', {
        description: 'Could not create group DM. Please try again.',
        duration: 3000,
      });
    },
  });

  // Mutation for adding participants to GROUP_DM via backend API
  const addGroupDmParticipantsMutation = useMutation({
    mutationFn: ({
      channelId,
      userIds,
      includeHistory,
    }: {
      channelId: string;
      userIds: string[];
      includeHistory: boolean;
    }) => channelService.addGroupDmParticipants(channelId, { userIds, includeHistory }),
    onSuccess: (response, variables) => {
      // Create system messages using Zero mutator
      try {
        // If conversations were migrated, create system messages
        if (response.conversationsMigrated && response.conversationsMigrated > 0) {
          const conversationText =
            response.conversationsMigrated === 1 ? 'conversation' : 'conversations';

          // System message in source channel
          zero.mutate(
            mutators.conversations.send({
              channelId: variables.channelId,
              content: `${response.conversationsMigrated} ${conversationText} ${response.conversationsMigrated === 1 ? 'was' : 'were'} moved to another channel`,
              type: MessageType.SYSTEM,
              conversationId: uuidv4(),
              messageId: uuidv4(),
              timestamp: Date.now(),
            }),
          );

          // System message in target channel (if different from source)
          if (response.channelId !== variables.channelId) {
            zero.mutate(
              mutators.conversations.send({
                channelId: response.channelId,
                content: `${response.conversationsMigrated} ${conversationText} ${response.conversationsMigrated === 1 ? 'was' : 'were'} moved from a previous channel`,
                type: MessageType.SYSTEM,
                conversationId: uuidv4(),
                messageId: uuidv4(),
                timestamp: Date.now(),
              }),
            );
          }
        }
      } catch {
        // Don't block navigation on system message failure
      }
      onSuccess?.();
      // Navigate to the returned channelId (might be existing or new channel)
      void navigate(`/chat/dir/${response.channelId}`);
    },
    onError: () => {
      // Keep modal open on error so user can retry
    },
  });

  const handleSubmit = (): void => {
    if (selectedUsers.length === 0) return;

    const userIds = selectedUsers.map(user => user.id);

    if (isDM) {
      const allParticipantIds = [...existingUserIds, ...userIds];
      createGroupDmFromDmMutation.mutate(allParticipantIds);
      return;
    }

    if (channel?.scopeType === ChannelScopeType.GROUP_DM) {
      addGroupDmParticipantsMutation.mutate({
        channelId,
        userIds,
        includeHistory,
      });
    } else {
      const hasGuest = selectedUsers.some(user => user.role === 'GUEST');
      if (hasGuest) {
        toast.error('Guests can only be added to channels they were invited to.', {
          description: 'Please ask your workspace admin to add them.',
          duration: 5000,
        });
        return;
      }
      setIsSubmitting(true);
      try {
        const participantIds = userIds.reduce(
          (acc, userId) => {
            acc[userId] = uuidv4();
            return acc;
          },
          {} as Record<string, string>,
        );

        const userStatusIds = userIds.reduce(
          (acc, userId) => {
            acc[userId] = uuidv4();
            return acc;
          },
          {} as Record<string, string>,
        );

        void zero.mutate(
          mutators.channel.addParticipants({
            channelId,
            userIds,
            timestamp: Date.now(),
            participantIds,
            userStatusIds,
          }),
        );
        setSelectedUsers([]);
        onSuccess?.();
      } catch {
        toast.error('Failed to add participants', {
          description: 'Could not add participants. Please try again.',
          duration: 3000,
        });
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleCancel = (): void => {
    setSelectedUsers([]);
    onCancel?.();
  };

  const isLoading =
    isSubmitting ||
    loading ||
    createGroupDmFromDmMutation.isPending ||
    addGroupDmParticipantsMutation.isPending;

  return (
    <div className='p-4 space-y-6'>
      <div>
        <h2 className='text-lg font-semibold text-foreground mb-1'>Add Members</h2>
        <p className='text-sm text-muted-foreground'>Search for users to add to this channel</p>
      </div>

      <div>
        <SearchUser
          excludeUserIds={existingUserIds}
          selectedUsers={selectedUsers}
          onUsersChange={setSelectedUsers}
          placeholder='Search users to add to channel...'
          label='Search Users'
          hintText='Search by name or email to find users to add'
          autoFocus={!isMobile}
        />
      </div>

      {/* Include History Checkbox - Only for GROUP_DM channels */}
      {channel?.scopeType === ChannelScopeType.GROUP_DM && (
        <div className='mt-4 p-3 bg-muted rounded-lg border border-border'>
          <Checkbox
            defaultChecked={includeHistory}
            checked={includeHistory}
            onCheckedChange={(checked: boolean | 'indeterminate') =>
              setIncludeHistory(checked === true)
            }
            subtext='New participants will be able to see all previous messages in this conversation'
          >
            Include conversation history for new participants
          </Checkbox>
        </div>
      )}

      <div className='flex justify-end gap-3 pt-4 border-t border-border'>
        {onCancel && (
          <Button
            variant='ghost'
            size='default'
            onClick={handleCancel}
            disabled={isLoading}
            data-track-category='ADD_CHAT_PARTICIPANTS'
            data-track-name='Cancel_Add_People'
            data-track-metadata={JSON.stringify({ selectedUsers: selectedUsers })}
          >
            Cancel
          </Button>
        )}
        <Button
          variant='default'
          size='default'
          onClick={() => void handleSubmit()}
          disabled={selectedUsers.length === 0 || isLoading}
          loading={isLoading}
          data-testid='add-people-submit'
          data-track-category='ADD_CHAT_PARTICIPANTS'
          data-track-name='ADD_PEOPLE_SUBMIT'
          data-track-metadata={JSON.stringify({ selectedUsers: selectedUsers })}
        >
          Add Selected Users
        </Button>
      </div>
    </div>
  );
};

export default AddPeopleForm;
