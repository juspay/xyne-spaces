import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { SlidersHorizontal, Users, GitBranch, ChevronLeft, CheckIcon } from 'lucide-react';
import { Button } from '../ui/Button/Button';
import Avatar from '../ui/Avatar/Avatar';
import { cn } from '../../utils/classNames';
import { useUserSearch } from '../../hooks/useUsers';
import { useWorkflowTypes } from '../../hooks/useWorkflowTypes';
import type { User } from '@xyne/shared';

type MenuView = 'list' | 'assignedTo' | 'createdBy' | 'workflowType';

interface FilterMenuProps {
  assignedToUsers: User[];
  createdByUsers: User[];
  workflowTypeFilter: string[];
  onAssignedToChange: (users: User[]) => void;
  onCreatedByChange: (users: User[]) => void;
  onWorkflowTypeChange: (values: string[]) => void;
}

/* ── User search sub-view ── */
const UserSearchView: React.FC<{
  title: string;
  selectedUsers: User[];
  onToggle: (user: User) => void;
  onBack: () => void;
}> = ({ title, selectedUsers, onToggle, onBack }) => {
  const [search, setSearch] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useUserSearch(search, 10);
  const selectedIds = useMemo(() => new Set(selectedUsers.map(u => u.id)), [selectedUsers]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (focusedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[focusedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(prev => Math.min(prev + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < results.length && results[focusedIndex]) {
          onToggle(results[focusedIndex]);
        }
        break;
    }
  };

  return (
    <div className='w-[240px]'>
      <div className='flex items-center gap-1 px-1 py-1'>
        <button
          type='button'
          onClick={onBack}
          data-track-category='Tickets'
          data-track-name='FilterMenuBack'
          className='p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
        >
          <ChevronLeft className='size-4' />
        </button>
        <span className='text-sm font-medium text-foreground'>{title}</span>
      </div>
      <div className='p-1.5'>
        <input
          ref={searchRef}
          type='text'
          value={search}
          data-track-category='Tickets'
          data-track-name='FilterUserSearch'
          onChange={e => {
            setSearch(e.target.value);
            setFocusedIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder='Search users...'
          className='w-full h-7 px-2 text-sm bg-transparent border border-input rounded-sm outline-none focus:border-ring placeholder:text-muted-foreground'
        />
      </div>
      <div
        ref={listRef}
        className='max-h-[200px] overflow-y-auto scrollbar-none p-1'
        role='listbox'
      >
        {results.length === 0 ? (
          <div className='px-2 py-4 text-center text-sm text-muted-foreground'>
            {search.trim() ? 'No users found' : 'Type to search'}
          </div>
        ) : (
          results.map((user, index) => {
            const isSelected = selectedIds.has(user.id);
            const isFocused = index === focusedIndex;
            return (
              <button
                key={user.id}
                type='button'
                role='option'
                aria-selected={isSelected}
                onClick={() => onToggle(user)}
                onMouseEnter={() => setFocusedIndex(index)}
                data-track-category='Tickets'
                data-track-name='ToggleUserFilter'
                className={cn(
                  'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none transition-colors',
                  isFocused
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Avatar userId={user.id} size='sm' showActiveStatus={false} />
                <span className='truncate'>{user.name}</span>
                {isSelected && (
                  <span className='absolute right-2 flex size-3.5 items-center justify-center'>
                    <CheckIcon className='size-4 text-foreground' />
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

/* ── Workflow type checklist sub-view ── */
const WorkflowTypeView: React.FC<{
  selectedValues: string[];
  onToggle: (value: string) => void;
  onBack: () => void;
}> = ({ selectedValues, onToggle, onBack }) => {
  const { workflowTypes, isLoading } = useWorkflowTypes();
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return workflowTypes;
    const q = search.toLowerCase();
    return workflowTypes.filter(wf => wf.label.toLowerCase().includes(q));
  }, [workflowTypes, search]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  return (
    <div className='w-[240px]'>
      <div className='flex items-center gap-1 px-1 py-1'>
        <button
          type='button'
          onClick={onBack}
          data-track-category='Tickets'
          data-track-name='FilterMenuBack'
          className='p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent'
        >
          <ChevronLeft className='size-4' />
        </button>
        <span className='text-sm font-medium text-foreground'>Workflow Type</span>
      </div>
      <div className='p-1.5'>
        <input
          ref={searchRef}
          type='text'
          value={search}
          data-track-category='Tickets'
          data-track-name='FilterWorkflowTypeSearch'
          onChange={e => setSearch(e.target.value)}
          placeholder='Search...'
          className='w-full h-7 px-2 text-sm bg-transparent border border-input rounded-sm outline-none focus:border-ring placeholder:text-muted-foreground'
        />
      </div>
      <div className='max-h-[200px] overflow-y-auto scrollbar-none p-1' role='listbox'>
        {isLoading ? (
          <div className='px-2 py-4 text-center text-sm text-muted-foreground'>Loading...</div>
        ) : filtered.length === 0 ? (
          <div className='px-2 py-4 text-center text-sm text-muted-foreground'>
            No workflow types
          </div>
        ) : (
          filtered.map(wf => {
            const isSelected = selectedValues.includes(wf.id);
            return (
              <button
                key={wf.id}
                type='button'
                role='option'
                aria-selected={isSelected}
                onClick={() => onToggle(wf.id)}
                data-track-category='Tickets'
                data-track-name='ToggleWorkflowTypeFilter'
                className={cn(
                  'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <span className='truncate'>{wf.label}</span>
                {isSelected && (
                  <span className='absolute right-2 flex size-3.5 items-center justify-center'>
                    <CheckIcon className='size-4 text-foreground' />
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

/* ── Main filter menu ── */
const FilterMenu: React.FC<FilterMenuProps> = ({
  assignedToUsers,
  createdByUsers,
  workflowTypeFilter,
  onAssignedToChange,
  onCreatedByChange,
  onWorkflowTypeChange,
}) => {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MenuView>('list');

  // Reset to list view when closing
  useEffect(() => {
    if (!open) setView('list');
  }, [open]);

  const toggleAssignedTo = useCallback(
    (user: User) => {
      const exists = assignedToUsers.some(u => u.id === user.id);
      if (exists) {
        onAssignedToChange(assignedToUsers.filter(u => u.id !== user.id));
      } else {
        onAssignedToChange([...assignedToUsers, user]);
      }
    },
    [assignedToUsers, onAssignedToChange],
  );

  const toggleCreatedBy = useCallback(
    (user: User) => {
      const exists = createdByUsers.some(u => u.id === user.id);
      if (exists) {
        onCreatedByChange(createdByUsers.filter(u => u.id !== user.id));
      } else {
        onCreatedByChange([...createdByUsers, user]);
      }
    },
    [createdByUsers, onCreatedByChange],
  );

  const toggleWorkflowType = useCallback(
    (value: string) => {
      if (workflowTypeFilter.includes(value)) {
        onWorkflowTypeChange(workflowTypeFilter.filter(v => v !== value));
      } else {
        onWorkflowTypeChange([...workflowTypeFilter, value]);
      }
    },
    [workflowTypeFilter, onWorkflowTypeChange],
  );

  const hasActiveFilters =
    assignedToUsers.length > 0 || createdByUsers.length > 0 || workflowTypeFilter.length > 0;

  const menuItems: { key: MenuView; label: string; icon: React.ReactNode; count: number }[] = [
    {
      key: 'assignedTo',
      label: 'Assigned To',
      icon: <Users className='size-4 text-muted-foreground' />,
      count: assignedToUsers.length,
    },
    {
      key: 'createdBy',
      label: 'Created By',
      icon: <Users className='size-4 text-muted-foreground' />,
      count: createdByUsers.length,
    },
    {
      key: 'workflowType',
      label: 'Workflow Type',
      icon: <GitBranch className='size-4 text-muted-foreground' />,
      count: workflowTypeFilter.length,
    },
  ];

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {/* !transition-none overrides Button's transition-all to prevent theme switch lag */}
        <Button
          data-id='ticket-header-filter-btn'
          variant='outline'
          size='iconSm'
          className='relative size-7 rounded-full !transition-none'
        >
          <SlidersHorizontal className='size-3.5' />
          {hasActiveFilters && (
            <span className='absolute top-0 right-0 size-2 rounded-full bg-action-primary' />
          )}
        </Button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side='bottom'
          align='end'
          sideOffset={4}
          className={cn(
            'z-50 rounded-xl border bg-popover text-popover-foreground shadow-md p-2',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'data-[side=bottom]:slide-in-from-top-2',
          )}
          onOpenAutoFocus={e => e.preventDefault()}
          onCloseAutoFocus={e => e.preventDefault()}
        >
          {view === 'list' && (
            <div className='w-[200px]'>
              {menuItems.map(item => (
                <button
                  key={item.key}
                  type='button'
                  onClick={() => setView(item.key)}
                  data-track-category='Tickets'
                  data-track-name='OpenFilterSubMenu'
                  className='flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none transition-colors hover:bg-accent hover:text-accent-foreground'
                >
                  {item.icon}
                  <span className='flex-1 text-left'>{item.label}</span>
                  {item.count > 0 && (
                    <span className='text-xs text-action-primary-foreground bg-action-primary px-1.5 py-0.5 rounded'>
                      {item.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {view === 'assignedTo' && (
            <UserSearchView
              title='Assigned To'
              selectedUsers={assignedToUsers}
              onToggle={toggleAssignedTo}
              onBack={() => setView('list')}
            />
          )}

          {view === 'createdBy' && (
            <UserSearchView
              title='Created By'
              selectedUsers={createdByUsers}
              onToggle={toggleCreatedBy}
              onBack={() => setView('list')}
            />
          )}

          {view === 'workflowType' && (
            <WorkflowTypeView
              selectedValues={workflowTypeFilter}
              onToggle={toggleWorkflowType}
              onBack={() => setView('list')}
            />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default FilterMenu;
