import {
  Fragment,
  ReactElement,
  useState,
  useMemo,
  useRef,
  useEffect,
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
import {
  DEFAULT_SEARCH_FILTERS,
  type SearchResultsFilters,
} from '../../../hooks/useSearchResultsScreen';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { ChannelScopeType, type Channel } from '@xyne/shared';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import {
  DATE_RANGE_OPTIONS,
  clearInapplicable,
  countActiveFilters,
  entriesFor,
  type FilterEntry,
  type FilterResolvers,
} from '../../../search/filterRegistry';
import { Dialog } from '../../ui/Dialog';
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import { Calendar } from '../../ui/Calendar';
import { queries } from '../../../zero/queries';
import {
  useCmdkDefaultRankProfiles,
  cmdkTabKeyForDocType,
} from '../../../hooks/useCmdkSearchConfig';

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

const CHIP_BASE =
  'rounded-lg h-6 px-2 text-xs font-medium gap-1.5 border-border hover:bg-muted whitespace-nowrap data-[state=open]:ring-0 data-[state=open]:outline-none';
const CHIP_ACTIVE =
  'border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground';

const POPOVER_CONTENT = 'z-[60] bg-popover border border-border rounded-lg shadow-md';

const MENU_ITEM =
  'flex w-full items-center gap-2 px-3 py-1.5 text-sm rounded text-left focus:outline-none';

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

// Keywords `parseSearchFilters` already understands, so a preset here and a typed
// `range:last 7 days` mean exactly the same thing to the backend.
/**
 * The explicit date modes below the presets. Each is a shape of the same two bounds:
 * On sets them equal, Before/After set one, Range sets both.
 */
const DATE_MODES = [
  { value: '__on__', label: 'On…' },
  { value: '__before__', label: 'Before…' },
  { value: '__after__', label: 'After…' },
  { value: '__range__', label: 'Range…' },
] as const;

type DateMode = (typeof DATE_MODES)[number]['value'];

/** Human-readable summary of explicit bounds, shown under the Date select once set. */
function describeDateBounds(after: string, before: string): string {
  if (after && after === before) return `On ${after}`;
  if (after && before) return `${after} – ${before}`;
  if (after) return `After ${after}`;
  if (before) return `Before ${before}`;
  return '';
}

/** Which mode a filter's existing bounds represent, so reopening lands on the right row. */
function dateModeFor(filters: SearchResultsFilters): DateMode | '' {
  const { after, before } = filters;
  if (after && before) return after === before ? '__on__' : '__range__';
  if (after) return '__after__';
  if (before) return '__before__';
  return '';
}

function toggleIn(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value];
}

/** A row of toggleable pills — used for the small fixed vocabularies (status, priority, dates). */
const FIELD_LABEL = 'block pb-1.5 text-sm font-semibold';
// .fbox — 36px tall, 6px radius, borders brighten on hover. Wraps so tokens can stack.
const FIELD_BOX =
  'flex w-full flex-wrap items-center gap-1.5 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground min-h-9 box-border text-left transition-colors hover:border-muted-foreground focus-within:border-primary';
// .selbox — a select is one line with the chevron pushed right, so it must not wrap.
const SELECT_BOX = 'flex-nowrap justify-between';
const BARE_INPUT =
  'min-w-[120px] flex-1 bg-transparent outline-none placeholder:text-muted-foreground';
// .tok
const TOKEN =
  'inline-flex max-w-full items-center gap-1.5 rounded bg-muted px-1.5 py-0.5 text-[13px] text-foreground';
// .fmenu — anchored under its field rather than a page-level popover.
const FIELD_MENU =
  'absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[212px] overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md';
// .mi
// Checks sit in a 2-col grid (design: `grid-template-columns:repeat(2,1fr); gap:2px 16px`).
// Checkbox labels sit at the same 14px as field values — the size presets are 12px/13px,
// which read as a different scale inside the form.
const CHECK_LABEL = 'text-sm text-foreground';
const CHECK_GRID = 'grid grid-cols-2 gap-x-4 gap-y-0.5 pt-0.5';
const MENU_ROW =
  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted focus:outline-none';
