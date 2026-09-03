import {
  Fragment,
  ReactElement,
  useState,
  useMemo,
  useRef,
  useCallback,
  KeyboardEvent,
} from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ArrowUpDown, Check, ChevronDown, Hash, SlidersHorizontal, User, X } from 'lucide-react';
import { Button } from '../../ui/Button';
import Avatar from '../../ui/Avatar/Avatar';
import { cn } from '../../../utils/classNames';
import { useUserSearch, useUsers } from '../../../hooks/useUsers';
import { useAllChannels, useAllVisibleChannels } from '../../../hooks/useChannels';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { isDMChannel, resolveChannelLabel } from '../../Chat/ChatDirectory/ChatDirectory.utils';
import { type SearchResultsFilters } from '../../../hooks/useSearchResultsScreen';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { type Channel } from '@xyne/shared';
import { clearInapplicable } from '../../../search/filterRegistry';
import {
  useCmdkDefaultRankProfiles,
  cmdkTabKeyForDocType,
} from '../../../hooks/useCmdkSearchConfig';
import { FiltersModal } from './filters/FiltersModal';
import { CHIP_ACTIVE, CHIP_BASE, MENU_ITEM, POPOVER_CONTENT } from './filters/styles';

interface SearchFilterBarProps {
  filters: SearchResultsFilters;
  onFiltersChange: (filters: SearchResultsFilters) => void;
}

const TYPE_OPTIONS = [
  { value: 'all' as const, label: 'All types' },
  { value: 'messages' as const, label: 'Messages' },
  { value: 'files' as const, label: 'Files' },
  { value: 'tickets' as const, label: 'Tickets' },
  { value: 'channels' as const, label: 'Channels' },
  { value: 'desk' as const, label: 'Desk' },
  { value: 'people' as const, label: 'People' },
];

const TYPE_LABELS: Record<SearchResultsFilters['docType'], string> = {
  all: 'All types',
  messages: 'Messages',
  files: 'Files',
  tickets: 'Tickets',
  channels: 'Channels',
  desk: 'Desk',
  people: 'People',
};

