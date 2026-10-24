import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
} from 'react';
import { AppWindow, Loader2 } from 'lucide-react';
import {
  ChatDefault,
  CheckTickSingle,
  File02Text,
  FolderDefault,
  Hashtag,
  LockClose,
  MicOn,
  ReminderAnticlockwise,
  TicketToken,
  UserTwo,
} from '@xyne/icons';
import { ChannelVisibility, isDeskChannelType, type Channel } from '@xyne/shared';
import { cn } from '../../utils/classNames';
import { useAuthContextValues } from '../../hooks/useAuth';
import {
  useAllChannels,
  useAllVisibleChannels,
  useUserChannelStatuses,
} from '../../hooks/useChannels';
import { useSearchMetrics } from '../../hooks/useSearchMetrics';
import { useUsersById } from '../../hooks/useUsers';
import type { User, VisibleChannel } from '../../machines/stateMachine';
import type { DisplaySearchResult } from '../../types/search';
import Avatar from '../ui/Avatar/Avatar';
import { HoverCard } from '../ui/HoverCard';
import { useOverlayZIndex } from '../../contexts/OverlayZIndexContext';
import ChannelIcon from '../Chat/ChannelIcon/ChannelIcon';
import { ChannelCategory } from '../Chat/ChatDirectory/ChatDirectory.types';
import {
  getDMNames,
  groupChannelsByScope,
  isDMChannel,
  parseDMParticipantIds,
} from '../Chat/ChatDirectory/ChatDirectory.utils';
import { getFileIcon } from '../Chat/MessageAttachment/utils';
import { useArtifactAppOptions } from '../Composer/useArtifactAppOptions';
import {
  MENTION_SECTIONS,
  RECENT_PEOPLE,
  REMOTE_SECTIONS,
  SECTION_LABELS,
  appRow,
  buildAllSections,
  channelRow,
  initialSection,
  messageTime,
  peopleSuggestions,
  personRow,
  plainText,
  resultKind,
  resultRowsFor,
  resultTitle,
  sectionToTab,
  stepSection,
  toMentionPerson,
  uniqueRows,
  type MentionGroup,
  type MentionRow,
  type MentionSection,
} from './MentionMenu.utils';

export { MENTION_SECTIONS };
export type { MentionRow, MentionSection };

// ── Public API ──────────────────────────────────────────────────────────────

/** How a row was picked: Enter / Tab, or a click. The composer keeps its
 *  picker open after a click (several can be picked in a row) and closes it
 *  after Enter, the way a mention usually ends. */
export type MentionPickVia = 'keyboard' | 'pointer';

export interface MentionMenuHandle {
  /** A key the editor forwards (the menu never takes focus). ArrowUp/ArrowDown move the highlight (wrapping),
   *  Enter picks the highlighted row, Tab/Shift+Tab cycle the tabs. Returns true when the key was used. */
  handleKey: (key: string, shiftKey: boolean) => boolean;
}

export interface MentionMenuProps {
  /** Text typed after "@". */
  query: string;
  /** Tab the menu opens on. The composer passes 'people' (@ is for tagging people). Default 'people'. */
  defaultSection?: MentionSection;
  /** Tabs offered, in MENTION_SECTIONS order. Default MENTION_SECTIONS. */
  sections?: readonly MentionSection[];
  /** Rows already attached get a tick. */
  isPicked?: (row: MentionRow) => boolean;
  onSelect: (row: MentionRow, via: MentionPickVia) => void;
}

/** Size and surface the composer gives the menu's box. */
export const MENTION_MENU_CONTAINER =
  'flex h-[min(348px,60vh)] w-[420px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-border/70 bg-popover text-popover-foreground shadow-[0_16px_40px_-16px_rgba(0,0,0,0.25)]';

/**
 * Adds `mask-fade-bottom` while the element has more content below its
 * visible area: a list that continues fades its last row out instead of
 * cutting it. Returns a ref callback for the scrolling element.
 */
