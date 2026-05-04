import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Search, User as UserIcon } from 'lucide-react';
import Avatar from '../../ui/Avatar/Avatar';
import Input from '../../ui/Input/Input';
import { useUsers, useUserSearch, useUser } from '../../../hooks/useUsers';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { cn } from '../../../utils/classNames';

interface InboxOwnerSettingsProps {
  value: string | null | undefined;
  onChange: (newOwnerUserId: string) => void;
  disabled?: boolean;
}

export const InboxOwnerSettings: React.FC<InboxOwnerSettingsProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pickerOpen) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    setSearchQuery('');
    setSearchTerm('');
    return undefined;
  }, [pickerOpen]);

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchQuery), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const allUsers = useUsers();
  const searchedUsers = useUserSearch(searchTerm, 20);
  const finalResults = useMemo(() => {
    const list = searchTerm.trim() ? searchedUsers : allUsers;
    const selectedSet = new Set(value ? [value] : []);
    return [...list]
      .sort((a, b) => {
        const aSel = selectedSet.has(a.id) ? 1 : 0;
        const bSel = selectedSet.has(b.id) ? 1 : 0;
        return bSel - aSel;
      })
      .slice(0, 40);
  }, [allUsers, searchedUsers, searchTerm, value]);

  const selectedUser = useUser(value || '');

  const handleUserSelect = (userId: string) => {
    onChange(userId);
    setPickerOpen(false);
  };

  const triggerLabel = selectedUser ? getUserDisplayName(selectedUser) : 'Select a user';

  return (
    <div className='space-y-2'>
      <div className='flex items-center gap-2'>
        <UserIcon size={16} className='text-muted-foreground' />
        <label htmlFor='inbox-owner-user' className='text-sm font-medium text-foreground'>
          Inbox Owner
        </label>
      </div>
      <p className='text-xs text-muted-foreground'>
        This user will be used to create email tickets in this channel
      </p>

      <Popover.Root open={pickerOpen} onOpenChange={setPickerOpen}>
        <Popover.Trigger asChild>
          <button
            id='inbox-owner-user'
            type='button'
            disabled={disabled}
            className={cn(
              'inline-flex items-center justify-between gap-2 w-full h-9 px-3 text-sm font-medium rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] outline-none',
              'hover:bg-muted/50',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
            data-track-category='INBOX_SETTINGS'
            data-track-name='OPEN_OWNER_PICKER'
          >
            <span className='flex items-center gap-2 min-w-0'>
              {selectedUser ? (
                <Avatar userId={selectedUser.id} size='sm' className='shrink-0' />
              ) : null}
              <span className='truncate text-left'>{triggerLabel}</span>
            </span>
            <ChevronDown
              className={cn(
                'w-4 h-4 opacity-50 shrink-0 transition-transform',
                pickerOpen && 'rotate-180',
              )}
            />
          </button>
        </Popover.Trigger>
        <Popover.Content
          side='bottom'
          align='start'
          sideOffset={6}
          className='z-[60]'
          style={{ width: 'var(--radix-popover-trigger-width)' }}
        >
          <div className='flex flex-col bg-background overflow-hidden border border-border rounded-lg shadow-lg'>
            <div className='p-3 border-b sticky top-0 bg-background z-10'>
              <div className='relative'>
                <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
                <Input
                  ref={searchInputRef}
                  type='text'
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder='Search user...'
                  className='pl-9 h-9'
                />
              </div>
            </div>
            <div
              className='max-h-80 overflow-y-auto p-1'
              role='listbox'
              aria-multiselectable='false'
            >
              {finalResults.length > 0 ? (
                <div className='space-y-0.5'>
                  {finalResults.map(user => {
                    const isSelected = value === user.id;
                    const displayName = getUserDisplayName(user);
                    return (
                      <button
                        key={user.id}
                        type='button'
                        onClick={() => handleUserSelect(user.id)}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2 rounded-md transition-all outline-none',
                          isSelected
                            ? 'bg-accent text-accent-foreground'
                            : 'hover:bg-muted text-foreground',
                          'focus-visible:ring-2 focus-visible:ring-ring',
                        )}
                        data-track-category='INBOX_SETTINGS'
                        data-track-name='SELECT_OWNER_USER'
                        data-track-metadata={JSON.stringify({
                          userId: user.id,
                          userName: displayName,
                        })}
                      >
                        <Avatar userId={user.id} size='sm' className='shrink-0' />
                        <div className='flex-1 text-left min-w-0'>
                          <p className='text-sm font-medium truncate'>{displayName}</p>
                          {user.email ? (
                            <p className='text-xs text-muted-foreground truncate'>{user.email}</p>
                          ) : null}
                        </div>
                        {isSelected && <Check className='w-4 h-4 text-muted-foreground shrink-0' />}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className='p-8 text-center text-sm text-muted-foreground'>
                  {searchQuery ? 'No matches found' : 'No users available'}
                </div>
              )}
            </div>
          </div>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
};