function ChannelFilterItem({
  channel,
  currentUserId,
  selected,
  highlighted,
  onClick,
  onMouseEnter,
}: {
  channel: Channel;
  currentUserId: string;
  selected: boolean;
  highlighted: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
}): ReactElement {
  const { displayName } = useChannelDisplayName(channel, currentUserId);
  const isChannelDM = isDMChannel(channel.scopeType);
  return (
    <button
      data-list-item
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(MENU_ITEM, highlighted && 'bg-muted')}
      data-track-category='SEARCH_FILTERS'
      data-track-name='TOGGLE_CHANNEL'
    >
      <Check className={cn('size-3.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
      {isChannelDM ? (
        <User className='size-3.5 shrink-0 text-muted-foreground' />
      ) : (
        <Hash className='size-3.5 shrink-0 text-muted-foreground' />
      )}
      <span className='truncate'>{displayName}</span>
    </button>
  );
}

const SORT_OPTIONS = [
  { value: 'relevance' as const, label: 'Relevance' },
  { value: 'newest' as const, label: 'Newest' },
  { value: 'oldest' as const, label: 'Oldest' },
];

// Explicit rank-profile picks per docType, scoped to the schema(s) each type queries —
// Vespa rejects a profile missing from any queried schema. getRankProfileOptions()
// prepends a `value: ''` row ("no explicit pick"), labeled with the per-tab CAC default
// (useCmdkDefaultRankProfiles) at render time — the default is never hardcoded here.
type RankProfileOption = { value: string; label: string };
const RANK_PROFILE_OPTIONS_BY_TYPE: Partial<
  Record<SearchResultsFilters['docType'], RankProfileOption[]>
> = {
  all: [
    { value: 'default_native', label: 'default_native' },
    { value: 'personalized', label: 'personalized' },
    { value: 'default_fuzzy', label: 'default_fuzzy' },
    { value: 'unified', label: 'unified' },
  ],
  messages: [
    { value: 'default_native', label: 'default_native' },
    { value: 'personalized', label: 'personalized' },
    { value: 'default_random', label: 'default_random' },
    { value: 'default_fuzzy', label: 'default_fuzzy' },
    ...Array.from({ length: 23 }, (_, i) => ({
      value: `default_native_${i}`,
      label: `default_native_${i}`,
    })),
  ],
  files: [
    { value: 'default_native', label: 'default_native' },
    { value: 'personalized', label: 'personalized' },
    { value: 'default_fuzzy', label: 'default_fuzzy' },
  ],
  tickets: [
    { value: 'default_native', label: 'default_native' },
    { value: 'personalized', label: 'personalized' },
    { value: 'default_fuzzy', label: 'default_fuzzy' },
    { value: 'semantic_ranking', label: 'semantic_ranking' },
  ],
  desk: [
    { value: 'default_native', label: 'default_native' },
    { value: 'personalized', label: 'personalized' },
    { value: 'default_fuzzy', label: 'default_fuzzy' },
    { value: 'global_sorted', label: 'global_sorted' },
    { value: 'default_bm25', label: 'default_bm25' },
    { value: 'default_ai', label: 'default_ai' },
  ],
};

/**
 * Switching type drops the filters that type can't express, so the bar never shows an
 * active filter the query won't apply. Rank profiles are schema-scoped, so they reset too.
 */
function applyDocTypeChange(
  filters: SearchResultsFilters,
  docType: SearchResultsFilters['docType'],
): SearchResultsFilters {
  const next = { ...filters, docType, rankProfile: '' };
  // Each registry entry declares which types can express it; the ones this type can't are
  // cleared, so the bar never shows an active filter the query won't apply.
  return { ...next, ...clearInapplicable(next) };
}

function getRankProfileOptions(
  docType: SearchResultsFilters['docType'],
  resolvedDefault: string,
): RankProfileOption[] {
  const explicit = RANK_PROFILE_OPTIONS_BY_TYPE[docType];
  if (!explicit) return [];
  return [
    { value: '', label: resolvedDefault },
    // drop the explicit row the default row already covers
    ...explicit.filter(o => o.value !== resolvedDefault),
  ];
}

function useListKeyNav(
  length: number,
  onSelect: (index: number) => void,
  onClose: () => void,
): {
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  handleKeyDown: (e: KeyboardEvent) => void;
  handleInputKeyDown: (e: KeyboardEvent) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
} {
  const [activeIndex, setActiveIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const scrollActiveIntoView = useCallback((index: number) => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll<HTMLElement>('[data-list-item]');
    items[index]?.scrollIntoView({ block: 'nearest' });
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
        // Arrow keys wrap; Tab stops at the last item so focus can escape naturally.
        if (e.key === 'Tab' && activeIndex >= length - 1) return;
        e.preventDefault();
        setActiveIndex(i => {
          const next = i < length - 1 ? i + 1 : 0;
          scrollActiveIntoView(next);
          return next;
        });
      } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
        // Shift+Tab stops at the first item so focus can escape backwards.
        if (e.key === 'Tab' && activeIndex <= 0) return;
        e.preventDefault();
        setActiveIndex(i => {
          const next = i > 0 ? i - 1 : length - 1;
          scrollActiveIntoView(next);
          return next;
        });
      } else if (e.key === 'Enter' && activeIndex >= 0) {
        e.preventDefault();
        onSelect(activeIndex);
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [length, activeIndex, onSelect, onClose, scrollActiveIntoView],
  );

  const handleInputKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(0);
        scrollActiveIntoView(0);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(length - 1);
        scrollActiveIntoView(length - 1);
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [length, onClose, scrollActiveIntoView],
  );

  return { activeIndex, setActiveIndex, handleKeyDown, handleInputKeyDown, listRef };
}

function openOnArrowDown(open: boolean, setOpen: (v: boolean) => void) {
  return (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'ArrowDown' && !open) {
      e.preventDefault();
      setOpen(true);
    }
  };
}

