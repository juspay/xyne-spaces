import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import { Hash, Lock, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import { useSelf, useActiveUsers } from '../../../hooks/useUsers';
import { SearchParticipants } from '../../../routes/CallHistoryScreen/SearchParticipants';
import { isUserDeactivated } from '../../../utils/userDisplayName';
import {
  parseParticipants,
  matchParticipants,
  looksLikeBulkEntry,
} from '../../../utils/participantUtils';
import Avatar from '../../ui/Avatar/Avatar';
import Button from '../../ui/Button';
import Dialog from '../../ui/Dialog';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [notFoundUsers, setNotFoundUsers] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeUsers = useActiveUsers();

  // Focus on Search Participant Input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const allVisibleChannels = useAllVisibleChannels();

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
            <div className='flex items-center gap-2'>
              <Avatar
                userId={user.id}
                size={'sm'}
                showActiveStatus={false}
                className='rounded-md size-[18px] flex items-center justify-center bg-background'
              />
              <div className='flex-1 w-full flex items-center gap-1.5'>
                <span
                  className={`text-sm ${isUserDeactivated(user) ? 'text-muted-foreground' : ''}`}
                >
                  {user.name.split(' ')[0]}
                </span>
                {!isUserDeactivated(user) && (
                  <span className='w-[5px] h-[5px] bg-green-600 rounded-full'></span>
                )}
                <span
                  className={`text-sm ${isUserDeactivated(user) ? 'text-muted-foreground' : 'text-muted-foreground'}`}
                >
                  {user.name}
                </span>
                {isUserDeactivated(user) && (
                  <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground shrink-0'>
                    Deactivated
                  </span>
                )}
              </div>
            </div>
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

    return [...userOptions, ...channelOptions].sort((a, b) => a.label.localeCompare(b.label));
  }, [activeUsers, channels]);

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

  const handleMultiSelect = (participants: string[]) => {
    setSelectedParticipants(participants);
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
              data-testid='instant-call-modal-close'
            >
              <X className='size-4' />
            </Button>
          </div>
          <div className='p-5 space-y-5'>
            <div className='space-y-2'>
              <p className='text-muted-foreground text-[13px] leading-5'>Add Participants</p>
              <SearchParticipants
                options={inviteUserOrChannelOptions}
                selectedValues={selectedParticipants}
                onMultiSelect={handleMultiSelect}
                searchQuery={searchQuery}
                setSearchQuery={handleSearchQueryChange}
                ref={inputRef}
                onEnterQuerySubmit={handleBulkUserEntry}
                helperText={notFoundMessage}
              />
            </div>
            <div className='flex items-center justify-between'>
              <Button
                variant='outline'
                size='sm'
                className='rounded-lg text-[13px]'
                onClick={handleClose}
                data-testid='instant-call-cancel-button'
              >
                Cancel
              </Button>
              <Button
                size='sm'
                type='submit'
                onClick={handleSubmit}
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
