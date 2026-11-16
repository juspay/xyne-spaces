/**
 * The Filters modal's form primitives: a select, a token box, and the pickers built on it
 * (people, channels, boards, mentions). Split out of SearchFilterBar so the bar, the modal
 * and these stay independently readable.
 */
import { ReactElement, useState, useMemo, useCallback } from 'react';
import { Check, ChevronDown, Hash, X } from 'lucide-react';
import Avatar from '../../../ui/Avatar/Avatar';
import { cn } from '../../../../utils/classNames';
import { useUsers, useUsersById } from '../../../../hooks/useUsers';
import { useUserGroups } from '../../../../hooks/useUserGroup';
import { capEachSection, useMentionCandidates } from '../../../../search/useMentionCandidates';
import { TYPEAHEAD_LIST_MAX } from '../../../../search/mentionCandidates';
import { useAllChannels, useAllVisibleChannels } from '../../../../hooks/useChannels';
import { getUserDisplayName } from '../../../../utils/userDisplayName';
import { useAuthContextValues } from '../../../../hooks/useAuth';
import { resolveChannelLabel } from '../../ChatDirectory/ChatDirectory.utils';
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
  syntax = 'from:',
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  track: string;
  /** The filter's prefix (`from:`, `with:`, `assignee:`): the field lists what the palette's does. */
  syntax?: string | undefined;
}): ReactElement {
  const [query, setQuery] = useState('');
  // Worked out once something is typed: the suggestions only show then.
  const { candidates } = useMentionCandidates(query.trim() ? `${syntax}${query}` : '', {
    deskTab: false,
  });
  const allUsers = useUsers();
  const usersById = useUsersById();
  const matches = useMemo(
    () =>
      candidates
        .slice(0, TYPEAHEAD_LIST_MAX)
        .map(candidate => usersById.get(candidate.id))
        .filter((user): user is (typeof allUsers)[number] => Boolean(user)),
    [candidates, usersById],
  );
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
  deskTab = false,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  track: string;
  excludeDMs?: boolean;
  /** On the Desk tab the palette's `in:` lists email channels only; so does this field. */
  deskTab?: boolean;
}): ReactElement {
  const [query, setQuery] = useState('');
  const allChannels = useAllVisibleChannels();
  // Suggestions come from the palette's channel pool (below); these two only resolve labels.
  // A *selected* channel may sit outside the visible set (a DM, or one the user has since left),
  // so names resolve against every known channel too and a carried-over filter never shows a
  // raw id.
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
  // What the palette's `in:` (or channels-only `in:#`) lists for the query, in its order.
  const { candidates } = useMentionCandidates(
    query.trim() ? `${excludeDMs ? 'in:#' : 'in:'}${query}` : '',
    { deskTab },
  );
  const matches = useMemo(
    () =>
      // Only channels: a prefix typed into the field (`from:al`) would list people.
      capEachSection(
        candidates.filter(c => c.kind === 'channel'),
        TYPEAHEAD_LIST_MAX,
      ).map(c => ({ id: c.id, label: c.name })),
    [candidates],
  );
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
  userGroups,
  onChange,
  placeholder,
  track,
}: {
  users: string[];
  channels: string[];
  userGroups: string[];
  onChange: (next: { users: string[]; channels: string[]; userGroups: string[] }) => void;
  placeholder: string;
  track: string;
}): ReactElement {
  const [query, setQuery] = useState('');
  // What the palette's `mentions:` lists for the query: people, user-groups, then channels.
  const { candidates } = useMentionCandidates(query.trim() ? `mentions:${query}` : '', {
    deskTab: false,
  });
  const allUsers = useUsers();
  const allUserGroups = useUserGroups();
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

  const labelFor = (id: string): string => {
    const channel = channelLabel(id);
    if (channel) return channel;
    const group = allUserGroups.find(g => g.id === id);
    if (group) return `@${group.alias ?? group.name}`;
    const user = allUsers.find(u => u.id === id);
    return user ? getUserDisplayName(user) : id;
  };

  // Only what a mention can be: a prefix typed into the field (`on:`) would list other kinds.
  // `mentions:` already lists at most 20 of each.
  const options = candidates
    .filter(c => c.kind === 'person' || c.kind === 'userGroup' || c.kind === 'channel')
    .map(c => ({
      id: c.id,
      label: c.kind === 'channel' ? `#${c.name}` : `@${c.name}`,
    }));

  // Ids only — the two channel hooks return slightly different row shapes. A picked id is
  // classified back to its field: a known channel, then a known group, else a person.
  const channelIds = new Set([...allChannels.map(c => c.id), ...knownChannels.map(c => c.id)]);
  const userGroupIds = new Set(allUserGroups.map(g => g.id));
  return (
    <TokenBox
      selected={[...users, ...channels, ...userGroups]}
      options={options}
      labelFor={labelFor}
      query={query}
      onQueryChange={setQuery}
      onChange={next =>
        onChange({
          channels: next.filter(id => channelIds.has(id)),
          userGroups: next.filter(id => userGroupIds.has(id)),
          users: next.filter(id => !channelIds.has(id) && !userGroupIds.has(id)),
        })
      }
      placeholder={placeholder}
      track={track}
    />
  );
}
