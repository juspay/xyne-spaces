import { useState, useRef, useEffect, ReactElement } from 'react';
import { Users, X } from 'lucide-react';
import type { User } from '../../machines/authMachine';
import type { OtherUserCalls } from '../../hooks/useOtherUserCalls';
import Avatar from '../../components/ui/Avatar/Avatar';
import { getUserDisplayName } from '../../utils/userDisplayName';

// Wider type for the search list — zero-generated users have picture: string | null
// which conflicts with authMachine User's index signature.
type UserLike = { id: string; name?: string | null; email?: string | null; [key: string]: unknown };

interface MeetWithPanelProps {
  allUsers: UserLike[];
  currentUserId?: string | undefined;
  selectedUsers: User[];
  otherUsersCalls: Map<string, OtherUserCalls>;
  onAddUser: (user: User) => void;
  onRemoveUser: (userId: string) => void;
  hideHeading?: boolean;
}

const MeetWithPanel = ({
  allUsers,
  currentUserId,
  selectedUsers,
  otherUsersCalls,
  onAddUser,
  onRemoveUser,
  hideHeading = false,
}: MeetWithPanelProps): ReactElement => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chipsScrollRef = useRef<HTMLDivElement>(null);

  const suggestions = query.trim()
    ? allUsers.filter(u => {
        if (u.id === currentUserId) return false;
        if (selectedUsers.find(s => s.id === u.id)) return false;
        const q = query.toLowerCase();
        return u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
      })
    : [];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll chips to end when a new user is added
  useEffect(() => {
    if (chipsScrollRef.current) {
      chipsScrollRef.current.scrollLeft = chipsScrollRef.current.scrollWidth;
    }
  }, [selectedUsers.length]);

  return (
    <div className='flex flex-col gap-0'>
      {!hideHeading && (
        <span className='text-sm font-semibold text-foreground mb-2'>Meet with...</span>
      )}

      <div ref={containerRef} className='relative'>
        {/* Tag input: chips + search field in one scrollable row */}
        <div
          role='button'
          tabIndex={0}
          className='flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-muted cursor-text overflow-hidden'
          data-track-category='CALENDAR'
          data-track-name='meet-with-input-focus'
          onClick={() => inputRef.current?.focus()}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.focus();
          }}
        >
          <Users className='size-4 text-muted-foreground shrink-0' />

          {/* Horizontally scrollable chips + input */}
          <div
            ref={chipsScrollRef}
            className='flex items-center gap-1.5 overflow-x-auto min-w-0 flex-1 scrollbar-hide'
            style={{ scrollbarWidth: 'none' }}
          >
            {selectedUsers.map(user => {
              const data = otherUsersCalls.get(user.id);
              const color = data?.color ?? '#94a3b8';
              return (
                <div
                  key={user.id}
                  className='flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full text-xs font-medium bg-background border border-border shrink-0'
                >
                  <span
                    className='size-2 rounded-full shrink-0'
                    style={{ backgroundColor: color }}
                  />
                  <span className='text-foreground whitespace-nowrap'>
                    {getUserDisplayName(user) ?? user.email}
                  </span>
                  <button
                    className='text-muted-foreground hover:text-foreground transition-colors ml-0.5'
                    onMouseDown={e => {
                      e.preventDefault();
                      onRemoveUser(user.id);
                    }}
                    aria-label={`Remove ${user.name}`}
                  >
                    <X className='size-3' />
                  </button>
                </div>
              );
            })}
            <input
              ref={inputRef}
              className='bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none shrink-0'
              style={{ minWidth: selectedUsers.length > 0 ? '80px' : '120px' }}
              placeholder={selectedUsers.length === 0 ? 'Meet with people' : ''}
              value={query}
              data-track-category='CALENDAR'
              data-track-name='meet-with-search'
              onChange={e => {
                setQuery(e.target.value);
                setIsOpen(true);
              }}
              onFocus={() => setIsOpen(true)}
            />
          </div>
        </div>

        {/* Dropdown */}
        {isOpen && suggestions.length > 0 && (
          <div className='absolute z-50 mt-1 w-full bg-popover border border-border rounded-xl shadow-md overflow-hidden'>
            {suggestions.slice(0, 8).map(user => (
              <button
                key={user.id}
                className='w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-left'
                onMouseDown={e => {
                  e.preventDefault();
                  onAddUser(user as unknown as User);
                  setQuery('');
                  setIsOpen(false);
                }}
              >
                <Avatar userId={user.id ?? null} size='sm' />
                <span className='truncate'>{getUserDisplayName(user) ?? user.email}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MeetWithPanel;
