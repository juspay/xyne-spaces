import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import { Hash, Lock, Users, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import { useUserGroupSearch } from '@xyne/shared/hooks';
import { useSelf, useActiveUsers, useUsers } from '../../../hooks/useUsers';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { SearchParticipants } from '../../../routes/CallHistoryScreen/SearchParticipants';
import { getUserDisplayName, isUserDeactivated } from '../../../utils/userDisplayName';
import {
  parseParticipants,
  matchParticipants,
  looksLikeBulkEntry,
} from '../../../utils/participantUtils';
import { rankParticipantOptions } from '../../../utils/participantSearch';
import Avatar from '../../ui/Avatar/Avatar';
import Button from '../../ui/Button';
import Dialog from '../../ui/Dialog';
import { ParticipantOptionContent } from '../ParticipantOptionContent';

interface InstantCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (selectedParticipants: string[]) => void;
}

export const InstantCallModal: React.FC<InstantCallModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const user = useSelf();
  const zero = useZero();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [notFoundUsers, setNotFoundUsers] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeUsers = useActiveUsers();
  const allUsers = useUsers();

  // Focus on Search Participant Input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const allVisibleChannels = useAllVisibleChannels();
  const userGroups = useUserGroupSearch(searchQuery, 10);

  // Filter for DEFAULT public channels only (not DMs)
  const channels = useMemo(() => {
    return allVisibleChannels.filter(channel => channel.scopeType === ChannelScopeType.DEFAULT);
  }, [allVisibleChannels]);

  const inviteUserOrChannelOptions = useMemo(() => {
    const userOptions =
      activeUsers
        .filter(u => u.id !== user?.id)
        .map(user => ({
          ...user,
          label: user.name ?? user.email,
          value: `user:${user.id}`,
          icon: (
            <Avatar
              userId={user.id}
              size={'sm'}
              showActiveStatus={false}
              className='rounded-md size-[18px] flex items-center justify-center bg-background'
            />
          ),
          children: (
            <ParticipantOptionContent
              icon={
                <Avatar
                  userId={user.id}
                  size='sm'
                  showActiveStatus={false}
                  className='rounded-md size-[18px] flex items-center justify-center bg-background'
                />
              }
              label={getUserDisplayName(user)}
              subtitle={user.email}
              isDeactivated={isUserDeactivated(user)}
            />
          ),
          type: 'user' as const,
        })) || [];

    const channelOptions = channels.map(channel => ({
      ...channel,
      label: channel.name,
      value: `channel:${channel.id}`,
      icon:
        channel.visibility === ChannelVisibility.PRIVATE ? (
          <Lock className='size-3.5 text-muted-foreground mx-0.5' strokeWidth={2.3} />
        ) : (
          <Hash className='size-3.5 text-muted-foreground mx-0.5' strokeWidth={2.3} />
        ),
      type: 'channel' as const,
    }));

    const userGroupOptions = userGroups.map(group => ({
      ...group,
      label: group.name,
      value: `user_group:${group.id}`,
      icon: <Users className='size-3.5 text-muted-foreground mx-0.5' strokeWidth={2.3} />,
      subtitle: group.alias || group.description,
      children: (
        <ParticipantOptionContent
          icon={<Users className='size-3.5 text-muted-foreground mx-0.5' strokeWidth={2.3} />}
          label={group.name}
          subtitle={group.alias || group.description}
        />
      ),
      type: 'user_group' as const,
    }));

    return [...userOptions, ...channelOptions, ...userGroupOptions].sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [activeUsers, channels, userGroups, allUsers, user?.id]);

  const rankedParticipantOptions = useMemo(
    () => rankParticipantOptions(inviteUserOrChannelOptions, searchQuery),
    [inviteUserOrChannelOptions, searchQuery],
  );

  const handleSubmit = () => {
    onSubmit(selectedParticipants);
    setSelectedParticipants([]);
    setSearchQuery('');
    setNotFoundUsers([]);
    onClose();
  };

  const handleClose = () => {
    // Reset state when closing
    setSelectedParticipants([]);
    setSearchQuery('');
    setNotFoundUsers([]);
    onClose();
  };

  const handleBulkUserEntry = (query: string): boolean => {
    if (selectedParticipants.some(value => value.startsWith('channel:'))) {
      return false;
    }

    if (!looksLikeBulkEntry(query)) {
      return false;
    }

    const parsed = parseParticipants(query);
    if (parsed.length === 0) {
      return false;
    }

    const { matched, notFound } = matchParticipants(parsed, activeUsers, user?.id);

    if (matched.length === 0) {
      return false;
    }

    const nextSelected = new Set(selectedParticipants);
    for (const { userId } of matched) {
      nextSelected.add(`user:${userId}`);
    }

    setSelectedParticipants(Array.from(nextSelected));
    setNotFoundUsers(notFound.map(p => p.raw));
    setSearchQuery('');
    return true;
  };

  const participantLabel = useMemo(() => {
    if (selectedParticipants.some(v => v.startsWith('channel:'))) return 'Selected Channel';
    return 'Add participants';
  }, [selectedParticipants]);

  const notFoundMessage =
    notFoundUsers.length > 0
      ? `${notFoundUsers.length} user${notFoundUsers.length === 1 ? '' : 's'} not found`
      : undefined;

  const handleSearchQueryChange = (query: string) => {
    setSearchQuery(query);
    if (notFoundUsers.length > 0) {
      setNotFoundUsers([]);
    }
  };

  const handleMultiSelect = async (participants: string[]) => {
    const expanded = new Set<string>();
    for (const value of participants) {
      if (value.startsWith('user_group:')) {
        const groupId = value.replace('user_group:', '');
        const mappings = await zero.run(queries.getUserGroupMembers({ userGroupId: groupId }), {
          type: 'complete',
        });
        const memberIds = mappings
          .map((m: { userId: string }) => m.userId)
          .filter((id: string) => id !== user?.id);
        for (const id of memberIds) {
          expanded.add(`user:${id}`);
        }
      } else {
        expanded.add(value);
      }
    }
    setSelectedParticipants(Array.from(expanded));
    if (notFoundUsers.length > 0) {
      setNotFoundUsers([]);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => !open && handleClose()}
      className='max-w-[584px] rounded-xl overflow-hidden'
      data-testid='instant-call-modal'
    >
      <div className='flex flex-col w-full'>
        <div className=''>
          <div className='flex items-start justify-between px-5 py-3.5 border-b border-border h-14'>
            <h2 className='text-[15px] font-semibold text-foreground leading-5'>
              Start an Instant Call
            </h2>
            <Button
              variant='outline'
              size='icon'
              tabIndex={-1}
              className='size-7 rounded-lg'
              onClick={handleClose}
              data-track-category='calls'
              data-track-name='CLOSE_INSTANT_CALL_MODAL'
              data-testid='instant-call-modal-close'
            >
              <X className='size-4' />
            </Button>
          </div>
          <div className='p-5 space-y-5'>
            <div className='space-y-2'>
              <p className='text-muted-foreground text-[13px] leading-5'>{participantLabel}</p>
              <SearchParticipants
                options={rankedParticipantOptions}
                selectedValues={selectedParticipants}
                onMultiSelect={handleMultiSelect}
                searchQuery={searchQuery}
                setSearchQuery={handleSearchQueryChange}
                ref={inputRef}
                onEnterQuerySubmit={handleBulkUserEntry}
                helperText={notFoundMessage}
                disableClientFiltering
              />
            </div>
            <div className='flex items-center justify-between'>
              <Button
                variant='outline'
                size='sm'
                className='rounded-lg text-[13px]'
                onClick={handleClose}
                data-track-category='calls'
                data-track-name='CANCEL_INSTANT_CALL'
                data-testid='instant-call-cancel-button'
              >
                Cancel
              </Button>
              <Button
                size='sm'
                type='submit'
                onClick={handleSubmit}
                data-track-category='calls'
                data-track-name='START_INSTANT_CALL'
                disabled={selectedParticipants.length === 0}
                className='rounded-lg text-[13px] bg-primary hover:bg-primary hover:opacity-80 disabled:opacity-20 disabled:cursor-not-allowed'
                data-testid='instant-call-start-button'
              >
                Start Call
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