const SUGGESTIONS = 'mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-popover';

/**
 * A select rendered as a field-shaped button plus its own menu, rather than a native
 * `<select>`. The native one had to be `appearance-none` to match the other fields, which
 * stripped its arrow and left nothing saying "this opens" — this keeps the chevron and the
 * checkmarked menu the design specifies.
 */
function SelectField({
  id,
  value,
  options,
  placeholder,
  onPick,
  track,
}: {
  id: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  placeholder: string;
  onPick: (value: string) => void;
  track: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  return (
    <div className='relative'>
      <button
        id={id}
        type='button'
        onClick={() => setOpen(o => !o)}
        onBlur={e => {
          // Closing on blur keeps the menu from outliving the field, but not when focus
          // moved into the menu itself.
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget)) setOpen(false);
        }}
        className={cn(FIELD_BOX, SELECT_BOX)}
        data-track-category='SEARCH_FILTERS'
        data-track-name={`OPEN_${track}`}
      >
        {/* An unset select reads as a placeholder, not as a chosen value. */}
        <span className={cn('truncate', !value && 'text-muted-foreground')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className={FIELD_MENU}>
          {options.map(opt => (
            <button
              key={opt.value || 'any'}
              type='button'
              onClick={() => {
                onPick(opt.value);
                setOpen(false);
              }}
              className={MENU_ROW}
              data-track-category='SEARCH_FILTERS'
              data-track-name={`SET_${track}`}
            >
              <Check
                className={cn(
                  'size-3.5 shrink-0',
                  opt.value === value ? 'opacity-100' : 'opacity-0',
                )}
              />
              <span className='truncate'>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Slack-style token field: chosen values sit inside the box as removable pills, typing
 * filters the suggestion list below it. `options` is already filtered by the caller's
 * query; `labelFor` resolves a selected id whether or not it's in the current results.
 */
function TokenBox({
  selected,
  options,
  labelFor,
  query,
  onQueryChange,
  onChange,
  placeholder,
  track,
  kind,
}: {
  selected: string[];
  options: ReadonlyArray<{ id: string; label: string }>;
  labelFor: (id: string) => string;
  query: string;
  onQueryChange: (q: string) => void;
  onChange: (next: string[]) => void;
  placeholder: string;
  track: string;
  /** Drives the pill's leading glyph — a real avatar for people, a hash for channels. */
  kind?: 'user' | 'channel';
}): ReactElement {
  const unpicked = options.filter(o => !selected.includes(o.id));
  return (
    <div>
      <div className={cn(FIELD_BOX, 'flex flex-wrap items-center gap-1')}>
        {selected.map(id => (
          <span key={id} className={TOKEN}>
            {kind === 'user' && <Avatar userId={id} size='xs' showActiveStatus={false} />}
            {kind === 'channel' && <Hash className='size-3 shrink-0 text-muted-foreground' />}
            <span className='truncate'>{labelFor(id)}</span>
            <button
              type='button'
              onClick={() => onChange(selected.filter(s => s !== id))}
              className='shrink-0 text-muted-foreground hover:text-foreground'
              aria-label={`Remove ${labelFor(id)}`}
              data-track-category='SEARCH_FILTERS'
              data-track-name={`REMOVE_${track}`}
            >
              <X className='size-3' />
            </button>
          </span>
        ))}
        <input
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          placeholder={selected.length > 0 ? '' : placeholder}
          aria-label={track.toLowerCase()}
          className={BARE_INPUT}
          data-track-category='SEARCH_FILTERS'
          data-track-name={`${track}_INPUT`}
        />
      </div>
      {query.trim() !== '' && (
        <div className={SUGGESTIONS}>
          {unpicked.length === 0 ? (
            <p className='px-3 py-2 text-xs text-muted-foreground'>No matches</p>
          ) : (
            unpicked.map(o => (
              <button
                key={o.id}
                type='button'
                onClick={() => {
                  onChange([...selected, o.id]);
                  onQueryChange('');
                }}
                className={cn(MENU_ITEM, 'hover:bg-muted')}
                data-track-category='SEARCH_FILTERS'
                data-track-name={`PICK_${track}`}
              >
                <span className='truncate'>{o.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PeopleTokenField({
  selected,
  onChange,
  placeholder,
  track,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  track: string;
}): ReactElement {
  const [query, setQuery] = useState('');
  const matches = useUserSearch(query, 20) ?? [];
  const allUsers = useUsers();
  const labelFor = (id: string): string => {
    const user = allUsers.find(u => u.id === id);
    // Desk chips carry an address rather than a user id — show it as-is.
    return user ? getUserDisplayName(user) : id;
  };
  return (
    <TokenBox
      selected={selected}
      options={matches.map(u => ({ id: u.id, label: getUserDisplayName(u) }))}
      labelFor={labelFor}
      query={query}
      onQueryChange={setQuery}
      onChange={onChange}
      placeholder={placeholder}
      track={track}
      kind='user'
    />
  );
}

function ChannelTokenField({
  selected,
  onChange,
  placeholder,
  track,
  excludeDMs = false,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  track: string;
  excludeDMs?: boolean;
}): ReactElement {
  const [query, setQuery] = useState('');
  const allChannels = useAllVisibleChannels();
  // Suggestions come from the visible set, but a *selected* channel may sit outside it
  // (a DM, or one the user has since left) — resolve names against every known channel so
  // a carried-over filter never shows a raw id.
  const knownChannels = useAllChannels();
  const allUsers = useUsers();
  const { userID: currentUserId } = useAuthContextValues();
  const nameOf = useCallback(
    (channel: { name: string; scopeType: ChannelScopeType }): string =>
      resolveChannelLabel(channel, currentUserId ?? '', allUsers),
    [allUsers, currentUserId],
  );
  const labelFor = (id: string): string => {
    const channel = knownChannels.find(c => c.id === id) ?? allChannels.find(c => c.id === id);
    return channel ? nameOf(channel) : id;
  };
  const matches = useMemo(() => {
    const q = query.toLowerCase().trim();
    const pool = excludeDMs ? allChannels.filter(c => !isDMChannel(c.scopeType)) : allChannels;
    // Match on the resolved label, so typing a person's name finds their DM.
    const list = q ? pool.filter(c => nameOf(c).toLowerCase().includes(q)) : pool;
    return list.slice(0, 20).map(c => ({ id: c.id, label: nameOf(c) }));
  }, [allChannels, query, excludeDMs, nameOf]);
  return (
    <TokenBox
      selected={selected}
      options={matches}
      labelFor={labelFor}
      query={query}
      onQueryChange={setQuery}
      onChange={onChange}
      placeholder={placeholder}
      track={track}
      kind='channel'
    />
  );
}

function BoardTokenField({
  selected,
  onChange,
  track,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  track: string;
}): ReactElement {
  const [query, setQuery] = useState('');
  const [allBoards] = useCachedQuery(queries.getAllBoardsList());
  const boards = useMemo(
    () => (allBoards ?? []) as ReadonlyArray<{ id: string; name: string }>,
    [allBoards],
  );
  const labelFor = (id: string): string => boards.find(b => b.id === id)?.name ?? id;
  const matches = useMemo(() => {
    const q = query.toLowerCase().trim();
    const list = q ? boards.filter(b => b.name?.toLowerCase().includes(q)) : boards;
    return list.slice(0, 20).map(b => ({ id: b.id, label: b.name }));
  }, [boards, query]);
  return (
    <TokenBox
      selected={selected}
      options={matches}
      labelFor={labelFor}
      query={query}
      onQueryChange={setQuery}
      onChange={onChange}
      placeholder='e.g. Platform'
      track={track}
    />
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const toIso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Parses a typed YYYY-MM-DD as a local date, so the calendar highlights the day typed. */
const fromIso = (value: string): Date | undefined => {
  if (!ISO_DATE.test(value)) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/**
 * The date sheet the Date dropdown opens for On… / Before… / After… / Range…, matching
 * Slack: a typed field, a calendar, and explicit Cancel/Save. Nothing reaches the filter
 * draft until Save, so an abandoned pick leaves the search untouched.
 */
function DateModeDialog({
  mode,
  initial,
  onCancel,
  onSave,
}: {
  mode: DateMode;
  initial: { after: string; before: string };
  onCancel: () => void;
  onSave: (next: { after: string; before: string }) => void;
}): ReactElement {
  const isRange = mode === '__range__';
  // Before… edits the upper bound; the rest start from the lower one.
  const [start, setStart] = useState(mode === '__before__' ? initial.before : initial.after);
  const [end, setEnd] = useState(initial.before);

  const title = DATE_MODES.find(m => m.value === mode)?.label ?? 'Date';
  const startDate = fromIso(start);
  const endDate = fromIso(end);
  const canSave = isRange ? Boolean(startDate && endDate) : Boolean(startDate);

  const commit = (): void => {
    if (!canSave) return;
    if (isRange) onSave({ after: start, before: end });
    else if (mode === '__on__') onSave({ after: start, before: start });
    else if (mode === '__after__') onSave({ after: start, before: '' });
    else onSave({ after: '', before: start });
  };

  const field = (
    label: string,
    value: string,
    setValue: (v: string) => void,
    autoFocus: boolean,
  ): ReactElement => (
    <div className={isRange ? 'flex-1' : ''}>
      {isRange && <span className='block pb-1 text-xs text-muted-foreground'>{label}</span>}
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        placeholder='E.g. 2026-08-25'
        aria-label={isRange ? label : title}
        className={cn(FIELD_BOX, 'focus:border-primary')}
        data-track-category='SEARCH_FILTERS'
        data-track-name='DATE_MODE_INPUT'
      />
    </div>
  );

  return (
    <Dialog
      open
      onOpenChange={next => {
        if (!next) onCancel();
      }}
      title={title}
      className='max-w-[380px]'
      zIndexClassName='z-[70]'
    >
      <div className='flex items-center justify-between px-5 pb-2 pt-4'>
        <h3 className='text-base font-bold'>{title}</h3>
        <button
          type='button'
          onClick={onCancel}
          className='rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground'
          aria-label='Close date picker'
          data-track-category='SEARCH_FILTERS'
          data-track-name='CLOSE_DATE_MODE'
        >
          <X className='size-4' />
        </button>
      </div>

      <div className='px-5'>
        {isRange ? (
          <div className='flex items-start gap-2'>
            {field('Start', start, setStart, true)}
            {field('End', end, setEnd, false)}
          </div>
        ) : (
          field(title, start, setStart, true)
        )}
      </div>

      <div className='px-3 pt-1'>
        {isRange ? (
          <Calendar
            mode='range'
            weekStartsOn={1}
            defaultMonth={startDate ?? new Date()}
            selected={{ from: startDate, to: endDate }}
            onSelect={picked => {
              setStart(picked?.from ? toIso(picked.from) : '');
              setEnd(picked?.to ? toIso(picked.to) : '');
            }}
          />
        ) : (
          <Calendar
            mode='single'
            weekStartsOn={1}
            defaultMonth={startDate ?? new Date()}
            selected={startDate}
            onSelect={picked => setStart(picked ? toIso(picked) : '')}
          />
        )}
      </div>

      <div className='flex items-center justify-end gap-2 px-5 pb-4 pt-2'>
        <Button
          variant='outline'
          size='sm'
          onClick={onCancel}
          data-track-category='SEARCH_FILTERS'
          data-track-name='CANCEL_DATE_MODE'
        >
          Cancel
        </Button>
        <Button
          size='sm'
          onClick={commit}
          disabled={!canSave}
          data-track-category='SEARCH_FILTERS'
          data-track-name='SAVE_DATE_MODE'
        >
          Save
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * "Filter by" — every filter that isn't a standalone bar chip, in one flat modal.
 *
 * Edits are staged in a draft and only applied on Search, so a half-built filter set never
 * fires a query; the X (or Escape) discards them. Sections whose type can't express them
 * are hidden, matching how the query is actually built.
 */
function FiltersModal({
  filters,
  onFiltersChange,
  open,
  onOpenChange,
}: {
  filters: SearchResultsFilters;
  onFiltersChange: (filters: SearchResultsFilters) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const [draft, setDraft] = useState<SearchResultsFilters>(filters);
  // Text controls stay uncommitted while typing, keyed by entry id.
  const [textDrafts, setTextDrafts] = useState<Record<string, string>>({});
  const [dateMode, setDateMode] = useState<DateMode | ''>('');
  const [pendingDateMode, setPendingDateMode] = useState<DateMode | null>(null);

  const draftCount = countActiveFilters(draft);

  const patch = (next: Partial<SearchResultsFilters>): void =>
    setDraft(prev => ({ ...prev, ...next }));

  // Start each open from what's actually applied — a previous cancel must not leak in.
  useEffect(() => {
    if (!open) return;
    setDraft(filters);
    setTextDrafts({});
    setDateMode(dateModeFor(filters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsedList = (raw: string): string[] =>
    raw
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);

  const applyAndClose = (): void => {
    // Commit anything still sitting in a text control rather than dropping it.
    const pendingText = fieldEntries
      .filter(e => e.control?.kind === 'text' && textDrafts[e.id] !== undefined)
      .reduce(
        (acc, e) => ({ ...acc, ...(e.setValue?.(parsedList(textDrafts[e.id] ?? '')) ?? {}) }),
        {},
      );
    onFiltersChange({ ...draft, ...pendingText });
    onOpenChange(false);
  };

  const clearFilters = (): void => {
    setDraft(prev => ({
      ...prev,
      assigneeIds: [],
      withUserIds: [],
      fromUserIds: [],
      fromEmails: [],
      toEmails: [],
      inChannelIds: [],
      mentionUserIds: [],
      mentionChannelIds: [],
      statuses: [],
      priority: '',
      boardIds: [],
      tags: [],
      dateRange: '',
      after: '',
      before: '',
      onlyMyChannels: DEFAULT_SEARCH_FILTERS.onlyMyChannels,
      includeBotMessages: false,
    }));
    setTextDrafts({});
    setDateMode('');
  };

  const allUsers = useUsers();
  const allChannels = useAllVisibleChannels();
  // Only needed for the carried chips, which name users/channels the palette handed over.
  const chipResolvers = useMemo(
    (): FilterResolvers => ({
      userName: id => {
        const user = allUsers.find(u => u.id === id);
        return user ? getUserDisplayName(user) : undefined;
      },
      channelName: id => allChannels.find(c => c.id === id)?.name,
    }),
    [allUsers, allChannels],
  );

  // Counts what's applied, not what's drafted — the badge describes the live search.
  const appliedCount = countActiveFilters(filters);

  // The registry decides what this modal contains; the switch below only knows how to
  // render each *kind* of control, never an individual filter.
  const visible = entriesFor(draft.docType);
  const fieldEntries = visible.filter(e => e.control && e.control.kind !== 'toggle');
  // Rendered in registry order, with consecutive toggles collapsed into one unlabelled
  // grid — the design groups them as a block mid-form, not as trailing fields.
  const blocks = visible
    .filter(e => e.control)
    .reduce<Array<{ toggles: FilterEntry[] } | { field: FilterEntry }>>((acc, entry) => {
      if (entry.control?.kind !== 'toggle') return [...acc, { field: entry }];
      const last = acc[acc.length - 1];
      if (last && 'toggles' in last) {
        last.toggles.push(entry);
        return acc;
      }
      return [...acc, { toggles: [entry] }];
    }, []);
  const carriedTokens = visible
    .filter(e => !e.control && e.isActive(draft))
    .flatMap(e => e.tokens?.(draft, chipResolvers) ?? []);

  const renderControl = (entry: FilterEntry): ReactElement | null => {
    const control = entry.control;
    if (!control) return null;
    const value = entry.getValue?.(draft);
    const write = (next: string[] | string | boolean): void => patch(entry.setValue?.(next) ?? {});
    const list = Array.isArray(value) ? value : [];

    switch (control.kind) {
      case 'people':
        return (
          <PeopleTokenField
            selected={list}
            onChange={write}
            placeholder={control.placeholder}
            track={entry.id.toUpperCase()}
          />
        );
      case 'channels':
        return (
          <ChannelTokenField
            selected={list}
            onChange={write}
            placeholder={control.placeholder}
            track={entry.id.toUpperCase()}
            excludeDMs={control.excludeDMs ?? false}
          />
        );
      case 'boards':
        return <BoardTokenField selected={list} onChange={write} track={entry.id.toUpperCase()} />;
      case 'enumMulti':
        return (
          <div className={CHECK_GRID}>
            {control.options.map(opt => (
              <div key={opt.value} className='py-[2px]'>
                <Checkbox
                  checked={list.includes(opt.value)}
                  onChange={() => write(toggleIn(list, opt.value))}
                  label={opt.label}
                  labelClassName={CHECK_LABEL}
                />
              </div>
            ))}
          </div>
        );
      case 'enumSingle':
        return (
          <SelectField
            id={`filter-${entry.id}`}
            value={typeof value === 'string' ? value : ''}
            options={control.options}
            placeholder={control.anyLabel}
            onPick={write}
            track={entry.id.toUpperCase()}
          />
        );
      case 'text':
        return (
          <input
            id={`filter-${entry.id}`}
            value={textDrafts[entry.id] ?? list.join(', ')}
            onChange={e => setTextDrafts(prev => ({ ...prev, [entry.id]: e.target.value }))}
            onBlur={() => write(parsedList(textDrafts[entry.id] ?? ''))}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                write(parsedList(textDrafts[entry.id] ?? ''));
              }
            }}
            placeholder={control.placeholder}
            className={FIELD_BOX}
            data-track-category='SEARCH_FILTERS'
            data-track-name={`${entry.id.toUpperCase()}_INPUT`}
          />
        );
      case 'date':
        return (
          <>
            <SelectField
              id={`filter-${entry.id}`}
              value={dateMode || draft.dateRange}
              options={[...DATE_RANGE_OPTIONS, ...DATE_MODES]}
              placeholder='Any time'
              onPick={picked => {
                const asMode = DATE_MODES.find(m => m.value === picked)?.value ?? '';
                // A preset and explicit bounds are alternatives, never a combination:
                // picking either clears the other. A mode opens its date sheet, which
                // only writes back on Save.
                if (asMode) setPendingDateMode(asMode);
                else {
                  setDateMode('');
                  patch({ dateRange: picked, after: '', before: '' });
                }
              }}
              track='DATE_RANGE'
            />
            {(draft.after || draft.before) && (
              <button
                type='button'
                onClick={() => setPendingDateMode(dateModeFor(draft) || '__range__')}
                className={cn(FIELD_BOX, 'mt-2')}
                data-track-category='SEARCH_FILTERS'
                data-track-name='EDIT_DATE_MODE'
              >
                {describeDateBounds(draft.after, draft.before)}
              </button>
            )}
            {pendingDateMode && (
              <DateModeDialog
                mode={pendingDateMode}
                initial={{ after: draft.after, before: draft.before }}
                onCancel={() => setPendingDateMode(null)}
                onSave={next => {
                  setDateMode(pendingDateMode);
                  patch({ ...next, dateRange: '' });
                  setPendingDateMode(null);
                }}
              />
            )}
          </>
        );
      default:
        return null;
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Filter by'
      className='flex max-h-[660px] max-w-[460px] flex-col overflow-hidden'
      trigger={
        <Button
          variant='outline'
          size='sm'
          className={cn(CHIP_BASE, appliedCount > 0 && CHIP_ACTIVE)}
          data-track-category='SEARCH_FILTERS'
          data-track-name='OPEN_FILTERS'
        >
          <SlidersHorizontal className='size-3' />
          Filters
          {appliedCount > 0 && (
            <span className='ml-0.5 rounded-full bg-primary-foreground/20 px-1.5 text-[10px] leading-4'>
              {appliedCount}
            </span>
          )}
        </Button>
      }
    >
      <div className='flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5'>
        <h2 className='text-base font-bold'>Filter by</h2>
        <button
          type='button'
          onClick={() => onOpenChange(false)}
          className='rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground'
          aria-label='Close filters'
          data-track-category='SEARCH_FILTERS'
          data-track-name='CLOSE_FILTERS'
        >
          <X className='size-4' />
        </button>
      </div>

      <div className='flex-1 space-y-4 overflow-y-auto px-5 pb-[18px] pt-4'>
        {/* Fields in registry order — this component knows control kinds, not filters. */}
        {blocks.map(block =>
          'toggles' in block ? (
            <div key={block.toggles.map(t => t.id).join('-')} className={CHECK_GRID}>
              {block.toggles.map(entry => (
                <div key={entry.id} className='py-[2px]'>
                  <Checkbox
                    checked={entry.getValue?.(draft) === true}
                    onChange={checked => patch(entry.setValue?.(checked) ?? {})}
                    label={entry.label}
                    labelClassName={CHECK_LABEL}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div key={block.field.id}>
              <label className={FIELD_LABEL} htmlFor={`filter-${block.field.id}`}>
                {block.field.label}
              </label>
              {renderControl(block.field)}
            </div>
          ),
        )}

        {/* Filters the palette can hand over that have no control of their own. Shown only
            when set, and removable, so an active filter is never invisible. */}
        {carriedTokens.length > 0 && (
          <div>
            <span className={FIELD_LABEL}>From your search</span>
            <div className='flex flex-wrap gap-1'>
              {carriedTokens.map(token => (
                <CarriedChip
                  key={token.key}
                  label={token.label}
                  onRemove={() => patch(token.patch)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className='flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3'>
        <div className='flex gap-2'>
          {/* Always rendered so the footer keeps its shape — a button that appears on the
              first filter would shift Search out from under the cursor. */}
          <Button
            variant='outline'
            size='sm'
            onClick={clearFilters}
            disabled={draftCount === 0}
            className='h-8 rounded-lg text-[13px] font-medium'
            data-track-category='SEARCH_FILTERS'
            data-track-name='CLEAR_ALL_FILTERS'
          >
            {draftCount > 0 ? `Clear filters (${draftCount})` : 'Clear filters'}
          </Button>
          <Button
            size='sm'
            onClick={applyAndClose}
            className='h-8 rounded-lg text-[13px] font-medium'
            data-track-category='SEARCH_FILTERS'
            data-track-name='APPLY_FILTERS'
          >
            Search
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function CarriedChip({ label, onRemove }: { label: string; onRemove: () => void }): ReactElement {
  return (
    <span className='inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs'>
      <span className='truncate max-w-[140px]'>{label}</span>
      <button
        onClick={onRemove}
        className='text-muted-foreground hover:text-foreground'
        data-track-category='SEARCH_FILTERS'
        data-track-name='REMOVE_CARRIED_CHIP'
      >
        <X className='size-3' />
      </button>
    </span>
  );
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