export function useScrollFade<T extends HTMLElement>(): {
  ref: (el: T | null) => void;
  fadeBottom: boolean;
} {
  const [el, setEl] = useState<T | null>(null);
  const [fadeBottom, setFadeBottom] = useState(false);

  useEffect(() => {
    if (!el) {
      setFadeBottom(false);
      return undefined;
    }
    const update = (): void => setFadeBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 1);
    // The box can stay the same size while what's inside it grows, so the
    // children are watched too (re-collected as they come and go).
    const resize = new ResizeObserver(update);
    const observe = (): void => {
      resize.disconnect();
      resize.observe(el);
      Array.from(el.children).forEach(child => resize.observe(child));
    };
    const mutations = new MutationObserver(() => {
      observe();
      update();
    });
    observe();
    update();
    mutations.observe(el, { childList: true });
    el.addEventListener('scroll', update, { passive: true });
    return (): void => {
      el.removeEventListener('scroll', update);
      mutations.disconnect();
      resize.disconnect();
    };
  }, [el]);

  return { ref: setEl, fadeBottom };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const TRACK_CATEGORY = 'XyneAI';

const preventFocusLoss = (event: { preventDefault: () => void }): void => event.preventDefault();

/**
 * Keeps a highlight the keyboard moved in view. A row the pointer highlighted
 * is already under it, and scrolling it would drag the list under the mouse.
 */