export function SearchFilterBar({ filters, onFiltersChange }: SearchFilterBarProps): ReactElement {
  const defaultRankProfileFor = useCmdkDefaultRankProfiles();
  const [typeOpen, setTypeOpen] = useState(false);
  const [fromOpen, setFromOpen] = useState(false);
  const [inOpen, setInOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [rankOpen, setRankOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [fromQuery, setFromQuery] = useState('');
  const [inQuery, setInQuery] = useState('');

  const fromUsers = useUserSearch(fromQuery, 20) ?? [];
  const allChannels = useAllVisibleChannels();
  const allUsers = useUsers();
  const { userID: currentUserId } = useAuthContextValues();

  const knownChannelsForLabels = useAllChannels();

  const filteredChannels = useMemo(() => {
    const q = inQuery.toLowerCase().trim();
    if (!q) return allChannels.slice(0, 20);
    return allChannels.filter(c => c.name.toLowerCase().includes(q)).slice(0, 20);
  }, [allChannels, inQuery]);

  /**
   * Applied options first, then the rest, so the popover can rule a line under what's
   * already on. An applied option is always present even when the query or the 20-row cap
   * wouldn't return it — otherwise a filter you can see on the chip vanishes from the list
   * that's supposed to let you turn it off.
   */
  const fromOptions = useMemo(() => {
    const selected = filters.fromUserIds
      .map(id => fromUsers.find(u => u.id === id) ?? allUsers.find(u => u.id === id))
      .filter((u): u is (typeof fromUsers)[number] => Boolean(u));
    const selectedIds = new Set(selected.map(u => u.id));
    return {
      selectedCount: selected.length,
      list: [...selected, ...fromUsers.filter(u => !selectedIds.has(u.id))],
    };
  }, [filters.fromUserIds, fromUsers, allUsers]);

  const inOptions = useMemo(() => {
    const selected = filters.inChannelIds
      .map(id => filteredChannels.find(c => c.id === id) ?? allChannels.find(c => c.id === id))
      .filter((c): c is (typeof filteredChannels)[number] => Boolean(c));
    const selectedIds = new Set(selected.map(c => c.id));
    return {
      selectedCount: selected.length,
      list: [...selected, ...filteredChannels.filter(c => !selectedIds.has(c.id))],
    };
  }, [filters.inChannelIds, filteredChannels, allChannels]);

  const isTypeActive = filters.docType !== 'all';
  const isFromActive = filters.fromUserIds.length > 0;
  const isInActive = filters.inChannelIds.length > 0;
  const isSortActive = filters.sortBy !== 'relevance';

  // Applied chips name their value the way Slack's do — "From nasim", not "From (1)".
  const namedChipLabel = (field: string, ids: string[], nameOf: (id: string) => string): string => {
    if (ids.length === 0) return field;
    const only = ids[0];
    if (ids.length === 1 && only !== undefined) return `${field} ${nameOf(only)}`;
    return `${field} (${ids.length})`;
  };
  const fromChipLabel = namedChipLabel('From', filters.fromUserIds, id => {
    const user = allUsers.find(u => u.id === id);
    return user ? getUserDisplayName(user) : id;
  });
  // No `#` in the name — the chip already leads with a Hash glyph.
  const inChipLabel = namedChipLabel('In', filters.inChannelIds, id => {
    // Falls back to every known channel: a selected DM or a channel the user has left
    // isn't in the *visible* set, and the chip must never read as a raw id.
    const channel =
      allChannels.find(c => c.id === id) ?? knownChannelsForLabels.find(c => c.id === id);
    return channel ? resolveChannelLabel(channel, currentUserId ?? '', allUsers) : id;
  });

  const resolvedDefaultRankProfile = defaultRankProfileFor(cmdkTabKeyForDocType(filters.docType));
  const rankProfileOptions = getRankProfileOptions(filters.docType, resolvedDefaultRankProfile);
  const showRankProfile = rankProfileOptions.length > 0;
  const isRankActive = filters.rankProfile !== '';
  // fallback: a profile not in the list — show it verbatim
  const rankProfileLabel =
    rankProfileOptions.find(o => o.value === filters.rankProfile)?.label ?? filters.rankProfile;

  const showFromIn = filters.docType !== 'channels' && filters.docType !== 'people';

  function toggleUser(userId: string): void {
    const next = filters.fromUserIds.includes(userId)
      ? filters.fromUserIds.filter(id => id !== userId)
      : [...filters.fromUserIds, userId];
    onFiltersChange({ ...filters, fromUserIds: next });
  }

  function toggleChannel(channelId: string): void {
    const next = filters.inChannelIds.includes(channelId)
      ? filters.inChannelIds.filter(id => id !== channelId)
      : [...filters.inChannelIds, channelId];
    onFiltersChange({ ...filters, inChannelIds: next });
  }

  // Keyboard nav for each popover
  const typeNav = useListKeyNav(
    TYPE_OPTIONS.length,
    i => {
      const opt = TYPE_OPTIONS[i];
      if (!opt) return;
      onFiltersChange(applyDocTypeChange(filters, opt.value));
      setTypeOpen(false);
    },
    () => setTypeOpen(false),
  );

  const fromNav = useListKeyNav(
    fromOptions.list.length,
    i => {
      const user = fromOptions.list[i];
      if (user) toggleUser(user.id);
    },
    () => {
      setFromOpen(false);
      setFromQuery('');
    },
  );

  const inNav = useListKeyNav(
    inOptions.list.length,
    i => {
      const channel = inOptions.list[i];
      if (channel) toggleChannel(channel.id);
    },
    () => {
      setInOpen(false);
      setInQuery('');
    },
  );

  const sortNav = useListKeyNav(
    SORT_OPTIONS.length,
    i => {
      const opt = SORT_OPTIONS[i];
      if (!opt) return;
      onFiltersChange({ ...filters, sortBy: opt.value });
      setSortOpen(false);
    },
    () => setSortOpen(false),
  );

  const rankNav = useListKeyNav(
    rankProfileOptions.length,
    i => {
      const opt = rankProfileOptions[i];
      if (!opt) return;
      onFiltersChange({ ...filters, rankProfile: opt.value });
      setRankOpen(false);
    },
    () => setRankOpen(false),
  );

  return (
    <div className='w-full pb-2 flex items-start gap-2'>
      {/* Left group: type + contextual filters + include bots */}
      <div className='flex items-center gap-2 flex-wrap flex-1'>
        {/* Type chip */}
        <Popover.Root
          open={typeOpen}
          onOpenChange={open => {
            setTypeOpen(open);
            if (open) typeNav.setActiveIndex(-1);
          }}
        >
          <Popover.Trigger asChild>
            <Button
              variant='outline'
              size='sm'
              className={cn(CHIP_BASE, isTypeActive && CHIP_ACTIVE)}
              onKeyDown={openOnArrowDown(typeOpen, setTypeOpen)}
            >
              {TYPE_LABELS[filters.docType]}
              <ChevronDown
                className={cn('size-3 transition-transform', typeOpen && 'rotate-180')}
              />
            </Button>
          </Popover.Trigger>
          <Popover.Content
            side='bottom'
            align='start'
            sideOffset={6}
            className={cn(POPOVER_CONTENT, 'min-w-[160px] p-1')}
            onKeyDown={typeNav.handleKeyDown}
          >
            <div ref={typeNav.listRef}>
              {TYPE_OPTIONS.map((opt, i) => (
                <button
                  key={opt.value}
                  data-list-item
                  onClick={() => {
                    onFiltersChange(applyDocTypeChange(filters, opt.value));
                    setTypeOpen(false);
                  }}
                  onMouseEnter={() => typeNav.setActiveIndex(i)}
                  className={cn(MENU_ITEM, typeNav.activeIndex === i && 'bg-muted')}
                  data-track-category='SEARCH_FILTERS'
                  data-track-name={`SET_TYPE_${opt.value.toUpperCase()}`}
                >
                  <Check
                    className={cn(
                      'size-3.5 shrink-0',
                      filters.docType === opt.value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {opt.label}
                </button>
              ))}
            </div>
          </Popover.Content>
        </Popover.Root>

        {/* From chip */}
        {showFromIn && (
          <Popover.Root
            open={fromOpen}
            onOpenChange={open => {
              setFromOpen(open);
              if (!open) setFromQuery('');
              if (open) fromNav.setActiveIndex(-1);
            }}
          >
            <Popover.Trigger asChild>
              <Button
                variant='outline'
                size='sm'
                className={cn(CHIP_BASE, isFromActive && CHIP_ACTIVE)}
                onKeyDown={openOnArrowDown(fromOpen, setFromOpen)}
              >
                {/* One person → their avatar; several → the generic glyph, since no single
                    face represents the set. */}
                {filters.fromUserIds.length === 1 && filters.fromUserIds[0] ? (
                  <Avatar userId={filters.fromUserIds[0]} size='xs' showActiveStatus={false} />
                ) : (
                  <User className='size-3' />
                )}
                {fromChipLabel}
                <ChevronDown
                  className={cn('size-3 transition-transform', fromOpen && 'rotate-180')}
                />
              </Button>
            </Popover.Trigger>
            <Popover.Content
              side='bottom'
              align='start'
              sideOffset={6}
              className={cn(POPOVER_CONTENT, 'w-64')}
              onKeyDown={fromNav.handleKeyDown}
            >
              <div className='p-2 border-b border-border'>
                <input
                  autoFocus
                  value={fromQuery}
                  onChange={e => {
                    setFromQuery(e.target.value);
                    fromNav.setActiveIndex(-1);
                  }}
                  onKeyDown={fromNav.handleInputKeyDown}
                  placeholder='Search people…'
                  className='w-full text-sm bg-transparent outline-none placeholder:text-muted-foreground'
                  data-track-category='SEARCH_FILTERS'
                  data-track-name='FROM_SEARCH_INPUT'
                />
              </div>
              <div className='max-h-52 overflow-y-auto py-1' ref={fromNav.listRef}>
                {fromOptions.list.length === 0 ? (
                  <p className='px-3 py-2 text-xs text-muted-foreground'>No users found</p>
                ) : (
                  fromOptions.list.map((user, i) => {
                    const selected = filters.fromUserIds.includes(user.id);
                    return (
                      <Fragment key={user.id}>
                        {i === fromOptions.selectedCount && fromOptions.selectedCount > 0 && (
                          <div className='my-1 border-t border-border' />
                        )}
                        <button
                          data-list-item
                          onClick={() => toggleUser(user.id)}
                          onMouseEnter={() => fromNav.setActiveIndex(i)}
                          className={cn(MENU_ITEM, fromNav.activeIndex === i && 'bg-muted')}
                          data-track-category='SEARCH_FILTERS'
                          data-track-name='TOGGLE_FROM_USER'
                        >
                          <Check
                            className={cn(
                              'size-3.5 shrink-0',
                              selected ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                          <Avatar userId={user.id} size='xs' showActiveStatus={false} />
                          <span className='truncate'>{getUserDisplayName(user)}</span>
                        </button>
                      </Fragment>
                    );
                  })
                )}
              </div>
              {isFromActive && (
                <div className='border-t border-border p-1'>
                  <button
                    onClick={() => onFiltersChange({ ...filters, fromUserIds: [] })}
                    className='flex w-full items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded'
                    data-track-category='SEARCH_FILTERS'
                    data-track-name='CLEAR_FROM'
                  >
                    <X className='size-3' /> Clear
                  </button>
                </div>
              )}
            </Popover.Content>
          </Popover.Root>
        )}

        {/* In chip */}
        {showFromIn && (
          <Popover.Root
            open={inOpen}
            onOpenChange={open => {
              setInOpen(open);
              if (!open) setInQuery('');
              if (open) inNav.setActiveIndex(-1);
            }}
          >
            <Popover.Trigger asChild>
              <Button
                variant='outline'
                size='sm'
                className={cn(CHIP_BASE, isInActive && CHIP_ACTIVE)}
                onKeyDown={openOnArrowDown(inOpen, setInOpen)}
              >
                <Hash className='size-3' />
                {inChipLabel}
                <ChevronDown
                  className={cn('size-3 transition-transform', inOpen && 'rotate-180')}
                />
              </Button>
            </Popover.Trigger>
            <Popover.Content
              side='bottom'
              align='start'
              sideOffset={6}
              className={cn(POPOVER_CONTENT, 'w-64')}
              onKeyDown={inNav.handleKeyDown}
            >
              <div className='p-2 border-b border-border'>
                <input
                  autoFocus
                  value={inQuery}
                  onChange={e => {
                    setInQuery(e.target.value);
                    inNav.setActiveIndex(-1);
                  }}
                  onKeyDown={inNav.handleInputKeyDown}
                  placeholder='Search channels…'
                  className='w-full text-sm bg-transparent outline-none placeholder:text-muted-foreground'
                  data-track-category='SEARCH_FILTERS'
                  data-track-name='IN_SEARCH_INPUT'
                />
              </div>
              <div className='max-h-52 overflow-y-auto py-1' ref={inNav.listRef}>
                {inOptions.list.length === 0 ? (
                  <p className='px-3 py-2 text-xs text-muted-foreground'>No channels found</p>
                ) : (
                  inOptions.list.map((channel, i) => (
                    <Fragment key={channel.id}>
                      {i === inOptions.selectedCount && inOptions.selectedCount > 0 && (
                        <div className='my-1 border-t border-border' />
                      )}
                      <ChannelFilterItem
                        channel={channel as unknown as Channel}
                        currentUserId={currentUserId}
                        selected={filters.inChannelIds.includes(channel.id)}
                        highlighted={inNav.activeIndex === i}
                        onClick={() => toggleChannel(channel.id)}
                        onMouseEnter={() => inNav.setActiveIndex(i)}
                      />
                    </Fragment>
                  ))
                )}
              </div>
              {isInActive && (
                <div className='border-t border-border p-1'>
                  <button
                    onClick={() => onFiltersChange({ ...filters, inChannelIds: [] })}
                    className='flex w-full items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded'
                    data-track-category='SEARCH_FILTERS'
                    data-track-name='CLEAR_IN'
                  >
                    <X className='size-3' /> Clear
                  </button>
                </div>
              )}
            </Popover.Content>
          </Popover.Root>
        )}

        {/* From and In are the only standalone chips; every other filter is set and shown
            inside the Filters dialog, which carries a count so they aren't invisible. */}
        <FiltersModal
          filters={filters}
          onFiltersChange={onFiltersChange}
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
        />
      </div>
      {/* end left group */}

      {/* Rank profile chip — pinned to the right; hidden for locally-filtered types */}
      {showRankProfile && (
        <Popover.Root
          open={rankOpen}
          onOpenChange={open => {
            setRankOpen(open);
            if (open) rankNav.setActiveIndex(-1);
          }}
        >
          <Popover.Trigger asChild>
            <Button
              variant='outline'
              size='sm'
              className={cn(CHIP_BASE, isRankActive && CHIP_ACTIVE)}
              onKeyDown={openOnArrowDown(rankOpen, setRankOpen)}
            >
              <SlidersHorizontal className='size-3' />
              {`Rank: ${rankProfileLabel}`}
              <ChevronDown
                className={cn('size-3 transition-transform', rankOpen && 'rotate-180')}
              />
            </Button>
          </Popover.Trigger>
          <Popover.Content
            side='bottom'
            align='end'
            sideOffset={6}
            className={cn(POPOVER_CONTENT, 'min-w-[180px] p-1 max-h-[320px] overflow-y-auto')}
            onKeyDown={rankNav.handleKeyDown}
          >
            <div ref={rankNav.listRef}>
              {rankProfileOptions.map((opt, i) => (
                <button
                  key={opt.value || 'default'}
                  data-list-item
                  onClick={() => {
                    onFiltersChange({ ...filters, rankProfile: opt.value });
                    setRankOpen(false);
                  }}
                  onMouseEnter={() => rankNav.setActiveIndex(i)}
                  className={cn(MENU_ITEM, rankNav.activeIndex === i && 'bg-muted')}
                  data-track-category='SEARCH_FILTERS'
                  data-track-name={`SET_RANK_PROFILE_${(opt.value || 'default').toUpperCase()}`}
                >
                  <Check
                    className={cn(
                      'size-3.5 shrink-0',
                      // the default row also owns an explicit pick equal to the default
                      // (its own row is deduped away; both send the same profile)
                      filters.rankProfile === opt.value ||
                        (opt.value === '' && filters.rankProfile === resolvedDefaultRankProfile)
                        ? 'opacity-100'
                        : 'opacity-0',
                    )}
                  />
                  {opt.label}
                </button>
              ))}
            </div>
          </Popover.Content>
        </Popover.Root>
      )}

      {/* Sort chip — pinned to the right */}
      <Popover.Root
        open={sortOpen}
        onOpenChange={open => {
          setSortOpen(open);
          if (open) sortNav.setActiveIndex(-1);
        }}
      >
        <Popover.Trigger asChild>
          <Button
            variant='outline'
            size='sm'
            className={cn(CHIP_BASE, isSortActive && CHIP_ACTIVE)}
            onKeyDown={openOnArrowDown(sortOpen, setSortOpen)}
          >
            <ArrowUpDown className='size-3' />
            {isSortActive
              ? `Sort: ${SORT_OPTIONS.find(o => o.value === filters.sortBy)?.label}`
              : 'Sort: Relevance'}
            <ChevronDown className={cn('size-3 transition-transform', sortOpen && 'rotate-180')} />
          </Button>
        </Popover.Trigger>
        <Popover.Content
          side='bottom'
          align='end'
          sideOffset={6}
          className={cn(POPOVER_CONTENT, 'min-w-[140px] p-1')}
          onKeyDown={sortNav.handleKeyDown}
        >
          <div ref={sortNav.listRef}>
            {SORT_OPTIONS.map((opt, i) => (
              <button
                key={opt.value}
                data-list-item
                onClick={() => {
                  onFiltersChange({ ...filters, sortBy: opt.value });
                  setSortOpen(false);
                }}
                onMouseEnter={() => sortNav.setActiveIndex(i)}
                className={cn(MENU_ITEM, sortNav.activeIndex === i && 'bg-muted')}
                data-track-category='SEARCH_FILTERS'
                data-track-name={`SET_SORT_${opt.value.toUpperCase()}`}
              >
                <Check
                  className={cn(
                    'size-3.5 shrink-0',
                    filters.sortBy === opt.value ? 'opacity-100' : 'opacity-0',
                  )}
                />
                {opt.label}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}
