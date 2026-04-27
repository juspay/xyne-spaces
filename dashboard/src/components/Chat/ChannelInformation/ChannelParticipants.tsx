import React, { useState } from 'react';
import { UserPlus, ChevronDown, Search, Trash2 } from 'lucide-react';
import { Modal, Button, ButtonType, ButtonSize, Checkbox } from '@juspay/blend-design-system';
import { AvatarSize } from '../../UserAvatar/UserAvatar';
import {
  ChannelRole,
  ChannelScopeType,
  ChannelVisibility,
  MessageType,
  User,
  Channel,
} from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import UserAvatar from '../../UserAvatar/UserAvatar';
import { SearchUser } from '../../ui/SearchUser/SearchUser';
import { channelService } from '../../../services/Chat/channelService';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { isOneToOneDMChannel } from '../../../components/Chat/ChatDirectory/ChatDirectory.utils';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { mutators } from '../../../zero/mutators';
import { useUsers } from '../../../hooks/useUsers';
import { useCachedQuery } from '../../../hooks/useCachedQuery';

type FilterType = ChannelRole | 'everyone';

interface ChannelParticipantsProps {
  channel: Channel;
  onAddingParticipants: () => void;
}

const ChannelParticipants: React.FC<ChannelParticipantsProps> = ({
  channel,
  onAddingParticipants,
}) => {
  const [selectedFilter, setSelectedFilter] = useState<FilterType>('everyone');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddPeopleModal, setShowAddPeopleModal] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [includeHistory, setIncludeHistory] = useState(true);
  const context = useAuthContextValues();
  const zero = useZero();
  const navigate = useNavigate();

  const [participants] = useCachedQuery(queries.channelParticipants({ channelId: channel.id }));

  const isDM = isOneToOneDMChannel(channel.scopeType);
  const isParticipant = participants.find(p => p.userId === context.userID);

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

      handleModalClose();
      onAddingParticipants();
      // Navigate to the returned channelId (might be existing or new channel)
      void navigate(`/chat/dir/${response.channelId}`);
    },
    onError: () => {
      // Keep modal open on error so user can retry
    },
  });

  // Compute authorization directly from props without state
  const isAuthorizedToRemoveParticipant =
    channel.scopeType === ChannelScopeType.DEFAULT && isParticipant?.role === ChannelRole.ADMIN;

  const handleFilterChange = (value: FilterType): void => {
    setSelectedFilter(value);
  };

  const handleAddPeople = (): void => {
    setShowAddPeopleModal(true);
  };

  const handleModalClose = (): void => {
    setSelectedUsers([]);
    setShowAddPeopleModal(false);
    setIncludeHistory(true);
  };

  const handleAddUsersSubmit = (includeHistory: boolean): void => {
    if (channel.scopeType !== ChannelScopeType.GROUP_DM) {
      // Use Zero mutator for regular channels
      const selectedUserIds = selectedUsers.map(user => user.id);

      // Generate IDs for each user
      const participantIds = selectedUserIds.reduce(
        (acc, userId) => {
          acc[userId] = uuidv4();
          return acc;
        },
        {} as Record<string, string>,
      );

      const userStatusIds = selectedUserIds.reduce(
        (acc, userId) => {
          acc[userId] = uuidv4();
          return acc;
        },
        {} as Record<string, string>,
      );

      zero.mutate(
        mutators.channel.addParticipants({
          channelId: channel.id,
          userIds: selectedUserIds,
          timestamp: Date.now(),
          participantIds,
          userStatusIds,
        }),
      );
      handleModalClose();
      onAddingParticipants();
      return;
    }

    addGroupDmParticipantsMutation.mutate({
      channelId: channel.id,
      userIds: selectedUsers.map(user => user.id),
      includeHistory,
    });
  };

  // Get existing participant user IDs to exclude from search
  const existingUserIds = participants.map(p => p.userId);

  const allUsers = useUsers();
  const usersById = React.useMemo(() => {
    const map = new Map<string, User>();
    for (const u of allUsers) {
      map.set(u.id, u);
    }
    return map;
  }, [allUsers]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setSearchQuery(e.target.value);
  };

  const handleRemoveParticipant = (targetUserId: string): void => {
    zero.mutate(
      mutators.channel.removeParticipant({
        channelId: channel.id,
        targetUserId,
        updatedAt: Date.now(),
      }),
    );
  };

  // Filter participants based on selected filter and search query
  const filteredParticipants = participants
    .filter(participant => {
      // First apply role filter
      let matchesFilter = true;
      if (selectedFilter !== 'everyone') {
        matchesFilter = participant.role === selectedFilter;
      }

      // Then apply search filter
      let matchesSearch = true;
      if (searchQuery.trim()) {
        const searchLower = searchQuery.toLowerCase();
        const user = usersById.get(participant.userId);
        matchesSearch = user?.name?.toLowerCase().includes(searchLower) || false;
      }

      return matchesFilter && matchesSearch;
    })
    .sort((a, b) => {
      if (a.role === ChannelRole.ADMIN && b.role !== ChannelRole.ADMIN) return -1;
      if (a.role !== ChannelRole.ADMIN && b.role === ChannelRole.ADMIN) return 1;

      const userA = usersById.get(a.userId);
      const userB = usersById.get(b.userId);
      const nameA = userA?.name || '';
      const nameB = userB?.name || '';
      return nameA.localeCompare(nameB);
    });

  return (
    <div className='h-full bg-card text-foreground p-4 flex flex-col'>
      {/* Search and Filter Section */}
      <div className='flex gap-3 mb-6'>
        {/* Search Input */}
        <div className='flex-1 relative'>
          <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground' />
          <input
            type='text'
            placeholder='Find members'
            value={searchQuery}
            onChange={handleSearchChange}
            className='w-full bg-background border border-border text-foreground rounded-lg pl-10 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring'
            data-track-event='blur'
            data-track-category='CHANNEL_INFORMATION'
            data-track-name='SEARCH_MEMBERS_INPUT'
          />
        </div>

        {/* Filter Dropdown */}
        <div className='relative w-40'>
          <select
            value={selectedFilter}
            onChange={e => handleFilterChange(e.target.value as FilterType)}
            className='w-full bg-background border border-border text-foreground rounded-lg px-3 py-2 pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-ring'
            data-track-event='change'
            data-track-category='CHANNEL_INFORMATION'
            data-track-name='FILTER_MEMBERS_BY_ROLE'
          >
            <option value='everyone'>Everyone</option>
            <option value={ChannelRole.ADMIN}>Admin</option>
            <option value={ChannelRole.MEMBER}>Member</option>
          </select>
          <ChevronDown className='absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
        </div>
      </div>

      {/* Participants List */}
      <div className='flex-1 overflow-y-auto'>
        <div className='space-y-2'>
          {/* Add People Section */}
          {!isDM &&
            ((channel.visibility === ChannelVisibility.PRIVATE &&
              isParticipant?.role === ChannelRole.ADMIN) ||
              channel.visibility === ChannelVisibility.PUBLIC ||
              (channel.scopeType === ChannelScopeType.GROUP_DM && isParticipant)) && (
              <div className='mb-4'>
                <button
                  onClick={handleAddPeople}
                  className='flex items-center gap-3 w-full p-3 rounded-lg hover:bg-accent transition-colors group'
                  data-track-category='CHANNEL_INFORMATION'
                  data-track-name='OPEN_ADD_PEOPLE_MODAL'
                  data-track-metadata={JSON.stringify({ channelId: channel?.id })}
                >
                  <div className='w-10 h-10 bg-action-primary rounded-lg flex items-center justify-center'>
                    <UserPlus className='w-5 h-5 text-action-primary-foreground' />
                  </div>
                  <span className='text-primary font-medium group-hover:text-primary/80'>
                    Add people
                  </span>
                </button>
              </div>
            )}
          {filteredParticipants.map(participant => (
            <div
              key={participant.id}
              className='flex items-center gap-3 p-2 rounded-lg hover:bg-accent transition-colors cursor-pointer'
            >
              <UserAvatar userId={participant.userId} size={AvatarSize.MD} />

              {/* User Info */}
              <div className='flex-1 min-w-0 flex justify-between items-center'>
                <div>
                  <div className='flex items-center gap-2'>
                    <span className='font-medium text-foreground truncate'>
                      {usersById.get(participant.userId)?.name}
                    </span>
                  </div>

                  {/* User Role */}
                  <div className='text-sm text-muted-foreground truncate'>
                    {usersById.get(participant.userId)?.email}
                  </div>
                </div>
                {isAuthorizedToRemoveParticipant && context.userID !== participant.userId && (
                  <button
                    onClick={() => handleRemoveParticipant(participant.userId)}
                    data-track-category='CHANNEL_INFORMATION'
                    data-track-name='REMOVE_PARTICIPANT'
                    data-track-metadata={JSON.stringify({
                      channelId: channel?.id,
                      userId: participant.userId,
                    })}
                  >
                    <Trash2 size={20} className='text-destructive' />
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* No Results */}
          {filteredParticipants.length === 0 && (
            <div className='text-center py-8 text-muted-foreground'>
              <Search className='w-8 h-8 mx-auto mb-2 opacity-50' />
              <p>No members found</p>
              <p className='text-sm mt-1'>
                {searchQuery ? 'Try adjusting your search or filter' : 'Try adjusting your filter'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Add People Modal */}
      {showAddPeopleModal && (
        <Modal
          isOpen={true}
          onClose={handleModalClose}
          title='Add Members'
          showCloseButton={true}
          closeOnBackdropClick={true}
          showDivider={true}
        >
          <div className='p-4 overflow-visible min-w-[600px]'>
            <SearchUser
              excludeUserIds={existingUserIds}
              selectedUsers={selectedUsers}
              onUsersChange={setSelectedUsers}
              placeholder='Search users to add to channel...'
              label='Search Users'
              hintText='Search by name or email to find users to add'
            />

            {/* Include History Checkbox - Only for GROUP_DM channels */}
            {channel.scopeType === ChannelScopeType.GROUP_DM && (
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

            {/* Custom Footer Buttons */}
            <div className='flex justify-end gap-3 mt-6 pt-4 border-t border-border'>
              <Button
                text='Cancel'
                buttonType={ButtonType.SECONDARY}
                size={ButtonSize.MEDIUM}
                onClick={handleModalClose}
                data-track-category='CHANNEL_INFORMATION'
                data-track-name='CANCEL_ADD_PEOPLE'
                data-track-metadata={JSON.stringify({ channelId: channel?.id })}
              />
              <Button
                text='Add Selected Users'
                buttonType={ButtonType.PRIMARY}
                size={ButtonSize.MEDIUM}
                onClick={() => void handleAddUsersSubmit(includeHistory)}
                disabled={selectedUsers.length === 0 || addGroupDmParticipantsMutation.isPending}
                data-track-category='CHANNEL_INFORMATION'
                data-track-name='ADD_USERS_TO_CHANNEL'
                data-track-metadata={JSON.stringify({
                  channelId: channel?.id,
                  users: selectedUsers,
                  includeHistory,
                })}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default ChannelParticipants;
