import { ChannelScopeType, ChannelVisibility, UserStatus } from '@xyne/shared';
import { Hash, Lock, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import { useSelf, useUserSearch } from '../../../hooks/useUsers';
import { SearchParticipants } from '../../../routes/CallHistoryScreen/SearchParticipants';
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
  const inputRef = useRef<HTMLInputElement>(null);

  const users = useUserSearch(searchQuery, 15);

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
      users
        .filter(u => u.id !== user?.id) // filter out the current user from the list
        .map(user => ({
          ...user,
          label: user.name ?? user.email,
          value: `user:${user.id}`,
          icon: (
            <Avatar
              userId={user.id}
              size={'sm'}
              showActiveStatus={false}
              className='rounded-md size-[18px] flex items-center justify-center bg-white'
            />
          ),
          children: (
            <div className='flex items-center gap-2'>
              <Avatar
                userId={user.id}
                size={'sm'}
                showActiveStatus={false}
                className='rounded-md size-[18px] flex items-center justify-center bg-white'
              />
              <div className='flex-1 w-full flex items-center gap-1.5'>
                <span className='text-sm'>{user.name.split(' ')[0]}</span>
                {user.status === UserStatus.ACTIVE ? (
                  <span className='w-[5px] h-[5px] bg-green-600 rounded-full'></span>
                ) : (
                  <span className='w-[5px] h-[5px] border border-gray-500 rounded-full'></span>
                )}
                <span className='text-sm text-gray-500'>{user.name}</span>
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
          <Lock className='size-3.5 text-gray-600 mx-0.5' strokeWidth={2.3} />
        ) : (
          <Hash className='size-3.5 text-gray-600 mx-0.5' strokeWidth={2.3} />
        ),
      type: 'channel' as const,
    }));

    return [...userOptions, ...channelOptions].sort((a, b) => a.label.localeCompare(b.label));
  }, [users, channels]);

  const handleSubmit = () => {
    onSubmit(selectedParticipants);
    setSelectedParticipants([]);
    setSearchQuery('');
    onClose();
  };

  const handleClose = () => {
    // Reset state when closing
    setSelectedParticipants([]);
    setSearchQuery('');
    onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => !open && handleClose()}
      className='max-w-[584px] rounded-xl overflow-hidden'
    >
      <div className='flex flex-col w-full'>
        <div className=''>
          <div className='flex items-start justify-between px-5 py-3.5 border-b border-gray-200 h-14'>
            <h2 className='text-[15px] font-semibold text-gray-900 leading-5'>
              Start an Instant Call
            </h2>
            <Button
              variant='outline'
              size='icon'
              tabIndex={-1}
              className='size-7 rounded-lg'
              onClick={handleClose}
            >
              <X className='size-4' />
            </Button>
          </div>
          <div className='p-5 space-y-5'>
            <div className='space-y-2'>
              <p className='text-[#788187] text-[13px] leading-5'>Add Participants</p>
              <SearchParticipants
                options={inviteUserOrChannelOptions}
                selectedValues={selectedParticipants}
                onMultiSelect={setSelectedParticipants}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                ref={inputRef}
              />
            </div>
            <div className='flex items-center justify-between'>
              <Button
                variant='outline'
                size='sm'
                className='rounded-lg text-[13px]'
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                size='sm'
                type='submit'
                onClick={handleSubmit}
                disabled={selectedParticipants.length === 0}
                className='rounded-lg text-[13px] text-white bg-sidebar-badge-accent hover:bg-sidebar-badge-accent hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed'
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
