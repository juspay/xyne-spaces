import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { User } from '@xyne/shared';
import { Hash, Lock, X } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../../../utils/classNames';
import { useUsersPresence } from '../../../hooks/usePresence';
import {
  getUserDisplayName,
  isUserDeactivated,
  matchesUserQuery,
} from '../../../utils/userDisplayName';
import Avatar from '../Avatar/Avatar';
import Button from '../Button';
import { StatusIndicator } from '../StatusIndicator';

export interface ChannelOption {
  id: string;
  name: string;
  isPrivate: boolean;
}

export type SearchEntry =
  | { type: 'user'; user: User }
  | { type: 'channel'; channel: ChannelOption };

interface SearchParticipantsProps {
  options: User[];
  selectedUsers: User[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelect: (users: User[]) => void;
  inputRef?: React.ForwardedRef<HTMLInputElement>;
  isOpen?: boolean;
  setIsOpen?: (isOpen: boolean) => void;
  className?: string;
  currentUserId?: string;
  mergedItems?: SearchEntry[];
  onSelectChannel?: (channelId: string) => void;
}

// Below this many rows the flat user list renders normally; above it we
// window the rows so only the visible ones mount (avatar + presence + status).
const VIRTUALIZE_THRESHOLD = 30;

export const SearchUserV2: React.FC<SearchParticipantsProps> = ({
  options,
  selectedUsers,
  onSelect,
  searchQuery,
  onSearchChange,
  inputRef,
  isOpen = false,
  setIsOpen,
  className,
  currentUserId,
  mergedItems,
  onSelectChannel,
}) => {
  const [pillsWidth, setPillsWidth] = useState(0);
  const [pillsHeight, setPillsHeight] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const pillsContainerRef = useRef<HTMLDivElement>(null);
  const lastPillRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Get real-time online users for presence indicators
  const onlineUserIds = useUsersPresence('ONLINE');
  const onlineUserIdsSet = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);

  const updateDimensions = useCallback(() => {
    const pillsEl = pillsContainerRef.current;
    const lastPill = lastPillRef.current;

    if (!pillsEl) return;

    requestAnimationFrame(() => {
      if (lastPill && selectedUsers.length > 0) {
        const containerRect = pillsEl.getBoundingClientRect();
        const lastPillRect = lastPill.getBoundingClientRect();

        const relativeLeft = lastPillRect.left - containerRect.left;
        const relativeTop = lastPillRect.top - containerRect.top;

        setPillsWidth(relativeLeft + lastPillRect.width);
        setPillsHeight(relativeTop + lastPillRect.height);

        lastPill.scrollIntoView({ behavior: 'smooth' });
      } else {
        setPillsWidth(0);
        setPillsHeight(0);
      }
    });
  }, [selectedUsers.length]);

