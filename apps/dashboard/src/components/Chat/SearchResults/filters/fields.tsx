/**
 * The Filters modal's form primitives: a select, a token box, and the pickers built on it
 * (people, channels, boards, mentions). Split out of SearchFilterBar so the bar, the modal
 * and these stay independently readable.
 */
import { ReactElement, useState, useMemo, useCallback } from 'react';
import { Check, ChevronDown, Hash, X } from 'lucide-react';
import Avatar from '../../../ui/Avatar/Avatar';
import { cn } from '../../../../utils/classNames';
import { useUserSearch, useUsers } from '../../../../hooks/useUsers';
import { useAllChannels, useAllVisibleChannels } from '../../../../hooks/useChannels';
import { getUserDisplayName } from '../../../../utils/userDisplayName';
import { useAuthContextValues } from '../../../../hooks/useAuth';
import { isDMChannel, resolveChannelLabel } from '../../ChatDirectory/ChatDirectory.utils';
import { ChannelScopeType } from '@xyne/shared';
import { useCachedQuery } from '../../../../hooks/useCachedQuery';
import { queries } from '../../../../zero/queries';
import {
  BARE_INPUT,
  FIELD_BOX,
  FIELD_MENU,
  MENU_ITEM,
  MENU_ROW,
  SELECT_BOX,
  SUGGESTIONS,
  TOKEN,
} from './styles';

/** Toggle a value in/out of a list — the checkbox grids' write helper. */
export function toggleIn(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value];
}

/**
 * A select rendered as a field-shaped button plus its own menu, rather than a native
 * `<select>`. The native one had to be `appearance-none` to match the other fields, which
 * stripped its arrow and left nothing saying "this opens" — this keeps the chevron and the
 * checkmarked menu the design specifies.
 */
export function SelectField({
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
export function TokenBox({
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

export function PeopleTokenField({
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

export function ChannelTokenField({
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

export function BoardTokenField({
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

/**
 * People and channels in one picker, matching the palette's single `mentions:` typeahead.
 * The two lists stay separate in state (different backend fields), so on change each id is
 * classified back by looking it up among the known channels — anything else is a person.
 */
export function MentionTargetsField({
  users,
  channels,
  onChange,
  placeholder,
  track,
}: {
  users: string[];
  channels: string[];
  onChange: (next: { users: string[]; channels: string[] }) => void;
  placeholder: string;
  track: string;
}): ReactElement {
  const [query, setQuery] = useState('');
  const userMatches = useUserSearch(query, 10) ?? [];
  const allUsers = useUsers();
  const allChannels = useAllVisibleChannels();
  const knownChannels = useAllChannels();
  const { userID: currentUserId } = useAuthContextValues();

  const channelLabel = useCallback(
    (id: string): string | undefined => {
      const channel = allChannels.find(c => c.id === id) ?? knownChannels.find(c => c.id === id);
      return channel ? resolveChannelLabel(channel, currentUserId ?? '', allUsers) : undefined;
    },
    [allChannels, knownChannels, currentUserId, allUsers],
  );

  // A DM is never `#`-referenced in a message, so it can't be a channel mention.
  const channelMatches = useMemo(() => {
    const q = query.toLowerCase().trim();
    const pool = allChannels.filter(c => !isDMChannel(c.scopeType));
    return (q ? pool.filter(c => c.name?.toLowerCase().includes(q)) : pool).slice(0, 10);
  }, [allChannels, query]);

  const labelFor = (id: string): string => {
    const channel = channelLabel(id);
    if (channel) return channel;
    const user = allUsers.find(u => u.id === id);
    return user ? getUserDisplayName(user) : id;
  };

  const options = [
    ...userMatches.map(u => ({ id: u.id, label: `@${getUserDisplayName(u)}` })),
    ...channelMatches.map(c => ({ id: c.id, label: `#${c.name}` })),
  ];

  // Ids only — the two channel hooks return slightly different row shapes.
  const channelIds = new Set([...allChannels.map(c => c.id), ...knownChannels.map(c => c.id)]);
  return (
    <TokenBox
      selected={[...users, ...channels]}
      options={options}
      labelFor={labelFor}
      query={query}
      onQueryChange={setQuery}
      onChange={next =>
        onChange({
          users: next.filter(id => !channelIds.has(id)),
          channels: next.filter(id => channelIds.has(id)),
        })
      }
      placeholder={placeholder}
      track={track}
    />
  );
}
