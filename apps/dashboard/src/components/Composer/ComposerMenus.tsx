import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Command } from 'cmdk';
import { AppWindow, LayoutGrid, Loader2, X } from 'lucide-react';
import {
  ChatDefault,
  File02Text,
  FolderDefault,
  Hashtag,
  LockClose,
  TicketToken,
  UserTwo,
  CheckTickSingle,
} from '@xyne/icons';
import type { Channel } from '@xyne/shared';
import { ChannelScopeType, isDeskChannelType } from '@xyne/shared';
import {
  COMMAND_SECTION_LABELS,
  COMMAND_SECTION_ORDER,
  type CommandDef,
} from '@xyne/shared/commands';
import { cn } from '../../utils/classNames';
import ChannelIcon from '../Chat/ChannelIcon/ChannelIcon';
import SearchResultItem from '../Chat/ChatDirectory/SearchResultItem';
import { ChannelCommandItem } from '../Chat/ChatDirectory/ChannelCommandMenu';
import { TabType } from '../Chat/ChatDirectory/ChannelCommandMenu.types';
import { ChannelCategory } from '../Chat/ChatDirectory/ChatDirectory.types';
import {
  groupChannelsByScope,
  getDMNames,
  parseDMParticipantIds,
} from '../Chat/ChatDirectory/ChatDirectory.utils';
import { useSearchMetrics } from '../../hooks/useSearchMetrics';
import useMeasure from '../../hooks/useMeasure';
import {
  searchMentionableChannels,
  useAllChannels,
  useAllVisibleChannels,
  useUserChannelStatuses,
} from '../../hooks/useChannels';
import { useAllUnreadCount } from '../../hooks/useUnreadCount';
import { useUsers } from '../../hooks/useUsers';
import { useAuthContextValues } from '../../hooks/useAuth';
import type { VisibleChannel } from '../../machines/stateMachine';
import type { DisplaySearchResult } from '../../types/search';
import type { PickedContext } from './Composer.types';
import { pickFromChannel, pickFromResult, refKey } from './Composer.utils';
import { useArtifactAppOptions } from './useArtifactAppOptions';

/** Lets the editor drive a menu it doesn't own focus for. */
export interface ComposerMenuHandle {
  /** Tab / Shift+Tab — only the @ menu has tabs to cycle. */
  cycleTab?: (backwards: boolean) => void;
}

interface MenuProps {
  query: string;
  pickedRefs: ReadonlySet<string>;
  /** Attaches the item, or takes it off when it is already attached. True
   *  only when it was newly attached. */
  onPick: (item: PickedContext) => boolean;
}

/**
 * The menu shell: one cmdk list whose highlighted row the editor moves with
 * the arrow keys (it forwards them — focus never leaves the text). The row the
 * results open on is always the first, so Enter after typing takes the best
 * match.
 */
function MenuList({
  children,
  header,
  footer,
  resetKey,
  empty,
  className,
}: {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  /** Changes whenever the result set does; the highlight snaps back to the top. */
  resetKey: string;
  empty?: ReactNode;
  className?: string | undefined;
}): ReactElement {
  const listRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    const first = listRef.current?.querySelector<HTMLElement>('[cmdk-item]');
    setValue(first?.getAttribute('data-value') ?? '');
    listRef.current?.scrollTo({ top: 0 });
  }, [resetKey]);

  return (
    <Command
      shouldFilter={false}
      loop
      value={value}
      onValueChange={setValue}
      className='flex min-h-0 flex-col'
    >
      {header}
      <Command.List
        ref={listRef}
        className={cn('max-h-[min(360px,50vh)] min-h-0 overflow-y-auto px-2 pb-2', className)}
      >
        {empty}
        {children}
      </Command.List>
      {footer}
    </Command>
  );
}

const EmptyRow = ({ children }: { children: ReactNode }): ReactElement => (
  <div className='px-3 py-6 text-center text-sm text-muted-foreground'>{children}</div>
);

// ── @ — context picker ──────────────────────────────────────────────────────

/** Artifact apps are not in the search index, so their tab is the picker's
 *  own rather than one of the search hook's tabs. */