  useEffect(() => {
    const pillsEl = pillsContainerRef.current;
    if (!pillsEl) return;

    // Observe container resize
    resizeObserverRef.current = new ResizeObserver(updateDimensions);
    resizeObserverRef.current.observe(pillsEl);

    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, [updateDimensions]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (isOpen) setIsOpen?.(false);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [isOpen, setIsOpen]);

  // Calculate pills width whenever selected options change
  useEffect(() => {
    updateDimensions();
  }, [updateDimensions]);

  // Get selected options
  const selectedUserIds = useMemo(() => new Set(selectedUsers.map(u => u.id)), [selectedUsers]);

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    const isSelfSearch = searchQuery.trim().toLowerCase() === 'self';
    const baseOptions = searchQuery.trim()
      ? options.filter(opt => {
          // Always pass through current user when "self" is searched
          if (currentUserId && opt.id === currentUserId && isSelfSearch) return true;
          return matchesUserQuery(opt, searchQuery);
        })
      : options;

    return baseOptions.filter(opt => !selectedUserIds.has(opt.id));
  }, [options, searchQuery, selectedUserIds, currentUserId]);

  const filteredMergedItems = useMemo(() => {
    if (!mergedItems) return null;
    return mergedItems.filter(
      item => item.type === 'channel' || !selectedUserIds.has(item.user.id),
    );
  }, [mergedItems, selectedUserIds]);

  // Virtualize only the plain user-list path (custom field / assignee-style pickers).
  // Merged user+channel callers keep their existing small-list rendering.
  const isVirtualized = !mergedItems && filteredOptions.length > VIRTUALIZE_THRESHOLD;
  const rowVirtualizer = useVirtualizer({
    count: isVirtualized ? filteredOptions.length : 0,
    getScrollElement: () => listRef.current,
    estimateSize: () => 36,
    overscan: 12,
  });

  const findUserById = useCallback(
    (id: string): User | undefined => {
      const fromOptions = options.find(u => u.id === id);
      if (fromOptions) return fromOptions;
      const fromMerged = mergedItems?.find(
        (item): item is Extract<SearchEntry, { type: 'user' }> =>
          item.type === 'user' && item.user.id === id,
      );
      return fromMerged?.user;
    },
    [options, mergedItems],
  );

  const handleSelect = (value: string | null) => {
    if (!value) return;
    if (value.startsWith('channel:')) {
      const channelId = value.slice('channel:'.length);
      onSelectChannel?.(channelId);
      onSearchChange('');
      setIsOpen?.(false);
      return;
    }
    if (!selectedUserIds.has(value)) {
      const user = findUserById(value);
      if (user) {
        onSelect([...selectedUsers, user]);
        onSearchChange('');
        setIsOpen?.(false);
      }
    }
  };

  const handleRemove = (userId: string) => {
    onSelect(selectedUsers.filter(u => u.id !== userId));
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Backspace' && searchQuery === '' && selectedUsers.length > 0) {
        e.preventDefault();

        if (focusedIndex !== null) {
          const userToRemove = selectedUsers[focusedIndex];
          if (userToRemove) {
            handleRemove(userToRemove.id);
          }
          setFocusedIndex(null);
        } else {
          setFocusedIndex(selectedUsers.length - 1);
        }
      } else if (e.key !== 'Backspace') {
        setFocusedIndex(null);
      }
      if (e.key === 'Tab') {
        // focus on the InputBox
        const inputBoxWrapper = document.querySelector('[data-input-id="dm-message"]');
        if (!inputBoxWrapper) return;

        e.preventDefault();
        setIsOpen?.(false);

        // Defer focus to avoid conflicts with dropdown closing
        setTimeout(() => {
          const editor = inputBoxWrapper?.querySelector('.ProseMirror') as HTMLElement;
          editor?.focus();
        }, 0);
      }
      if (e.key === 'Enter') {
        // Always prevent default to avoid accidental form submission from this input.
        e.preventDefault();
        if (!isOpen) {
          // Dropdown is closed — move focus to the message InputBox (same as Tab)
          const inputBoxWrapper = document.querySelector('[data-input-id="dm-message"]');
          if (!inputBoxWrapper) return;
          setTimeout(() => {
            const editor = inputBoxWrapper.querySelector('.ProseMirror') as HTMLElement;
            editor?.focus();
          }, 0);
        }
      }
    },
    [searchQuery, selectedUsers, focusedIndex, handleRemove, setIsOpen, isOpen],
  );

  const renderUserItem = (
    user: User,
    virtual?: { index: number; style: React.CSSProperties },
  ): React.ReactElement => {
    const displayName = getUserDisplayName(user);
    const deactivated = isUserDeactivated(user);
    const isCurrentUser = currentUserId && user.id === currentUserId;
    return (
      <BaseCombobox.Item
        key={user.id}
        value={user.id}
        index={virtual?.index}
        style={virtual?.style}
        className={cn(
          'flex w-full items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-sm hover:bg-accent data-[highlighted]:bg-accent',
        )}
      >
        <Avatar
          userId={user.id}
          size={'sm'}
          showActiveStatus={false}
          className='rounded-md size-[18px] flex items-center justify-center bg-background'
        />
        <div className='flex-1 w-full flex items-center gap-2'>
          <span className={`text-sm ${deactivated ? 'text-muted-foreground' : ''}`}>
            {displayName.split(' ')[0]}
          </span>
          {onlineUserIdsSet.has(user.id) ? (
            <span className='w-1.5 h-1.5 bg-green-600 rounded-full'></span>
          ) : (
            <span className='w-1.5 h-1.5 border border-muted-foreground rounded-full'></span>
          )}
          {(user.statusEmoji || user.statusContent) && (
            <StatusIndicator
              statusEmoji={user.statusEmoji}
              statusContent={user.statusContent}
              statusExpiryAt={user.statusExpiryAt}
              size='sm'
            />
          )}
          <span
            className={`text-sm ${deactivated ? 'text-muted-foreground' : 'text-muted-foreground'}`}
          >
            {displayName}

            {isCurrentUser ? ' (you)' : ''}
          </span>
          {deactivated && (
            <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground shrink-0'>
              Deactivated
            </span>
          )}
        </div>
      </BaseCombobox.Item>
    );
  };

  const renderChannelItem = (channel: ChannelOption): React.ReactElement => (
    <BaseCombobox.Item
      key={`channel:${channel.id}`}
      value={`channel:${channel.id}`}
      className={cn(
        'flex w-full items-center gap-2 px-2 py-1.5 rounded-lg text-sm hover:bg-accent data-[highlighted]:bg-accent',
      )}
    >
      {channel.isPrivate ? (
        <Lock className='size-[18px] shrink-0 text-muted-foreground' />
      ) : (
        <Hash className='size-[18px] shrink-0 text-muted-foreground' />
      )}
      <span className='truncate text-sm text-foreground'>{channel.name}</span>
    </BaseCombobox.Item>
  );

  const isEmpty = filteredMergedItems
    ? filteredMergedItems.length === 0
    : filteredOptions.length === 0;

  return (
    <BaseCombobox.Root
      autoHighlight={true}
      open={isOpen}
      onOpenChange={(isOpen: boolean) => setIsOpen?.(isOpen)}
      value={null}
      onValueChange={handleSelect}
      {...(isVirtualized
        ? { items: filteredOptions.map(u => u.id), virtualized: true, filter: null }
        : {})}
      onItemHighlighted={(itemValue, details) => {
        // Keep the keyboard-highlighted row scrolled into the virtual window.
        if (
          !isVirtualized ||
          itemValue === null ||
          itemValue === undefined ||
          details.reason === 'pointer'
        )
          return;
        if (details.index >= 0) rowVirtualizer.scrollToIndex(details.index);
      }}
    >
      <div
        ref={containerRef}
        className={cn(
          'relative flex items-start overflow-hidden whitespace-nowrap overflow-y-auto p-1 min-h-8 max-h-36',
          className,
        )}
      >
        <div className='flex items-start gap-0 py-1 relative w-full'>
          <div
            ref={pillsContainerRef}
            className='flex flex-wrap items-center gap-1.5 absolute left-1 -top-0 z-10 pointer-events-none'
          >
            {selectedUsers.map((user, i) => (
              <UserPill
                key={user.id}
                ref={i === selectedUsers.length - 1 ? lastPillRef : null}
                user={user}
                isFocused={focusedIndex === i}
                onRemove={handleRemove}
              />
            ))}
          </div>
          <BaseCombobox.Input
            ref={inputRef}
            data-testid='user-search-input'
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selectedUsers.length === 0 ? 'Search user by email or name' : ''}
            className={cn(
              'w-full text-[14px] min-w-[120px] text-foreground border-none font-normal bg-transparent relative placeholder:text-muted-foreground outline-none focus:outline-none',
            )}
            style={{
              paddingLeft: `${pillsWidth + 10}px`,
              paddingTop: pillsHeight > 36 ? `${pillsHeight - 30}px` : '0px',
            }}
          />

          <BaseCombobox.Portal>
            <BaseCombobox.Positioner
              sideOffset={8}
              align='start'
              positionMethod='fixed'
              className='z-[100] pointer-events-none'
            >
              <BaseCombobox.Popup
                data-testid='user-search-results'
                data-combobox-popup
                className='border border-border min-w-[var(--anchor-width)] max-h-[14rem] rounded-lg bg-background text-foreground transition duration-100 origin-[var(--transform-origin)] data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95 shadow-lg pointer-events-auto'
              >
                {isEmpty ? (
                  <BaseCombobox.Empty>
                    <p className='text-sm text-muted-foreground px-4 py-3'>No options found</p>
                  </BaseCombobox.Empty>
                ) : (
                  <BaseCombobox.List
                    ref={listRef}
                    className={cn(
                      'overflow-y-auto overscroll-contain py-1 m-1.5 outline-none cursor-pointer',
                      'max-h-[min(13rem,var(--available-height))] data-[empty]:p-0 space-y-1',
                      'no-scrollbar',
                    )}
                  >
                    {isVirtualized ? (
                      <div
                        style={{
                          position: 'relative',
                          width: '100%',
                          height: rowVirtualizer.getTotalSize(),
                        }}
                      >
                        {rowVirtualizer.getVirtualItems().map(vi => {
                          const user = filteredOptions[vi.index];
                          if (!user) return null;
                          return renderUserItem(user, {
                            index: vi.index,
                            style: {
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: vi.size,
                              transform: `translateY(${vi.start}px)`,
                            },
                          });
                        })}
                      </div>
                    ) : filteredMergedItems ? (
                      filteredMergedItems.map(item =>
                        item.type === 'user'
                          ? renderUserItem(item.user)
                          : renderChannelItem(item.channel),
                      )
                    ) : (
                      filteredOptions.map(user => renderUserItem(user))
                    )}
                  </BaseCombobox.List>
                )}
              </BaseCombobox.Popup>
            </BaseCombobox.Positioner>
          </BaseCombobox.Portal>
        </div>
      </div>
    </BaseCombobox.Root>
  );
};

// Selected User Pill
const UserPill = forwardRef<
  HTMLDivElement,
  {
    user: User;
    isFocused: boolean;
    onRemove: (value: string) => void;
  }
>(({ user, isFocused, onRemove }, ref) => {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRemove(user.id);
    },
    [user.id, onRemove],
  );

  return (
    <div
      ref={ref}
      className={cn(
        'flex items-center justify-center gap-1 px-2 py-1 bg-muted rounded-md text-sm border border-border pointer-events-auto',
        isFocused && 'bg-accent border-border',
      )}
    >
      <Avatar userId={user.id} size='sm' showActiveStatus={false} />
      <span className='truncate max-w-80'>{getUserDisplayName(user)}</span>
      <Button
        size='icon'
        variant='ghost'
        onClick={handleClick}
        data-track-category='ENTITY_PICKER'
        data-track-name='REMOVE_USER_CHIP'
        className='ml-1 hover:bg-accent rounded p-0.5 size-4'
        aria-label={`Remove ${getUserDisplayName(user)} from list`}
      >
        <X className='size-3' />
      </Button>
    </div>
  );
});

UserPill.displayName = 'UserPill';
