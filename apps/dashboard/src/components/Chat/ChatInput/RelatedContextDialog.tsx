/**
 * The popup a related-context chip opens: the suggestions on the left, the one you
 * pick on the right — its thread, the message in its channel, the ticket, the canvas,
 * or the call's recording and transcript — laid out like the Activity screen, so
 * nothing about where you were typing changes until you choose to go there.
 *
 * The right side reuses the search results screen's panes; a call opens its
 * recording rather than the thread it was shared in.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import { differenceInCalendarDays, format, isToday, isYesterday } from 'date-fns';

import Dialog from '../../ui/Dialog';
import { AskAIAvailabilityContext } from '../../../contexts/AskAIAvailabilityContext';
import { RelatedContextAvailabilityContext } from '../../../contexts/RelatedContextAvailabilityContext';
import { getAllChannels } from '../../../hooks/useChannels';
import { holdAskAIClosed } from '../../../machines/xyneAIMachine';
import type { Channel } from '@xyne/shared';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import UserAvatar, { AvatarSize } from '../../UserAvatar/UserAvatar';
import { SearchResultsSidePanel } from '../SearchResults/SidePanel/SidePanel';
import { resolveResultClick } from '../SearchResults/SidePanel/ResultClickResolver';
import type { SidePanelState } from '../SearchResults/SidePanel/PanelTypes';
import { useRecordingVersion } from '../../../hooks/useRecordingVersion';
import { formatTimeAmPm } from '../../../utils/dateUtils';
import { cn } from '../../../utils/classNames';
import type { RelatedItem, RelatedLabel } from '../../../types/search';
import { KINDS, LABELS, LABEL_ORDER, plain, snippetOf, whereOf } from './relatedContextDisplay';
import { useChannelLabel } from './useRelatedWhere';

/** The DOM id of an item's row, for the list's aria-activedescendant. */
const rowId = (item: RelatedItem): string => `related-row-${item.id.replace(/[^\w-]/g, '-')}`;

/** Same column the Activity list sits in. */
const LIST_WIDTH_PX = 340;

/**
 * The pane for an item. A recorded meeting (a HEADLESS call — the only kind the
 * recordings screen serves) opens its recording, when recordings are on v2, the only
 * recording screen that can be hosted outside its route. Everything else, other
 * calls included, resolves the way a click on the search results screen does.
 */
function panelFor(
  item: RelatedItem,
  canHostRecording: boolean,
  channels: readonly Channel[],
): NonNullable<SidePanelState> | null {
  const { externalId, callType } = item.result.searchContext ?? {};
  if (item.kind === 'call' && canHostRecording && externalId && callType === 'HEADLESS') {
    return { kind: 'recording', externalId, title: plain(item.result.title) };
  }
  // The channel list is how a Desk ticket is told apart, as on the search screen.
  const action = resolveResultClick(item.result, channels);
  return action?.kind === 'panel' ? action.panel : null;
}

/**
 * When the item happened. Messages and tickets carry it as a number; everything else
 * only as text the server formats in UTC without saying so, read here as UTC.
 */
function timeOf(item: RelatedItem): Date | null {
  // 0 is how the index stores "no date".
  const at = item.result.searchContext?.createdAtTimestamp;
  if (at) {
    return new Date(at);
  }
  const text = item.result.metadata.timestamp;
  return text && text !== 'N/A' ? new Date(`${text} UTC`) : null;
}

/** Same wording as the Activity list's timestamps. */
function whenOf(item: RelatedItem): string {
  const date = timeOf(item);
  if (!date || Number.isNaN(date.getTime())) {
    return '';
  }
  if (isToday(date)) {
    return formatTimeAmPm(date);
  }
  if (isYesterday(date)) {
    return 'Yesterday';
  }
  const daysAgo = differenceInCalendarDays(new Date(), date);
  if (daysAgo > 0 && daysAgo < 7) {
    return format(date, 'EEEE');
  }
  return date.getFullYear() === new Date().getFullYear()
    ? format(date, 'MMM d')
    : format(date, 'MMM d, yyyy');
}

/** The row's headline: who said it for a thread, the thing's own title otherwise. */
function titleOf(item: RelatedItem, channelLabel: string): string {
  if (item.kind === 'thread') {
    return plain(item.result.searchContext?.senderName) || channelLabel || 'Thread';
  }
  return whereOf(item);
}