const APPS_TAB = 'apps';
type PickerTab = TabType | typeof APPS_TAB;

const PICKER_TABS: Array<{
  tab: PickerTab;
  label: string;
  Icon: ComponentType<{ size?: number }>;
}> = [
  { tab: TabType.ALL, label: 'All', Icon: LayoutGrid },
  { tab: TabType.USERS, label: 'People', Icon: UserTwo },
  { tab: TabType.MESSAGES, label: 'Messages', Icon: ChatDefault },
  { tab: TabType.CHANNELS, label: 'Channels', Icon: Hashtag },
  { tab: TabType.ATTACHMENTS, label: 'Files', Icon: FolderDefault },
  { tab: TabType.CANVAS, label: 'Canvas', Icon: File02Text },
  { tab: TabType.TICKETS, label: 'Tickets', Icon: TicketToken },
  { tab: APPS_TAB, label: 'Artifact apps', Icon: AppWindow },
];

/** The tab "@" opens on: people are what a message is most often about. */
const DEFAULT_TAB = TabType.USERS;

/** How many of each local kind the mixed (All) view leads with. */
const MIXED_PEOPLE = 3;
const MIXED_CHANNELS = 3;
const EMPTY_QUERY_CHANNELS = 8;
/** People you talked to most recently, shown before anything is typed. */
const RECENT_PEOPLE = 8;
const PEOPLE_LIMIT = 25;

/** Local channel corpus in the shape useSearchMetrics filters — same as ⌘K's. */
function useChannelCorpus(): Array<{
  channel: Channel;
  category: ChannelCategory;
  searchableNames?: string[];
  searchNames?: string[];
}> {
  const context = useAuthContextValues();
  const currentUserID = context.userID ?? '';
  const channelData = useAllChannels();
  const visibleAllChannels = useAllVisibleChannels();
  const statuses = useUserChannelStatuses();
  const allUsers = useUsers();
  const usersById = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);

  return useMemo(() => {
    if (!channelData.length) return [];
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
    const out: ReturnType<typeof useChannelCorpus> = [];
    byActivity([...grouped.starred, ...grouped.channels, ...desk]).forEach(channel =>
      out.push({ channel, category: ChannelCategory.CHANNELS, searchableNames: [channel.name] }),
    );
    byActivity(grouped.directMessages).forEach(channel => {
      const names = getDMNames(channel, currentUserID, usersById);
      out.push({
        channel,
        category: ChannelCategory.DIRECT_MESSAGES,
        searchableNames: names.display,
        searchNames: names.search,
      });
    });
    return out;
  }, [channelData, visibleAllChannels, statuses, currentUserID, usersById]);
}

/**
 * "@" — the ⌘K search, attaching instead of navigating. The query is what is
 * typed after the "@" in the composer; it opens on People (your recent DMs
 * first), tabs narrow it to one kind (Tab cycles them), and All mixes the best
 * people, channels and indexed results the way ⌘K's top view does. Rows are
 * ⌘K's own components, so every kind looks exactly as it does there.
 */
export const MentionPicker = forwardRef<
  ComposerMenuHandle,
  MenuProps & {
    /** It stays open across picks and spaces, so it says how to leave. */
    onDismiss: () => void;
  }
