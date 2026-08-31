/**
 * The contents of the palette's "Search filters" menu.
 *
 * One row per filter dimension, grouped. Shared by both filter popovers (the top-right
 * icon, and the inline one used when tabs are hidden) so the two can't offer different
 * filters.
 *
 * Every row does the same thing: insert its prefix and hand over to the typeahead, which
 * lists the candidates in the results section — the same place `from:` lists people. The
 * menu is a launcher, never a picker, so there's one place values are chosen.
 *
 * Filters with no candidate list are not offered here at all: `status:`/`stage:` are
 * omitted because a ticket's status is its board's stage, and stage names are defined per
 * board — a workspace-wide list would offer values the searched board doesn't have. Both
 * still work when typed. `tags:` has no global list yet and falls back to its format hint.
 */
import { ReactElement } from 'react';
import { AtSign, CalendarDays, Check, LayoutGrid, SignalHigh, Tag } from 'lucide-react';
import { UserDefault, Hashtag } from '@xyne/icons';
import { cn } from '../../../utils/classNames';

const ROW =
  'flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none';

type MenuRow = {
  id: string;
  label: string;
  group: string;
  icon: ReactElement;
  /** Inserted into the search input; the typeahead takes over from there. */
  prefix: string;
};

const ROWS: MenuRow[] = [
  { id: 'from', label: 'From', group: 'who', prefix: 'from: ', icon: <UserDefault size={13} /> },
  { id: 'to', label: 'To', group: 'who', prefix: 'to: ', icon: <UserDefault size={13} /> },
  { id: 'with', label: 'With', group: 'who', prefix: 'with: ', icon: <UserDefault size={13} /> },
  { id: 'in', label: 'In', group: 'where', prefix: 'in: ', icon: <Hashtag size={13} /> },
  // `mentions:` lists people and channels together. A bare `@`/`#` still quick-switches
  // to a DM or channel, so the filter needs its own prefix to be unambiguous.
  {
    id: 'mentions',
    label: 'Mentions',
    group: 'where',
    prefix: 'mentions: ',
    icon: <AtSign size={13} />,
  },
  // One dimension, one row. Every date option — single days and ranges alike — lives in
  // the typeahead this opens.
  { id: 'date', label: 'Date', group: 'when', prefix: 'on: ', icon: <CalendarDays size={13} /> },
  // Ticket-only filters last: they apply to one result type, so they sit below the
  // filters that work everywhere.
  {
    id: 'assignee',
    label: 'Assignee',
    group: 'ticket',
    prefix: 'assignee: ',
    icon: <UserDefault size={13} />,
  },
  {
    id: 'priority',
    label: 'Priority',
    group: 'ticket',
    prefix: 'priority: ',
    icon: <SignalHigh size={13} />,
  },
  // Boards are workspace data, not a fixed set — typing filters them. Tags have no
  // global list yet, so they stay typed.
  {
    id: 'board',
    label: 'Board',
    group: 'ticket',
    prefix: 'board: ',
    icon: <LayoutGrid size={13} />,
  },
  { id: 'tags', label: 'Tags', group: 'ticket', prefix: 'tags: ', icon: <Tag size={13} /> },
];

export function SearchFiltersMenu({
  onInsert,
  onlyMyChannels,
  onToggleOnlyMyChannels,
  includeBotMessages,
  onToggleIncludeBotMessages,
}: {
  onInsert: (text: string) => void;
  onlyMyChannels: boolean;
  onToggleOnlyMyChannels: () => void;
  includeBotMessages: boolean;
  onToggleIncludeBotMessages: () => void;
}): ReactElement {
  const toggles = [
    {
      label: 'Only my channels',
      on: onlyMyChannels,
      toggle: onToggleOnlyMyChannels,
      track: 'TOGGLE_ONLY_MY_CHANNELS',
    },
    {
      label: 'Include automations',
      on: includeBotMessages,
      toggle: onToggleIncludeBotMessages,
      track: 'TOGGLE_BOT_MESSAGES',
    },
  ];

  return (
    <>
      {ROWS.map((row, index) => (
        <div key={row.id}>
          {index > 0 && ROWS[index - 1]?.group !== row.group && (
            <div className='my-1 border-t border-border' />
          )}
          <button
            type='button'
            onMouseDown={e => e.preventDefault()}
            onClick={() => onInsert(row.prefix)}
            className={ROW}
            data-track-category='SEARCH'
            data-track-name={`INSERT_FILTER_${row.label.toUpperCase()}`}
          >
            <span className='text-muted-foreground'>{row.icon}</span>
            {row.label}
          </button>
        </div>
      ))}

      <div className='my-1 border-t border-border' />

      {/* Checkmark rows, not switches — every other menu in the palette reads this way. */}
      {toggles.map(row => (
        <button
          key={row.track}
          type='button'
          onMouseDown={e => e.preventDefault()}
          onClick={row.toggle}
          className={ROW}
          data-track-category='SEARCH'
          data-track-name={row.track}
        >
          <Check className={cn('size-3.5 shrink-0', row.on ? 'opacity-100' : 'opacity-0')} />
          <span>{row.label}</span>
        </button>
      ))}
    </>
  );
}