function subtitleOf(item: RelatedItem, channelLabel: string): string {
  const { name } = KINDS[item.kind];
  if (item.kind === 'thread') {
    return channelLabel ? `${name} in ${channelLabel}` : name;
  }
  if (item.kind === 'ticket') {
    const stage = item.result.searchContext?.stageName ?? item.result.searchContext?.ticketStatus;
    return stage ? `${name} · ${stage}` : name;
  }
  return name;
}

/** Sender's avatar for a thread, the kind's icon otherwise; the label as a coloured badge. */
function RowAvatar({ item }: { item: RelatedItem }): ReactElement {
  const Icon = KINDS[item.kind].icon;
  const senderId = item.kind === 'thread' ? item.result.searchContext?.senderId : undefined;
  return (
    <div className='relative flex-shrink-0 pt-px'>
      {senderId ? (
        <UserAvatar userId={senderId} size={AvatarSize.REGULAR} showActiveStatus={false} />
      ) : (
        <div className='flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground'>
          <Icon className='size-4' aria-hidden />
        </div>
      )}
      <span
        aria-hidden
        className='absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-background'
      >
        <span className={cn('size-2 rounded-full', LABELS[item.label].dot)} />
      </span>
    </div>
  );
}

interface RowProps {
  item: RelatedItem;
  selected: boolean;
  onSelect: () => void;
  onJump: (event: MouseEvent) => void;
}

function Row({ item, selected, onSelect, onJump }: RowProps): ReactElement {
  const channelLabel = useChannelLabel(item);
  const title = titleOf(item, channelLabel);
  const snippet = snippetOf(item);
  const when = whenOf(item);
  return (
    <div
      id={rowId(item)}
      role='option'
      tabIndex={-1}
      aria-selected={selected}
      data-selected={selected || undefined}
      onClick={onSelect}
      // Space picks the row; Enter and the arrows bubble to the list, which owns them.
      onKeyDown={event => {
        if (event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'group relative flex w-full cursor-pointer items-start gap-3 rounded-[14px] border border-transparent px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none',
        'hover:bg-sidebar-accent data-[selected]:border-sidebar-border data-[selected]:bg-sidebar-accent',
      )}
      data-track-category='CHAT_INPUT'
      data-track-name='RELATED_CONTEXT_SELECT'
      data-track-label={item.label}
      data-track-metadata={JSON.stringify({ kind: item.kind })}
    >
      <RowAvatar item={item} />
      <div className='flex min-w-0 flex-1 flex-col'>
        <div className='flex w-full items-center gap-2'>
          <span className='min-w-0 flex-1 truncate text-[15px] font-semibold leading-5 text-foreground'>
            {title}
          </span>
          {when && (
            <span className='shrink-0 text-xs tabular-nums text-muted-foreground group-hover:hidden group-data-[selected]:hidden'>
              {when}
            </span>
          )}
          <Tooltip content='Open where it is' side='top' delayDuration={400}>
            <button
              type='button'
              onClick={event => {
                event.stopPropagation();
                onJump(event);
              }}
              className='-my-1 hidden size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-activity-chip-hover hover:text-foreground focus-visible:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:flex group-data-[selected]:flex'
              aria-label={`Open ${title} where it is`}
              data-track-category='CHAT_INPUT'
              data-track-name='RELATED_CONTEXT_JUMP'
              data-track-label={item.label}
            >
              <ArrowUpRight className='size-3.5' aria-hidden />
            </button>
          </Tooltip>
        </div>
        <div className='mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-muted-foreground'>
          <span className={cn('shrink-0 font-medium', LABELS[item.label].tint)}>
            {LABELS[item.label].chip}
          </span>
          <span aria-hidden className='shrink-0 text-muted-foreground/60'>
            ·
          </span>
          <span className='truncate'>{subtitleOf(item, channelLabel)}</span>
        </div>
        {snippet && (
          <p className='mt-1 line-clamp-2 text-[13px] leading-[18px] text-muted-foreground'>
            {snippet}
          </p>
        )}
      </div>
    </div>
  );
}

function NoPreview({
  item,
  onJump,
}: {
  item: RelatedItem;
  onJump: (event: MouseEvent) => void;
}): ReactElement {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 p-8 text-center'>
      <p className='text-sm text-muted-foreground'>This one can’t be shown here.</p>
      <button
        type='button'
        onClick={onJump}
        className='flex items-center gap-1.5 rounded-[6px] bg-activity-chip px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-activity-chip-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        data-track-category='CHAT_INPUT'
        data-track-name='RELATED_CONTEXT_JUMP'
        data-track-label={item.label}
      >
        Open where it is
        <ArrowUpRight className='size-3.5' aria-hidden />
      </button>
    </div>
  );
}