>(function MentionPicker({ query, pickedRefs, onPick, onDismiss }, ref): ReactElement {
  const context = useAuthContextValues();
  const currentUserID = context.userID ?? '';
  const allChannels = useChannelCorpus();
  const unreadCounts = useAllUnreadCount();
  const allUsers = useUsers();
  // Mounted per open picker, so this counts what this round of picking added
  // (a row picked again in the same round comes back off the count).
  const [addedKeys, setAddedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const added = addedKeys.size;
  const addPick = (pick: PickedContext): void => {
    const key = refKey(pick);
    const attached = onPick(pick);
    setAddedKeys(prev => {
      const next = new Set(prev);
      if (attached) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const {
    searchResults,
    isSearching,
    setText,
    activeTab,
    setActiveTab,
    filteredLocalChannels,
    paginationState,
    isLoadingMore,
    loadMoreRef,
    setScrollContainer,
    onOpen,
    onClose,
    resetSearchState,
  } = useSearchMetrics({
    allChannels,
    defaultOnlyMyChannels: true,
    groupByDocType: true,
    searchLocalOnlyOnShownTabs: true,
  });

  // Session bounds for search telemetry. Mount-only via a ref: onOpen mints a
  // session id onClose closes over, so as deps they would re-fire forever.
  const session = useRef({ onOpen, onClose, resetSearchState });
  session.current = { onOpen, onClose, resetSearchState };
  useEffect(() => {
    session.current.onOpen('keyboard_shortcut');
    return (): void => {
      session.current.onClose();
      session.current.resetSearchState();
    };
  }, []);

  // Before the first paint, so the menu never flashes the All view first.
  useLayoutEffect(() => {
    setActiveTab(DEFAULT_TAB);
  }, [setActiveTab]);
  /** A tab the user picked is never changed under them. */
  const tabChosenRef = useRef(false);
  // The apps tab sits beside the search hook's `activeTab` rather than in it.
  const [appsOpen, setAppsOpen] = useState(false);
  const currentTab: PickerTab = appsOpen ? APPS_TAB : activeTab;
  const chooseTab = (tab: PickerTab): void => {
    tabChosenRef.current = true;
    if (tab === APPS_TAB) {
      setAppsOpen(true);
      return;
    }
    setAppsOpen(false);
    setActiveTab(tab);
  };
  const apps = useArtifactAppOptions(query, appsOpen);

  useEffect(() => {
    setText(query);
  }, [query, setText]);

  useImperativeHandle(
    ref,
    () => ({
      cycleTab: (backwards: boolean): void => {
        const order = PICKER_TABS.map(t => t.tab);
        const index = order.indexOf(appsOpen ? APPS_TAB : activeTab);
        const next = order[(index + (backwards ? -1 : 1) + order.length) % order.length]!;
        tabChosenRef.current = true;
        setAppsOpen(next === APPS_TAB);
        if (next !== APPS_TAB) setActiveTab(next);
      },
    }),
    [activeTab, appsOpen, setActiveTab],
  );

  const tabsRef = useRef<HTMLDivElement>(null);
  const { width: tabsWidth } = useMeasure({ ref: tabsRef, observeResize: true });
  const compactTabs = tabsWidth > 0 && tabsWidth < 520;

  const getChannelIcon = (channel: Channel): ReactElement => (
    <ChannelIcon channel={channel} glyphClassName='text-muted-foreground' avatarSize='sm' />
  );

  const isAll = activeTab === TabType.ALL;
  const isChannelsTab = activeTab === TabType.CHANNELS;
  const hasQuery = query.trim().length > 0;

  const pickable = useMemo(
    () =>
      searchResults
        .map(result => ({ result, pick: pickFromResult(result) }))
        .filter((row): row is { result: DisplaySearchResult; pick: PickedContext } => !!row.pick),
    [searchResults],
  );

  // With nothing typed, People leads with whoever you DM'd most recently
  // (the corpus lists DMs by last activity), then everyone else.
  const showRecentPeople = activeTab === TabType.USERS && !hasQuery;
  const recentPeople = useMemo(() => {
    if (!showRecentPeople) return [];
    const usersById = new Map(allUsers.map(u => [u.id, u]));
    const ids: string[] = [];
    for (const { channel, category } of allChannels) {
      if (category !== ChannelCategory.DIRECT_MESSAGES) continue;
      // You are not a suggestion to yourself (a self-DM lists only you).
      for (const id of parseDMParticipantIds(channel)) {
        if (id !== currentUserID && !ids.includes(id) && usersById.has(id)) ids.push(id);
      }
      if (ids.length >= RECENT_PEOPLE) break;
    }
    return ids.slice(0, RECENT_PEOPLE).flatMap(id => {
      const user = usersById.get(id);
      if (!user) return [];
      const result: DisplaySearchResult = {
        id: user.id,
        type: 'user',
        title: user.displayName || user.name,
        subtitle: user.email || '',
        relevanceScore: 1,
        metadata: {},
      };
      const pick = pickFromResult(result);
      return pick ? [{ result, pick }] : [];
    });
  }, [showRecentPeople, allChannels, allUsers, currentUserID]);

  const people = isAll ? pickable.filter(r => r.result.type === 'user').slice(0, MIXED_PEOPLE) : [];
  const indexed = isChannelsTab
    ? []
    : isAll
      ? pickable.filter(r => r.result.type !== 'user' && r.result.type !== 'channel')
      : showRecentPeople
        ? [
            ...recentPeople,
            ...pickable.filter(
              r =>
                r.result.id !== currentUserID &&
                !recentPeople.some(p => p.result.id === r.result.id),
            ),
          ].slice(0, PEOPLE_LIMIT)
        : pickable;
  const channels = isChannelsTab
    ? filteredLocalChannels.slice(0, 50)
    : isAll
      ? filteredLocalChannels.slice(0, hasQuery ? MIXED_CHANNELS : EMPTY_QUERY_CHANNELS)
      : [];

  // Like ⌘K's top view: messages lead, then people and channels, then the
  // rest of what the index found (files, canvases, tickets).
  // "@barclays" names no one: rather than a dead end on People, the search
  // widens to everything (channels, messages, files) once it has settled.
  const noOneMatches =
    !appsOpen && activeTab === TabType.USERS && hasQuery && !isSearching && indexed.length === 0;
  useEffect(() => {
    if (noOneMatches && !tabChosenRef.current) setActiveTab(TabType.ALL);
  }, [noOneMatches, setActiveTab]);

  const messages = isAll ? indexed.filter(r => r.result.type === 'conversation') : [];
  const rest = isAll ? indexed.filter(r => r.result.type !== 'conversation') : indexed;
  const total = appsOpen ? apps.options.length : people.length + channels.length + indexed.length;
  const resetKey = appsOpen
    ? `${APPS_TAB}|${query}|${apps.options.length}`
    : `${activeTab}|${query}|${people.length}|${channels.length}|${indexed.length}`;
  const label =
    isAll && !appsOpen
      ? undefined
      : PICKER_TABS.find(t => t.tab === currentTab)?.label.toLowerCase();

  const renderResult = ({
    result,
    pick,
  }: {
    result: DisplaySearchResult;
    pick: PickedContext;
  }): ReactElement => (
    <SearchResultItem
      key={`${result.type}-${result.id}`}
      result={result}
      onSelect={() => addPick(pick)}
      isSelected={pickedRefs.has(refKey(pick))}
    />
  );

  const header = (
    <div className='flex shrink-0 items-center gap-1 pb-1 pl-3 pr-2 pt-2.5'>
      <div
        ref={tabsRef}
        className='flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none'
      >
        {PICKER_TABS.map(item => {
          const { tab, label: tabLabel } = item;
          const active = currentTab === tab;
          return (
            <button
              key={tab}
              type='button'
              onClick={() => chooseTab(tab)}
              aria-pressed={active}
              aria-label={tabLabel}
              title={tabLabel}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] transition-colors',
                active
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
              )}
              data-track-category='XyneAI'
              data-track-name='COMPOSER_MENTION_TAB'
              data-track-metadata={JSON.stringify({ tab })}
            >
              {/* A member expression, so no PascalCase binding trips the naming rule. */}
              <item.Icon size={14} />
              {/* A narrow panel (the sidebar) keeps every tab in reach by
                showing icons, with the label only on the open tab. */}
              {(!compactTabs || active) && tabLabel}
            </button>
          );
        })}
      </div>
      <button
        type='button'
        onClick={onDismiss}
        aria-label='Close'
        title='Close (Esc)'
        className='flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground'
        data-track-category='XyneAI'
        data-track-name='COMPOSER_MENTION_CLOSE'
      >
        <X className='size-3.5' aria-hidden strokeWidth={2} />
      </button>
    </div>
  );

  const empty =
    total > 0 ? null : appsOpen && apps.isError ? (
      <EmptyRow>Could not load apps</EmptyRow>
    ) : (appsOpen ? apps.isLoading : isSearching) ? (
      <div className='flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' aria-hidden />
        Searching…
      </div>
    ) : (
      <EmptyRow>
        {hasQuery ? (
          <>
            No {label ?? 'results'} match “{query}”
            {/* Opening on People shouldn't strand a search for a channel or a message. */}
            {!isAll && !appsOpen && (
              <button
                type='button'
                onClick={() => chooseTab(TabType.ALL)}
                className='ml-1.5 font-medium text-foreground underline-offset-2 hover:underline'
                data-track-category='XyneAI'
                data-track-name='COMPOSER_MENTION_SEARCH_ALL'
              >
                Search everything
              </button>
            )}
          </>
        ) : appsOpen ? (
          'No apps yet'
        ) : (
          `Type to search ${label ?? 'messages, people, files and more'}`
        )}
      </EmptyRow>
    );

  // It stays open for more picks, so it keeps count and says how to finish.
  const footer = (
    <div className='flex shrink-0 items-center justify-between gap-2 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground'>
      {added > 0 ? (
        <span
          key={added}
          className='flex items-center gap-1.5 text-foreground duration-200 animate-in fade-in-0 zoom-in-95'
          aria-live='polite'
        >
          <PickedTick />
          {added} added to context
        </span>
      ) : (
        <span>Pick as many as you need</span>
      )}
      <span className='shrink-0'>
        <kbd className='rounded border border-border/80 bg-muted px-1 font-sans text-[11px]'>
          Esc
        </kbd>{' '}
        to finish
      </span>
    </div>
  );

  return (
    <div
      ref={el => {
        const list = el?.querySelector<HTMLElement>('[cmdk-list]');
        if (list) setScrollContainer(list);
      }}
    >
      <MenuList header={header} footer={footer} resetKey={resetKey} empty={empty}>
        {appsOpen &&
          apps.options.map(({ app, subtitle }) => {
            const pick: PickedContext = {
              kind: 'app',
              id: app.id,
              label: app.title,
              mention: app.title,
            };
            return (
              <Command.Item
                key={app.id}
                value={`app-${app.id}`}
                onSelect={() => addPick(pick)}
                className={MENU_ROW_CLASS}
                data-track-category='XyneAI'
                data-track-name='COMPOSER_APP_PICK'
              >
                <span className='grid size-5 shrink-0 place-items-center text-muted-foreground'>
                  <AppWindow size={14} aria-hidden />
                </span>
                <span className='min-w-0 flex-1 truncate'>{app.title}</span>
                <span className='shrink-0 truncate text-xs text-muted-foreground'>{subtitle}</span>
                {pickedRefs.has(refKey(pick)) && <PickedTick />}
              </Command.Item>
            );
          })}
        {!appsOpen && messages.map(renderResult)}
        {!appsOpen && people.map(renderResult)}
        {!appsOpen &&
          channels.map(({ channel }) => (
            <ChannelCommandItem
              key={channel.id}
              channel={channel}
              currentUserID={currentUserID}
              unreadCount={unreadCounts[channel.id] ?? 0}
              onSelect={displayName => addPick(pickFromChannel(channel, displayName))}
              getChannelIcon={getChannelIcon}
              isSelected={pickedRefs.has(refKey({ kind: 'channel', id: channel.id }))}
            />
          ))}
        {!appsOpen && rest.map(renderResult)}
        {!appsOpen &&
          !isAll &&
          !showRecentPeople &&
          paginationState[activeTab]?.hasMore &&
          indexed.length > 0 && (
            <div ref={loadMoreRef} className='flex justify-center py-3'>
              {isLoadingMore && (
                <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' aria-hidden />
              )}
            </div>
          )}
      </MenuList>
    </div>
  );
});

// ── # — channels ────────────────────────────────────────────────────────────

/** "#" — the channels you can mention, filtered as you type. */
export function ChannelMenu({ query, pickedRefs, onPick }: MenuProps): ReactElement {
  const allChannels = useAllVisibleChannels();
  const items = useMemo(
    () =>
      searchMentionableChannels(
        allChannels.filter(
          ch => ch.scopeType !== ChannelScopeType.DM && ch.scopeType !== ChannelScopeType.GROUP_DM,
        ),
        query,
        12,
      ),
    [allChannels, query],
  );
  return (
    <MenuList
      header={<MenuHeading>Channels</MenuHeading>}
      resetKey={`${query}|${items.length}`}
      empty={items.length === 0 ? <EmptyRow>No channels match “{query}”</EmptyRow> : null}
    >
      {items.map(channel => {
        const pick = pickFromChannel(channel, channel.name);
        const isPrivate = pick.kind === 'channel' && pick.isPrivate;
        return (
          <Command.Item
            key={channel.id}
            value={`channel-${channel.id}`}
            onSelect={() => onPick(pick)}
            className={MENU_ROW_CLASS}
            data-track-category='XyneAI'
            data-track-name='COMPOSER_CHANNEL_PICK'
          >
            <span className='grid size-5 shrink-0 place-items-center text-muted-foreground'>
              {isPrivate ? <LockClose size={14} /> : <Hashtag size={14} />}
            </span>
            <span className='min-w-0 flex-1 truncate'>{channel.name}</span>
            {pickedRefs.has(refKey(pick)) && <PickedTick />}
          </Command.Item>
        );
      })}
    </MenuList>
  );
}

// ── / — commands ────────────────────────────────────────────────────────────

/** "/" — the commands claw agents run, filtered as you type. */
export function CommandList({
  query,
  commands,
  onSelect,
}: {
  query: string;
  commands: readonly CommandDef[];
  onSelect: (command: CommandDef) => void;
}): ReactElement {
  const q = query.toLowerCase();
  const filtered = commands.filter(
    c =>
      !q ||
      c.name.includes(q) ||
      (c.aliases ?? []).some(a => a.includes(q)) ||
      c.label.toLowerCase().includes(q),
  );
  // A name that starts with the query beats one that merely contains it.
  const ranked = [...filtered].sort(
    (a, b) => Number(!a.name.startsWith(q)) - Number(!b.name.startsWith(q)),
  );
  const sections = q
    ? [{ section: null, items: ranked }]
    : COMMAND_SECTION_ORDER.map(section => ({
        section,
        items: ranked.filter(c => c.section === section),
      })).filter(group => group.items.length > 0);

  return (
    <MenuList
      header={q ? <MenuHeading>Commands</MenuHeading> : undefined}
      resetKey={`${query}|${ranked.length}`}
      empty={ranked.length === 0 ? <EmptyRow>No commands match “/{query}”</EmptyRow> : null}
      className={q ? undefined : 'pt-1'}
    >
      {sections.map(({ section, items }) => (
        <Command.Group
          key={section ?? 'matches'}
          {...(section ? { heading: COMMAND_SECTION_LABELS[section] } : {})}
          className='[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[13px] [&_[cmdk-group-heading]]:text-muted-foreground'
        >
          {items.map(command => (
            <Command.Item
              key={command.name}
              value={`command-${command.name}`}
              onSelect={() => onSelect(command)}
              className={MENU_ROW_CLASS}
              data-track-category='XyneAI'
              data-track-name='COMPOSER_COMMAND_PICK'
              data-track-metadata={JSON.stringify({ command: command.name })}
            >
              <span className='shrink-0 text-foreground'>/{command.name}</span>
              {command.argsHint && (
                <span className='shrink-0 text-muted-foreground/60'>{command.argsHint}</span>
              )}
              <span className='min-w-0 truncate text-muted-foreground'>{command.help}</span>
            </Command.Item>
          ))}
        </Command.Group>
      ))}
    </MenuList>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

const MENU_ROW_CLASS =
  'flex h-9 cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 text-sm text-foreground aria-selected:bg-accent';

const MenuHeading = ({ children }: { children: ReactNode }): ReactElement => (
  <div className='px-4 pb-1 pt-2.5 text-xs font-medium text-muted-foreground'>{children}</div>
);

const PickedTick = (): ReactElement => (
  <span className='grid size-4 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground'>
    <CheckTickSingle size={10} />
  </span>
);
