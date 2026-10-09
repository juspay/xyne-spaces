import {
  forwardRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import { FilterLines } from '@xyne/icons';
import { Check, ChevronRight, Search } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Popover } from '@/components/ui/Popover/index';
import { EntitySelector } from '@/components/ui/EntitySelector/EntitySelector';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface LibraryFilterOption {
  id: string;
  label: string;
  count?: number;
  icon?: ReactNode;
}

export interface LibraryFilterGroup {
  title: string;
  options: LibraryFilterOption[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
}

const SEARCH_AFTER = 8;

const isActiveIn = (group: LibraryFilterGroup, option: LibraryFilterOption): boolean =>
  option.id === group.activeId || (option.id === 'all' && !group.activeId);

const pick = (group: LibraryFilterGroup, option: LibraryFilterOption): void =>
  group.onSelect(option.id === 'all' || isActiveIn(group, option) ? null : option.id);

const TriggerButton = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<'button'> & { active: boolean; label: string; trackName: string }
>(({ active, label, trackName, ...rest }, ref) => (
  <button
    ref={ref}
    type='button'
    aria-label={label}
    className={cn(
      'flex size-7 items-center justify-center rounded-[10px] transition-colors hover:bg-muted',
      active ? 'bg-muted text-foreground' : 'text-muted-foreground',
    )}
    data-track-category='Claw Agents'
    data-track-name={trackName}
    {...rest}
  >
    <FilterLines className='size-4' />
  </button>
));
TriggerButton.displayName = 'LibraryFilterTrigger';

/** One group per side sub-popup, rows styled like EntitySelector (the SDLC hub picker). */
function GroupSubmenu({
  group,
  trackName,
}: {
  group: LibraryFilterGroup;
  trackName: string;
}): ReactElement {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const active = group.options.find(option => option.id === group.activeId);
  const visible = group.options.filter(
    option => !q || option.id === 'all' || option.label.toLowerCase().includes(q),
  );

  return (
    <DropdownMenuSub onOpenChange={open => !open && setSearch('')}>
      <DropdownMenuSubTrigger
        className='justify-between rounded-md text-foreground'
        data-track-category='Claw Agents'
        data-track-name={`${trackName}: open ${group.title}`}
      >
        <span>{group.title}</span>
        <span className='flex min-w-0 items-center gap-1 text-muted-foreground'>
          <span className='max-w-32 truncate'>{active?.label ?? 'All'}</span>
          <ChevronRight className='size-4 shrink-0' />
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        sideOffset={8}
        alignOffset={-5}
        className='w-64 overflow-hidden rounded-lg border-border p-0 shadow-lg'
      >
        {group.options.length > SEARCH_AFTER && (
          <div className='border-b border-border p-2'>
            <div className='relative'>
              <Search className='absolute left-1 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
              <input
                autoFocus
                value={search}
                onChange={event => setSearch(event.target.value)}
                // Arrows move into the list; other keys would trip the menu's typeahead.
                onKeyDown={event => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
                    event.stopPropagation();
                  }
                }}
                placeholder={`Search ${group.title.toLowerCase()}...`}
                className='w-full bg-transparent pl-7 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground'
                data-track-category='Claw Agents'
                data-track-name={`${trackName}: search ${group.title}`}
              />
            </div>
          </div>
        )}
        <div className='max-h-72 overflow-y-auto p-1 [scrollbar-width:thin]'>
          {visible.map(option => {
            const selected = isActiveIn(group, option);
            return (
              <DropdownMenuItem
                key={option.id}
                onSelect={() => pick(group, option)}
                className='rounded px-2 py-1.5 text-foreground focus:bg-accent'
                data-track-category='Claw Agents'
                data-track-name={`${trackName}: ${option.label}`}
              >
                {option.icon && (
                  <span className='flex size-5 flex-none items-center justify-center'>
                    {option.icon}
                  </span>
                )}
                <span className='min-w-0 flex-1 truncate font-medium'>{option.label}</span>
                {option.count !== undefined && (
                  <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                    {option.count}
                  </span>
                )}
                <Check
                  className={cn(
                    'size-4 shrink-0 text-action-primary',
                    selected ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </DropdownMenuItem>
            );
          })}
          {visible.length === 0 && (
            <span className='block px-2 py-1.5 text-sm text-muted-foreground'>No matches</span>
          )}
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function LibraryFilterMenu({
  title,
  options,
  activeId,
  onSelect,
  trackName,
  extraGroups = [],
  searchable = false,
}: {
  title: string;
  options: LibraryFilterOption[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  trackName: string;
  /** Turns the menu into one sub-popup per group, these first. */
  extraGroups?: LibraryFilterGroup[];
  /** Single searchable list, opened straight from the icon as an EntitySelector. */
  searchable?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const main: LibraryFilterGroup = { title, options, activeId, onSelect };

  if (extraGroups.length > 0) {
    const groups = [...extraGroups, main];
    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <TriggerButton
            active={open || groups.some(group => group.activeId)}
            label={`Filter by ${groups.map(group => group.title.toLowerCase()).join(' and ')}`}
            trackName={trackName}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' sideOffset={6} className='w-60 rounded-lg p-1.5 shadow-lg'>
          {groups.map(group => (
            <GroupSubmenu key={group.title} group={group} trackName={trackName} />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (searchable) {
    const all = options.find(option => option.id === 'all');
    return (
      <EntitySelector
        options={options
          .filter(option => option.id !== 'all')
          .map(option => ({ value: option.id, label: option.label, icon: option.icon ?? null }))}
        selectedValue={activeId}
        onSelect={onSelect}
        placeholder={title}
        searchPlaceholder={`Search ${title.toLowerCase()}...`}
        showUnassignOption={Boolean(activeId)}
        unassignLabel={all?.label ?? 'All'}
        align='end'
        dropdownMinWidth='16rem'
        renderTrigger={({ open: selectorOpen }) => (
          <TriggerButton
            active={selectorOpen || Boolean(activeId)}
            label={`Filter by ${title.toLowerCase()}`}
            trackName={trackName}
          />
        )}
      />
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align='end'
      sideOffset={6}
      trigger={
        <TriggerButton
          active={open || Boolean(activeId)}
          label={`Filter by ${title.toLowerCase()}`}
          trackName={trackName}
        />
      }
      className='w-56 rounded-lg border border-border bg-popover p-1 shadow-lg'
    >
      <div className='flex flex-col'>
        <span className='px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
          {title}
        </span>
        {options.map(option => {
          const isActive = isActiveIn(main, option);
          return (
            <button
              key={option.id}
              type='button'
              onClick={() => {
                pick(main, option);
                setOpen(false);
              }}
              data-track-category='Claw Agents'
              data-track-name={`${trackName}: ${option.label}`}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                isActive
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span className='truncate'>{option.label}</span>
              {option.count !== undefined && (
                <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                  {option.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