type Filter = 'all' | RelatedLabel;

interface FilterPillProps {
  label: string;
  count: number;
  active: boolean;
  /** Colour mark for a category pill; "All" has none. */
  dot?: string;
  onClick: () => void;
}

/** A category filter over the list, drawn like the Activity screen's tabs. */
function FilterPill({ label, count, active, dot, onClick }: FilterPillProps): ReactElement {
  return (
    <button
      type='button'
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-xs font-medium transition-colors duration-150',
        'hover:bg-foreground/[6%] focus-visible:bg-foreground/[6%] focus-visible:outline-none',
        active ? 'bg-foreground/[6%] text-sidebar-accent-foreground' : 'text-muted-foreground',
      )}
      data-track-category='CHAT_INPUT'
      data-track-name='RELATED_CONTEXT_FILTER'
      data-track-label={label}
    >
      {dot && <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', dot)} />}
      {label}
      <span
        className={cn(
          'shrink-0 rounded-md px-1 text-[0.625rem] font-bold tabular-nums transition-colors',
          active
            ? 'bg-sidebar-primary text-sidebar-primary-foreground'
            : 'bg-foreground/[6%] text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * Clicks that land in something the embedded pane opened — a mention list, an emoji
 * picker, a menu — are outside the dialog's box but part of using it. Only a click
 * on the backdrop itself closes.
 */
function isBackdropClick(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  if (!element) {
    return false;
  }
  return !element.closest(
    '[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-tippy-root], [data-sonner-toaster]',
  );
}

interface RelatedContextDialogProps {
  open: boolean;
  items: RelatedItem[];
  /** The draft the items were found for, quoted in the header. */
  draft: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Leave the popup for the item's own place — the chip's old behaviour. */
  onJump: (item: RelatedItem, event: MouseEvent | KeyboardEvent) => void;
}

export function RelatedContextDialog({
  open,
  items,
  draft,
  selectedId,
  onSelect,
  onClose,
  onJump,
}: RelatedContextDialogProps): ReactElement {
  const reduceMotion = useReducedMotion();
  const { recordingVersion } = useRecordingVersion();

  // Nothing in the embedded screens may open the assistant behind the popup; hiding
  // their buttons covers most, this covers the rest.
  useEffect(() => (open ? holdAskAIClosed() : undefined), [open]);
  const listRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<Filter>('all');

  // Every opening starts from the whole list.
  useEffect(() => {
    if (open) {
      setFilter('all');
    }
  }, [open]);

  const groups = useMemo(
    () =>
      LABEL_ORDER.map(label => ({
        label,
        items: items.filter(item => item.label === label),
      })).filter(group => group.items.length > 0),
    [items],
  );
  const visibleGroups = useMemo(
    () => (filter === 'all' ? groups : groups.filter(group => group.label === filter)),
    [groups, filter],
  );
  const ordered = useMemo(() => visibleGroups.flatMap(group => group.items), [visibleGroups]);
  const selected = ordered.find(item => item.id === selectedId) ?? ordered[0] ?? null;

  // A category that hides the open item moves the selection to its first item, so
  // the right side always shows something from the list on the left.
  const chooseFilter = useCallback(
    (next: Filter): void => {
      setFilter(next);
      const visible =
        next === 'all' ? groups.flatMap(group => group.items) : items.filter(i => i.label === next);
      if (visible[0] && !visible.some(item => item.id === selectedId)) {
        onSelect(visible[0].id);
      }
      listRef.current?.focus();
    },
    [groups, items, selectedId, onSelect],
  );
  // The channel list is read when the selection changes, not subscribed to.
  const panel = useMemo(
    () => (selected ? panelFor(selected, recordingVersion === 'v2', getAllChannels()) : null),
    [selected, recordingVersion],
  );

  // Keep the picked row in view as ↑/↓ walk past the fold.
  useEffect(() => {
    if (!open || !selected) {
      return;
    }
    document.getElementById(rowId(selected))?.scrollIntoView({ block: 'nearest' });
  }, [open, selected]);

  const onListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (!selected) {
        return;
      }
      const index = ordered.indexOf(selected);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = ordered[index + (event.key === 'ArrowDown' ? 1 : -1)];
        if (next) {
          onSelect(next.id);
        }
      } else if (event.key === 'Enter') {
        event.preventDefault();
        onJump(selected, event);
      }
    },
    [ordered, selected, onSelect, onJump],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) {
          onClose();
        }
      }}
      title='Related conversations'
      description='Threads, tickets, canvases and calls related to the message you are writing'
      mobileVariant='dialog'
      focusRef={listRef}
      onInteractOutside={event => {
        if (!isBackdropClick(event.target)) {
          event.preventDefault();
        }
      }}
      testId='related-context-dialog'
      className='flex h-[min(840px,88vh)] w-[min(1240px,94vw)] max-w-none overflow-hidden rounded-2xl border border-border bg-background p-0 shadow-xl'
    >
      <div className='flex h-full min-h-0 w-full'>
        <aside
          className='flex shrink-0 flex-col border-r border-border'
          style={{ width: LIST_WIDTH_PX }}
        >
          <div className='px-4 pb-3 pt-4'>
            <p className='flex items-center gap-2 text-sm font-semibold text-foreground'>
              <Sparkles className='size-4 text-muted-foreground' aria-hidden />
              Related to your message
            </p>
            {draft && (
              <p className='mt-1.5 line-clamp-2 text-[13px] leading-[18px] text-muted-foreground'>
                “{draft}”
              </p>
            )}
          </div>

          <div
            role='toolbar'
            aria-label='Filter by how it relates'
            // One row, scrolling sideways when every category is present — like the
            // Activity screen's tabs.
            className='no-scrollbar flex items-center gap-0.5 overflow-x-auto px-3 pb-3'
          >
            <FilterPill
              label='All'
              count={items.length}
              active={filter === 'all'}
              onClick={() => chooseFilter('all')}
            />
            {groups.map(group => (
              <FilterPill
                key={group.label}
                label={LABELS[group.label].chip}
                count={group.items.length}
                dot={LABELS[group.label].dot}
                active={filter === group.label}
                onClick={() => chooseFilter(group.label)}
              />
            ))}
          </div>

          <div
            ref={listRef}
            role='listbox'
            aria-label='Related conversations'
            aria-activedescendant={selected ? rowId(selected) : undefined}
            tabIndex={0}
            onKeyDown={onListKeyDown}
            className='min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-3 focus-visible:outline-none'
          >
            {visibleGroups.map(group => (
              <div key={group.label} role='group' aria-label={LABELS[group.label].group}>
                {/* One category showing: its pill already names it. */}
                {filter === 'all' && (
                  <p className='flex items-center gap-1.5 px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
                    <span
                      aria-hidden
                      className={cn('size-1.5 rounded-full', LABELS[group.label].dot)}
                    />
                    {LABELS[group.label].group}
                    <span className='tabular-nums text-muted-foreground/70'>
                      {group.items.length}
                    </span>
                  </p>
                )}
                <div className='space-y-0.5'>
                  {group.items.map(item => (
                    <Row
                      key={item.id}
                      item={item}
                      selected={item.id === selected?.id}
                      onSelect={() => onSelect(item.id)}
                      onJump={event => onJump(item, event)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className='flex items-center gap-3 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground'>
            <span>
              <kbd className='font-sans'>↑</kbd> <kbd className='font-sans'>↓</kbd> browse
            </span>
            <span>
              <kbd className='font-sans'>↵</kbd> open where it is
            </span>
            <span>
              <kbd className='font-sans'>esc</kbd> close
            </span>
          </div>
        </aside>

        <section className='flex min-w-0 flex-1 flex-col bg-background'>
          {selected && (
            <motion.div
              key={selected.id}
              className='flex h-full min-h-0 flex-col'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              {panel ? (
                // A second assistant opening from inside the popup would stack a
                // panel behind a modal; the screens shown here leave Ask AI out.
                <AskAIAvailabilityContext.Provider value={false}>
                  <RelatedContextAvailabilityContext.Provider value={false}>
                    <SearchResultsSidePanel panel={panel} onClose={onClose} />
                  </RelatedContextAvailabilityContext.Provider>
                </AskAIAvailabilityContext.Provider>
              ) : (
                <NoPreview item={selected} onJump={event => onJump(selected, event)} />
              )}
            </motion.div>
          )}
        </section>
      </div>
    </Dialog>
  );
}
