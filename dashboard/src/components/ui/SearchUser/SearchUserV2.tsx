import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { User, UserStatus } from '@xyne/shared';
import { Search, X } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../../utils/classNames';
import Avatar from '../Avatar/Avatar';
import Button from '../Button';

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
}

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
}) => {
  const [pillsWidth, setPillsWidth] = useState(0);
  const [pillsHeight, setPillsHeight] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const pillsContainerRef = useRef<HTMLDivElement>(null);
  const lastPillRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
    const baseOptions = searchQuery.trim()
      ? options.filter(
          opt =>
            opt.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            opt.email?.toLowerCase().includes(searchQuery.toLowerCase()),
        )
      : options;

    return baseOptions.filter(opt => !selectedUserIds.has(opt.id));
  }, [options, searchQuery, selectedUserIds]);

  const handleSelect = (userId: string | null) => {
    if (userId && !selectedUserIds.has(userId)) {
      const user = options.find(u => u.id === userId);
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
        // foucs on the InputBox
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
        e.preventDefault();
      }
    },
    [searchQuery, selectedUsers, focusedIndex, handleRemove, setIsOpen],
  );

  return (
    <BaseCombobox.Root
      autoHighlight={true}
      open={isOpen}
      onOpenChange={(isOpen: boolean) => setIsOpen?.(isOpen)}
      value={null}
      onValueChange={handleSelect}
    >
      <div
        ref={containerRef}
        className={cn(
          'relative flex items-start overflow-hidden whitespace-nowrap overflow-y-auto p-1 min-h-8 max-h-36',
          className,
        )}
      >
        <div className='flex items-start gap-0 py-1 relative w-full'>
          <span className='sticky left-2 top-1.5'>
            <Search className='size-4 text-gray-300 z-20 pointer-events-none' />
          </span>
          <div
            ref={pillsContainerRef}
            className='flex flex-wrap items-center gap-1.5 absolute left-9 -top-0 z-10 pointer-events-none'
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
              'w-full text-[14px] min-w-[120px] text-gray-700 border-none font-normal bg-transparent relative placeholder:text-gray-500 outline-none focus:outline-none',
            )}
            style={{
              paddingLeft: `${pillsWidth + 24}px`,
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
                className='border border-[#E1E4EA] min-w-[var(--anchor-width)] max-h-[14rem] rounded-lg bg-white text-gray-900 transition duration-100 origin-[var(--transform-origin)] data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95 shadow-lg pointer-events-auto'
              >
                {filteredOptions.length === 0 ? (
                  <BaseCombobox.Empty>
                    <p className='text-sm text-gray-600 px-4 py-3'>No options found</p>
                  </BaseCombobox.Empty>
                ) : (
                  <BaseCombobox.List
                    className={cn(
                      'overflow-y-auto overscroll-contain py-1 m-1.5 outline-none cursor-pointer',
                      'max-h-[min(13rem,var(--available-height))] data-[empty]:p-0 space-y-1',
                      'no-scrollbar',
                    )}
                  >
                    {filteredOptions.map(user => (
                      <BaseCombobox.Item
                        key={user.id}
                        value={user.id}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-sm hover:bg-gray-100 data-[highlighted]:bg-gray-200',
                        )}
                      >
                        <Avatar
                          userId={user.id}
                          size={'sm'}
                          showActiveStatus={false}
                          className='rounded-md size-[18px] flex items-center justify-center bg-white'
                        />
                        <div className='flex-1 w-full flex items-center gap-2'>
                          <span className='text-sm'>{user.name.split(' ')[0]}</span>
                          {user.status === UserStatus.ACTIVE ? (
                            <span className='w-1.5 h-1.5 bg-green-600 rounded-full'></span>
                          ) : (
                            <span className='w-1.5 h-1.5 border border-gray-500 rounded-full'></span>
                          )}
                          <span className='text-sm text-gray-500'>{user.name}</span>
                        </div>
                      </BaseCombobox.Item>
                    ))}
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
        'flex items-center justify-center gap-1 px-2 py-1 bg-gray-100 rounded-md text-sm border border-gray-200 pointer-events-auto',
        isFocused && 'bg-gray-200 border-gray-500',
      )}
    >
      <Avatar userId={user.id} size='sm' showActiveStatus={false} />
      <span className='truncate max-w-80'>{user.name}</span>
      <Button
        size='icon'
        variant='ghost'
        onClick={handleClick}
        className='ml-1 hover:bg-gray-200 rounded p-0.5 size-4'
        aria-label={`Remove ${user.name} from list`}
      >
        <X className='size-3' />
      </Button>
    </div>
  );
});

UserPill.displayName = 'UserPill';