function useHighlightInView(
  list: HTMLElement | null,
  index: number,
  pointerIndex: MutableRefObject<number>,
): void {
  useEffect(() => {
    if (!list || index < 0) return;
    if (pointerIndex.current === index) {
      pointerIndex.current = -1;
      return;
    }
    list
      .querySelector<HTMLElement>(`[data-mention-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [list, index, pointerIndex]);
}

/**
 * Session bounds for search telemetry while the menu is mounted. Mount-only
 * via a ref: onOpen mints a session id onClose closes over, so as deps they
 * would re-fire forever.
 */
function useSearchSession(handlers: {
  onOpen: (source: 'keyboard_shortcut') => void;
  onClose: () => void;
  resetSearchState: () => void;
}): void {
  const session = useRef(handlers);
  session.current = handlers;
  useEffect(() => {
    session.current.onOpen('keyboard_shortcut');
    return (): void => {
      session.current.onClose();
      session.current.resetSearchState();
    };
  }, []);
}

// ── Data ────────────────────────────────────────────────────────────────────

type CorpusEntry = {
  channel: Channel;
  category: ChannelCategory;
  searchableNames?: string[];
  searchNames?: string[];
};

/**
 * Local channel corpus in the shape useSearchMetrics filters — same as ⌘K's:
 * channels by last activity, then DMs by last activity. `displayNames` is
 * what a row shows (a DM's participants rather than its id list).
 */
function useChannelCorpus(): { corpus: CorpusEntry[]; displayNames: ReadonlyMap<string, string> } {
  const context = useAuthContextValues();
  const currentUserID = context.userID ?? '';
  const channelData = useAllChannels();
  const visibleAllChannels = useAllVisibleChannels();
  const statuses = useUserChannelStatuses();
  const usersById = useUsersById();

  return useMemo(() => {
    const corpus: CorpusEntry[] = [];
    const displayNames = new Map<string, string>();
    if (!channelData.length) return { corpus, displayNames };
    const visible = channelData.map(
      channel => visibleAllChannels.find(vc => vc.id === channel.id) ?? { ...channel },
    ) as VisibleChannel[];
    const grouped = groupChannelsByScope(visible, statuses);
    const desk = visible.filter(c => isDeskChannelType(c.type));
    const byActivity = (list: VisibleChannel[]): VisibleChannel[] =>
      [...list].sort(
        (a, b) =>
          new Date(b.channelStats?.lastActivityAt ?? 0).getTime() -
          new Date(a.channelStats?.lastActivityAt ?? 0).getTime(),
      );
    // Starred is a sidebar group, not a kind: a starred DM is still a DM (its
    // name is the participants' ids), so it joins the DMs below.
    const [starredDms, starredChannels] = partition(grouped.starred, c => isDMChannel(c.scopeType));
    byActivity([...starredChannels, ...grouped.channels, ...desk]).forEach(channel => {
      corpus.push({ channel, category: ChannelCategory.CHANNELS, searchableNames: [channel.name] });
      displayNames.set(channel.id, channel.name);
    });
    byActivity([...starredDms, ...grouped.directMessages]).forEach(channel => {
      const names = getDMNames(channel, currentUserID, usersById);
      corpus.push({
        channel,
        category: ChannelCategory.DIRECT_MESSAGES,
        searchableNames: names.display,
        searchNames: names.search,
      });
      const ids = parseDMParticipantIds(channel);
      const isSelfDm = ids.length === 1 && ids[0] === currentUserID;
      // A self-DM's names read [you, "You"]; the sidebar shows it as "Name (you)".
      displayNames.set(
        channel.id,
        isSelfDm
          ? names.display.length > 1
            ? `${names.display[0]} (you)`
            : 'You'
          : names.display.join(', '),
      );
    });
    return { corpus, displayNames };
  }, [channelData, visibleAllChannels, statuses, currentUserID, usersById]);
}

/** `[matching, rest]`, each in the original order. */
function partition<T>(list: readonly T[], test: (item: T) => boolean): [T[], T[]] {
  const yes: T[] = [];
  const no: T[] = [];
  list.forEach(item => (test(item) ? yes : no).push(item));
  return [yes, no];
}

/** Whoever you DM'd most recently (the corpus lists DMs by last activity), never yourself. */
function useRecentPartners(
  corpus: readonly CorpusEntry[],
  selfId: string,
  enabled: boolean,
): User[] {
  const usersById = useUsersById();
  return useMemo(() => {
    if (!enabled) return [];
    const seen = new Set<string>([selfId]);
    const out: User[] = [];
    for (const { channel, category } of corpus) {
      if (category !== ChannelCategory.DIRECT_MESSAGES) continue;
      for (const id of parseDMParticipantIds(channel)) {
        const user = usersById.get(id);
        if (!user || seen.has(id)) continue;
        seen.add(id);
        out.push(user);
      }
      if (out.length >= RECENT_PEOPLE) break;
    }
    return out.slice(0, RECENT_PEOPLE);
  }, [enabled, corpus, selfId, usersById]);
}

// ── Menu ────────────────────────────────────────────────────────────────────

const SECTION_ICONS: Record<MentionSection, ComponentType<{ size?: number }>> = {
  all: ReminderAnticlockwise,
  people: UserTwo,
  channels: Hashtag,
  messages: ChatDefault,
  files: FolderDefault,
  canvas: File02Text,
  tickets: TicketToken,
  apps: AppWindow,
};

/** How many channels the Channels tab lists. */
const CHANNELS_LIMIT = 50;

/**
 * The AI composer's "@" menu: ⌘K's search, attaching instead of navigating.
 * It opens on `defaultSection`; All mixes the best people and channels with
 * what the index found (messages, files, canvases, tickets), a heading per
 * kind; the other tabs narrow it to one kind. The editor keeps focus
 * throughout — it forwards keys through the handle — and picks happen on
 * click.
 */
export const MentionMenu = forwardRef<MentionMenuHandle, MentionMenuProps>(function MentionMenu(
  { query, defaultSection = 'people', sections = MENTION_SECTIONS, isPicked, onSelect },
  ref,
): ReactElement {
  const selfId = useAuthContextValues().userID ?? '';
  const { corpus, displayNames } = useChannelCorpus();
  const {
    searchResults,
    isSearching,
    isSearchPending,
    setText,
    setActiveTab,
    filteredLocalUsers,
    filteredLocalChannels,
    paginationState,
    isLoadingMore,
    loadMoreRef,
    setScrollContainer,
    onOpen,
    onClose,
    resetSearchState,
  } = useSearchMetrics({
    allChannels: corpus,
    defaultOnlyMyChannels: true,
    groupByDocType: true,
    searchLocalOnlyOnShownTabs: true,
  });

  useSearchSession({ onOpen, onClose, resetSearchState });

  const [section, setSection] = useState<MentionSection>(() =>
    initialSection(defaultSection, sections),
  );
  /** A tab the user picked is never changed under them. */
  const tabChosenRef = useRef(false);
  const chooseSection = useCallback((next: MentionSection): void => {
    tabChosenRef.current = true;
    setSection(next);
  }, []);
  // Before the first paint, so the menu never flashes another tab's results.
  // Apps sit beside the search hook's tabs rather than in them.
  useLayoutEffect(() => {
    const tab = sectionToTab(section);
    if (tab) setActiveTab(tab);
  }, [section, setActiveTab]);

  useEffect(() => {
    setText(query);
  }, [query, setText]);

  const hasQuery = query.trim().length > 0;
  const searching = isSearching || isSearchPending;
  const apps = useArtifactAppOptions(query, section === 'apps');
  const recent = useRecentPartners(corpus, selfId, !hasQuery);
  const people = useMemo(
    () => peopleSuggestions({ recent, hits: filteredLocalUsers, selfId, hasQuery }),
    [recent, filteredLocalUsers, selfId, hasQuery],
  );
  const channels = useMemo(
    () =>
      filteredLocalChannels.map(({ channel }) => ({
        channel,
        displayName: displayNames.get(channel.id) ?? channel.name,
      })),
    [filteredLocalChannels, displayNames],
  );

  const groups = useMemo((): MentionGroup[] => {
    switch (section) {
      case 'all':
        return buildAllSections({
          // Before anything is typed, the people you talk to — not the
          // workspace's first users padding a short DM history.
          people: hasQuery ? people : recent.map(toMentionPerson),
          channels,
          results: searchResults,
          hasQuery,
        });
      case 'people':
        return [{ section, rows: uniqueRows(people.map(personRow)) }];
      case 'channels':
        return [
          {
            section,
            rows: channels
              .slice(0, CHANNELS_LIMIT)
              .map(({ channel, displayName }) => channelRow(channel, displayName)),
          },
        ];
      case 'apps':
        return [{ section, rows: apps.options.map(({ app, subtitle }) => appRow(app, subtitle)) }];
      default:
        // The index has nothing to offer an empty query (no recents for these yet).
        return [{ section, rows: hasQuery ? resultRowsFor(section, searchResults) : [] }];
    }
  }, [section, people, recent, channels, searchResults, hasQuery, apps.options]);
  const rows = useMemo(() => groups.flatMap(group => group.rows), [groups]);

  // "@barclays" names no one: rather than a dead end on People, the search
  // widens to everything (channels, messages, files) once it has settled.
  const noOneMatches =
    section === 'people' && hasQuery && !searching && rows.length === 0 && sections.includes('all');
  useEffect(() => {
    if (noOneMatches && !tabChosenRef.current) setSection('all');
  }, [noOneMatches]);

  // The highlight snaps to the first row whenever the rows change, so Enter
  // after typing takes the best match.
  const resetKey = `${section}|${query}|${rows.length}`;
  const [highlight, setHighlight] = useState(0);
  useEffect(() => {
    setHighlight(0);
  }, [resetKey]);
  const index = rows.length === 0 ? -1 : Math.min(Math.max(highlight, 0), rows.length - 1);

  const fade = useScrollFade<HTMLDivElement>();
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const setFadeRef = fade.ref;
  const listRef = useCallback(
    (el: HTMLDivElement | null): void => {
      setFadeRef(el);
      setList(el);
      // Scroll depth for search telemetry; stable, so this ref callback is too.
      if (el) setScrollContainer(el);
    },
    [setFadeRef, setScrollContainer],
  );
  const pointerIndex = useRef(-1);
  useHighlightInView(list, index, pointerIndex);
  useEffect(() => {
    list?.scrollTo({ top: 0 });
  }, [list, resetKey]);

  useImperativeHandle(
    ref,
    () => ({
      handleKey: (key: string, shiftKey: boolean): boolean => {
        if (key === 'Tab') {
          chooseSection(stepSection(sections, section, shiftKey));
          return true;
        }
        if (key === 'ArrowDown' || key === 'ArrowUp') {
          if (rows.length === 0) return false;
          const step = key === 'ArrowDown' ? 1 : -1;
          setHighlight((Math.max(index, 0) + step + rows.length) % rows.length);
          return true;
        }
        if (key === 'Enter') {
          const row = rows[index];
          if (!row) return false;
          onSelect(row, 'keyboard');
          return true;
        }
        return false;
      },
    }),
    [chooseSection, sections, section, rows, index, onSelect],
  );

  const label = section === 'all' ? 'results' : SECTION_LABELS[section].toLowerCase();
  const empty: ReactNode =
    rows.length > 0 ? null : section === 'apps' && apps.isError ? (
      <EmptyRow>Could not load apps</EmptyRow>
    ) : REMOTE_SECTIONS.has(section) && !hasQuery ? (
      <EmptyRow>Type to search {label}</EmptyRow>
    ) : (section === 'apps' ? apps.isLoading : hasQuery && searching) ? (
      <div className='flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground'>
        <Loader2 className='size-4 animate-spin' aria-hidden />
        Searching…
      </div>
    ) : hasQuery ? (
      <EmptyRow>
        No {label} match “{query}”
        {/* Opening on People shouldn't strand a search for a channel or a message. */}
        {section !== 'all' && section !== 'apps' && sections.includes('all') && (
          <button
            type='button'
            onClick={() => chooseSection('all')}
            className='ml-1.5 font-medium text-foreground underline-offset-2 hover:underline'
            data-track-category={TRACK_CATEGORY}
            data-track-name='MENTION_MENU_SEARCH_ALL'
          >
            Search everything
          </button>
        )}
      </EmptyRow>
    ) : (
      <EmptyRow>
        {section === 'all' ? 'Type to search messages, people, files and more' : `No ${label} yet`}
      </EmptyRow>
    );

  const tab = sectionToTab(section);
  const showLoadMore =
    REMOTE_SECTIONS.has(section) && rows.length > 0 && !!tab && !!paginationState[tab]?.hasMore;

  let rowIndex = 0;
  const renderRow = (row: MentionRow): ReactElement => {
    const i = rowIndex++;
    return (
      <MenuRow
        key={row.id}
        row={row}
        index={i}
        highlighted={i === index}
        picked={isPicked?.(row) ?? false}
        onPick={onSelect}
        onPointerHighlight={() => {
          if (i === index) return;
          pointerIndex.current = i;
          setHighlight(i);
        }}
      />
    );
  };

  return (
    <div
      role='presentation'
      className='flex h-full min-h-0 flex-1 flex-col'
      onMouseDown={preventFocusLoss}
    >
      <div className='flex shrink-0 items-center gap-2 overflow-x-auto scrollbar-none px-3 pt-3'>
        {sections.map(id => {
          const item = { label: SECTION_LABELS[id], Icon: SECTION_ICONS[id] };
          const active = id === section;
          return (
            <button
              key={id}
              type='button'
              onClick={() => chooseSection(id)}
              aria-pressed={active}
              aria-label={item.label}
              title={item.label}
              className={
                active
                  ? 'inline-flex h-8 shrink-0 items-center gap-2 rounded-lg bg-accent px-2 text-sm text-foreground'
                  : 'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground'
              }
              data-track-category={TRACK_CATEGORY}
              data-track-name='MENTION_MENU_TAB'
              data-track-metadata={JSON.stringify({ tab: id })}
            >
              {/* A member expression, so no PascalCase binding trips the naming rule. */}
              <item.Icon size={16} />
              {active && item.label}
            </button>
          );
        })}
      </div>
      <div
        ref={listRef}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto scrollbar-minimal px-2 pb-2 pt-3',
          fade.fadeBottom && 'mask-fade-bottom',
        )}
      >
        {empty}
        {rows.length > 0 && (
          <MenuScrollRootContext.Provider value={list}>
            <div className='flex flex-col gap-1'>
              {section === 'all'
                ? groups.map(group => (
                    <div key={group.section} className='flex flex-col gap-1'>
                      <div className='flex h-9 items-center px-3 text-sm text-muted-foreground'>
                        {SECTION_LABELS[group.section]}
                      </div>
                      {group.rows.map(renderRow)}
                    </div>
                  ))
                : rows.map(renderRow)}
            </div>
          </MenuScrollRootContext.Provider>
        )}
        {showLoadMore && (
          <div ref={loadMoreRef} className='flex justify-center py-3'>
            {isLoadingMore && (
              <Loader2 className='size-4 animate-spin text-muted-foreground' aria-hidden />
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// ── Rows ────────────────────────────────────────────────────────────────────

const ICON_CLASS = 'shrink-0 text-muted-foreground';

/** One 40px row; a message row previews the message on hover. */
function MenuRow({
  row,
  index,
  highlighted,
  picked,
  onPick,
  onPointerHighlight,
}: {
  row: MentionRow;
  index: number;
  highlighted: boolean;
  picked: boolean;
  onPick: (row: MentionRow, via: MentionPickVia) => void;
  onPointerHighlight: () => void;
}): ReactElement {
  const { content, trailing } = rowParts(row);
  const button = (
    <button
      type='button'
      data-mention-index={index}
      onPointerMove={onPointerHighlight}
      onClick={() => onPick(row, 'pointer')}
      // Keyboard scrolling stops short of the faded last 48px.
      className={cn(
        'flex h-10 w-full shrink-0 scroll-mb-12 cursor-pointer items-center gap-3 rounded-[10px] px-3 text-left text-[15px] text-foreground',
        highlighted && 'bg-accent',
      )}
      data-track-category={TRACK_CATEGORY}
      data-track-name='MENTION_MENU_PICK'
      data-track-metadata={JSON.stringify({
        kind: row.type === 'result' ? resultKind(row.result) : row.type,
      })}
    >
      {content}
      {(trailing || picked) && (
        <span className='ml-auto flex shrink-0 items-center gap-2'>
          {trailing}
          {picked && <PickedTick />}
        </span>
      )}
    </button>
  );

  if (row.type !== 'result' || row.result.type !== 'conversation') return button;
  return (
    <RowHoverCard trigger={button}>
      <MessageCard result={row.result} />
    </RowHoverCard>
  );
}

/**
 * The scrolling list a menu's rows sit in, for cards that must close when it
 * scrolls. Provided by the @ menu's list and the composer's "/" and "#" lists.
 */
export const MenuScrollRootContext = createContext<HTMLElement | null>(null);

/**
 * A card beside a menu row while the pointer rests on it (a message's full
 * text, a command's description). It is anchored to its row, so while the
 * list scrolls it would ride along out past the menu: any scroll of the list
 * closes it, and it opens again when the pointer next rests on a row.
 */
export function RowHoverCard({
  trigger,
  children,
}: {
  /** The row; it must take a ref (a host element or a forwardRef component). */
  trigger: ReactElement;
  children: ReactNode;
}): ReactElement {
  const scrollRoot = useContext(MenuScrollRootContext);
  // The card portals to the body, so it takes the z-index of the overlay
  // hosting the menu to stay on top of it.
  const overlayZ = useOverlayZIndex();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !scrollRoot) return undefined;
    const close = (): void => setOpen(false);
    scrollRoot.addEventListener('scroll', close, { passive: true });
    return (): void => scrollRoot.removeEventListener('scroll', close);
  }, [open, scrollRoot]);

  return (
    <HoverCard
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      side='right'
      align='center'
      // Row edge → the list's 8px padding + the menu's 1px border + an 8px gap.
      sideOffset={17}
      openDelay={350}
      closeDelay={80}
      collisionPadding={12}
      showArrow={false}
      className={cn(
        'w-[352px] rounded-2xl border border-border/70 bg-popover p-0 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.25)]',
        overlayZ,
      )}
    >
      {/* The card sits outside the menu, so it needs its own guard for the editor's focus. */}
      <div role='presentation' className='p-4' onMouseDown={preventFocusLoss}>
        {children}
      </div>
    </HoverCard>
  );
}

/** A row's icon and text, and what sits at its right edge. */
function rowParts(row: MentionRow): { content: ReactNode; trailing?: ReactNode } {
  switch (row.type) {
    case 'person':
      return {
        content: (
          <>
            <Avatar userId={row.person.id} size='xs' showActiveStatus={false} />
            <span className='min-w-0 truncate'>{row.person.name}</span>
          </>
        ),
      };
    case 'channel':
      return {
        content: (
          <>
            <span className='flex size-4 shrink-0 items-center justify-center'>
              {isDMChannel(row.channel.scopeType) ? (
                <ChannelIcon
                  channel={row.channel}
                  glyphClassName='text-muted-foreground'
                  avatarSize='xs'
                />
              ) : row.channel.visibility === ChannelVisibility.PRIVATE ? (
                <LockClose size={16} className={ICON_CLASS} />
              ) : (
                <Hashtag size={16} className={ICON_CLASS} />
              )}
            </span>
            <span className='min-w-0 truncate'>{row.displayName}</span>
          </>
        ),
      };
    case 'result':
      return { content: <ResultContent result={row.result} /> };
    case 'app':
      return {
        content: (
          <>
            <AppWindow size={16} className={ICON_CLASS} aria-hidden />
            <span className='min-w-0 truncate'>{row.app.title}</span>
          </>
        ),
        trailing: <span className='text-sm text-muted-foreground'>{row.subtitle}</span>,
      };
  }
}

const senderOf = (result: DisplaySearchResult): string =>
  result.searchContext?.senderName?.trim() || 'Someone';

const senderIdOf = (result: DisplaySearchResult): string | null =>
  result.searchContext?.senderId ?? result.avatar ?? null;

function ResultContent({ result }: { result: DisplaySearchResult }): ReactElement {
  const title = resultTitle(result);
  switch (resultKind(result)) {
    case 'message':
      return (
        <>
          <Avatar userId={senderIdOf(result)} size='xs' showActiveStatus={false} />
          {/* flex-1: the name's 45% is of the whole row, so a short message
              never squeezes the same sender's name shorter. */}
          <span className='flex min-w-0 flex-1 items-center gap-1.5'>
            <span className='max-w-[45%] shrink-0 truncate'>{senderOf(result)}</span>
            <span className='shrink-0 text-muted-foreground' aria-hidden>
              ·
            </span>
            <span className='min-w-0 truncate'>{title}</span>
          </span>
        </>
      );
    case 'file':
      return (
        <>
          <span className='flex size-4 shrink-0 items-center justify-center'>
            {getFileIcon(result.searchContext?.mimeType ?? '', 16)}
          </span>
          <span className='min-w-0 truncate'>{title}</span>
        </>
      );
    case 'call':
      return (
        <>
          <MicOn size={16} className={ICON_CLASS} />
          <span className='min-w-0 truncate'>{title}</span>
        </>
      );
    case 'canvas':
      return (
        <>
          <File02Text size={16} className={ICON_CLASS} />
          <span className='min-w-0 truncate'>{title}</span>
        </>
      );
    case 'ticket': {
      const xyneId = result.searchContext?.xyneId;
      return (
        <>
          <TicketToken size={16} className={ICON_CLASS} />
          {xyneId && xyneId !== title && (
            <span className='shrink-0 text-muted-foreground'>{xyneId}</span>
          )}
          <span className='min-w-0 truncate'>{title}</span>
        </>
      );
    }
    default:
      return <span className='min-w-0 truncate'>{title}</span>;
  }
}

/** The message a row stands for, shown beside the menu while the pointer rests on it. */
function MessageCard({ result }: { result: DisplaySearchResult }): ReactElement {
  const when = messageTime(result.searchContext?.createdAtTimestamp);
  const text = plainText(result.context, true) || plainText(result.title);
  return (
    <>
      <div className='flex items-center gap-2'>
        <Avatar userId={senderIdOf(result)} size='xs' showActiveStatus={false} />
        <span className='min-w-0 truncate text-base text-foreground'>{senderOf(result)}</span>
        {when && (
          <span className='shrink-0 text-sm text-muted-foreground'>
            · {when.date} · {when.time}
          </span>
        )}
      </div>
      <p className='mt-2 line-clamp-6 whitespace-pre-wrap break-words text-sm leading-[1.25] text-foreground'>
        {text}
      </p>
    </>
  );
}

const EmptyRow = ({ children }: { children: ReactNode }): ReactElement => (
  <div className='px-3 py-6 text-center text-sm text-muted-foreground'>{children}</div>
);

const PickedTick = (): ReactElement => (
  <span className='grid size-4 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground'>
    <CheckTickSingle size={10} />
  </span>
);
