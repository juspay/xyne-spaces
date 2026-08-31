import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactElement } from 'react';
import { Command } from 'cmdk';
import { FileText, Hashtag, MicOn, PhoneDefault, TicketToken } from '@xyne/icons';
import { Hash, Loader2, Lock, Users } from 'lucide-react';
import type { Channel } from '@xyne/shared';
import { ChannelVisibility, isDeskChannelType } from '@xyne/shared';
import Avatar from '../../../ui/Avatar/Avatar';
import { useSearchMetrics } from '../../../../hooks/useSearchMetrics';
import { TabType } from '../../ChatDirectory/ChannelCommandMenu.types';
import { ChannelCommandItem } from '../../ChatDirectory/ChannelCommandMenu';
import SearchResultItem from '../../ChatDirectory/SearchResultItem';
import { ChannelCategory } from '../../ChatDirectory/ChatDirectory.types';
import {
  groupChannelsByScope,
  getDMNames,
  isDMChannel,
  isGroupDMChannel,
  getDMParticipantIdsToFetch,
} from '../../ChatDirectory/ChatDirectory.utils';
import {
  useAllChannels,
  useAllVisibleChannels,
  useUserChannelStatuses,
} from '../../../../hooks/useChannels';
import { useAllUnreadCount } from '../../../../hooks/useUnreadCount';
import { useUsers } from '../../../../hooks/useUsers';
import { useAuthContextValues } from '../../../../hooks/useAuth';
import { useStreamChannels } from '../../../../contexts/StreamContext';
import type { VisibleChannel } from '../../../../machines/stateMachine';
import type { DisplaySearchResult } from '../../../../types/search';

/**
 * The kinds of context Ask AI can attach — same set as ContextPickerPanel's
 * ENABLED_TABS, so this picker surfaces exactly the data the old command-menu
 * modal did, just with new chrome. Labels match ChannelCommandMenu's tab strip
 * and each icon matches the pill that kind renders as once attached.
 *
 * Chrome (sizing, spacing, radius) follows Figma node 907:19167.
 */
const PICKER_TABS: { tab: TabType; label: string; Icon: ComponentType<{ className?: string }> }[] =
  [
    { tab: TabType.CHANNELS, label: 'Channels', Icon: Hashtag },
    { tab: TabType.TICKETS, label: 'Tickets', Icon: TicketToken },
    { tab: TabType.CANVAS, label: 'Canvas', Icon: FileText },
    { tab: TabType.CALL, label: 'Calls', Icon: PhoneDefault },
    { tab: TabType.RECORDING, label: 'Recordings', Icon: MicOn },
  ];

/** Channels is the only tab with data before the user types, so it opens first. */
const DEFAULT_TAB: TabType = TabType.CHANNELS;

/** Same per-category cap as ChannelCommandMenu before "Show more". */
const DISPLAY_LIMIT = 5;

/** Channel sections render in this order — mirrors the command menu. */
const CHANNEL_CATEGORY_ORDER: ChannelCategory[] = [
  ChannelCategory.STARRED,
  ChannelCategory.CHANNELS,
  ChannelCategory.DIRECT_MESSAGES,
  ChannelCategory.GROUP_DMS,
];

const CATEGORY_LABELS: Record<ChannelCategory, string> = {
  [ChannelCategory.STARRED]: 'Starred',
  [ChannelCategory.CHANNELS]: 'Channels',
  [ChannelCategory.DIRECT_MESSAGES]: 'Direct Messages',
  [ChannelCategory.GROUP_DMS]: 'Group DMs',
};

/** Group-heading chrome copied from ChannelCommandMenu's Command.Group usage. */
const GROUP_HEADING_CLASS =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono';

/**
 * Which pill list a picked result lands in, per tab. CALL and RECORDING run the
 * same Vespa query (subApp=transcript) and both come back as type 'attachment',
 * so the ACTIVE TAB — not the result — decides transcript vs recording. Same
 * disambiguation ContextPickerPanel does via its currentTabRef.
 */
export interface ContextPickerSelectedIds {
  channels: Set<string>;
  tickets: Set<string>;
  canvases: Set<string>;
  transcripts: Set<string>;
  recordings: Set<string>;
}

interface ContextPickerProps {
  /** Already-attached context, so rows render the same check badge the menu used. */
  selectedIds: ContextPickerSelectedIds;
  /** Toggle a channel pick into/out of the attached context. */
  onToggleChannel?: (channel: Channel, displayName: string) => void;
  /**
   * Attach several channels in one go.
   *
   * Separate from `onToggleChannel` because the toggle computes the next
   * selection from the selection it was rendered with. Called N times in a loop,
   * all N calls read the same starting state and the last one wins — "attach all
   * 5" attaches one. A bulk call lets the host fold the whole list in once.
   */
  onAttachChannels?: (channels: readonly { channel: Channel; displayName: string }[]) => void;
  /** Toggle a backend-result pick — the active tab disambiguates call vs recording. */
  onToggleResult?: (result: DisplaySearchResult, tab: TabType) => void;
  /**
   * Close the picker. `reason` lets the parent decide focus: a keyboard
   * dismissal should hand focus back to the composer, an outside click
   * shouldn't — focus already went wherever the user clicked.
   */
  onClose?: (reason: 'key' | 'outside') => void;
}

/**
 * Marks the toolbar button that toggles the picker. The outside-click handler
 * skips it — otherwise mousedown would close the picker and the button's own
 * click would immediately toggle it back open.
 */
export const CONTEXT_PICKER_TOGGLE_ATTR = 'data-context-picker-toggle';

/** Raw id convention shared with ContextPickerPanel — attachment id wins when present. */
const rawResultId = (result: DisplaySearchResult): string =>
  result.searchContext?.attachmentId ?? result.id;

const selectedSetForTab = (
  selectedIds: ContextPickerSelectedIds,
  tab: TabType,
): Set<string> | null => {
  switch (tab) {
    case TabType.TICKETS:
      return selectedIds.tickets;
    case TabType.CANVAS:
      return selectedIds.canvases;
    case TabType.CALL:
      return selectedIds.transcripts;
    case TabType.RECORDING:
      return selectedIds.recordings;
    default:
      return null;
  }
};

/**
 * Inline context picker for the Ask AI composer — opened by the toolbar "/"
 * button and rendered inside the context card, below the pill row.
 *
 * Data comes straight from `useSearchMetrics` — the same hook behind
 * GlobalCommandMenu — and every row renders through the command menu's own
 * components (ChannelCommandItem, SearchResultItem), so each result type looks
 * exactly as it did there. Only the shell chrome is new.
 */
export const ContextPicker = ({
  selectedIds,
  onToggleChannel,
  onAttachChannels,
  onToggleResult,
  onClose,
}: ContextPickerProps): ReactElement => {
  const context = useAuthContextValues();
  const currentUserID = context.userID ?? '';
  const channelData = useAllChannels();
  const visibleAllChannels = useAllVisibleChannels();
  const allChannelsUserStatus = useUserChannelStatuses();
  const allUsers = useUsers();
  const unreadCounts = useAllUnreadCount();

  const usersById = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);

  // Local channel corpus for the CHANNELS tab — the same starred/channels/DMs
  // grouping GlobalCommandMenu feeds ChannelCommandMenu, flattened into the
  // { channel, category, searchableNames } shape useSearchMetrics filters.
  const allChannels = useMemo(() => {
    if (!channelData.length) return [];

    const visibleChannels = channelData.map(
      channel => visibleAllChannels.find(vc => vc.id === channel.id) ?? { ...channel },
    ) as VisibleChannel[];
    const grouped = groupChannelsByScope(visibleChannels, allChannelsUserStatus);
    const deskChannels = visibleChannels.filter(c => isDeskChannelType(c.type));

    const sortByActivity = (list: VisibleChannel[]): VisibleChannel[] =>
      [...list].sort(
        (a, b) =>
          new Date(b.channelStats?.lastActivityAt ?? 0).getTime() -
          new Date(a.channelStats?.lastActivityAt ?? 0).getTime(),
      );

    const result: Array<{
      channel: Channel;
      category: ChannelCategory;
      searchableNames?: string[];
      searchNames?: string[];
    }> = [];
    sortByActivity(grouped.starred).forEach(channel => {
      const dmNames = getDMNames(channel, currentUserID, usersById);
      result.push({
        channel,
        category: ChannelCategory.STARRED,
        searchableNames: dmNames.display,
        searchNames: dmNames.search,
      });
    });
    sortByActivity([...grouped.channels, ...deskChannels]).forEach(channel => {
      result.push({
        channel,
        category: ChannelCategory.CHANNELS,
        searchableNames: [channel.name],
      });
    });
    sortByActivity(grouped.directMessages).forEach(channel => {
      const dmNames = getDMNames(channel, currentUserID, usersById);
      result.push({
        channel,
        category: ChannelCategory.DIRECT_MESSAGES,
        searchableNames: dmNames.display,
        searchNames: dmNames.search,
      });
    });
    return result;
  }, [channelData, visibleAllChannels, allChannelsUserStatus, currentUserID, usersById]);

  const {
    searchResults,
    isSearching,
    searchError,
    text,
    setText,
    searchText,
    inputRef,
    activeTab,
    setActiveTab,
    filteredLocalChannels,
    paginationState,
    isLoadingMore,
    loadMoreRef,
    setScrollContainer,
    // Aliased: the component's own `onClose` prop (close the picker UI) is a
    // different thing from the hook's session-close callback.
    onOpen: onSessionOpen,
    onClose: onSessionClose,
    resetSearchState,
  } = useSearchMetrics({
    allChannels,
    // Match the rest of the app: restrict to the user's own channels by default.
    defaultOnlyMyChannels: true,
  });

  // The hook tracks a search session; opening/closing bounds it for telemetry,
  // and the mount also moves activeTab off the hook's TabType.ALL default
  // (which isn't in this strip).
  //
  // Deliberately MOUNT-ONLY, via a ref: onOpen creates a session id that
  // onClose closes over, so onClose's identity flips after every onOpen. With
  // those as deps the effect re-fires itself endlessly — each pass slamming
  // activeTab back to the default, which ate every tab click.
  const sessionRef = useRef({ onSessionOpen, onSessionClose, resetSearchState, setActiveTab });
  sessionRef.current = { onSessionOpen, onSessionClose, resetSearchState, setActiveTab };
  useEffect(() => {
    const session = sessionRef.current;
    session.onSessionOpen('click');
    session.setActiveTab(DEFAULT_TAB);
    return (): void => {
      sessionRef.current.onSessionClose();
      sessionRef.current.resetSearchState();
    };
  }, []);

  // Dismiss on any pointer-down outside the picker — same outcome as Escape.
  // Written inline rather than via useClickOutside because that hook's callback
  // takes no event, so it can't spare the toolbar toggle below.
  const rootRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent): void => {
      const target = event.target as Node | null;
      if (!target || rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(`[${CONTEXT_PICKER_TOGGLE_ATTR}]`)) return;
      onCloseRef.current?.('outside');
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return (): void => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, []);

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Same avatar/lock/hash logic as ChannelCommandMenu's getChannelIcon — that
  // one is a closure inside the menu component, so it can't be imported.
  const getChannelIcon = (channel: Channel): ReactElement => {
    if (isGroupDMChannel(channel.scopeType)) {
      const otherCount = getDMParticipantIdsToFetch(channel, currentUserID).length;
      return (
        <div className='relative flex h-5 w-5 items-center justify-center'>
          <Users size={16} className='text-muted-foreground' />
          {otherCount > 0 && (
            <span className='absolute -bottom-0.5 -right-0.5 min-w-3 rounded-full bg-muted px-0.5 text-xs font-semibold leading-none text-muted-foreground'>
              {otherCount}
            </span>
          )}
        </div>
      );
    }
    if (isDMChannel(channel.scopeType)) {
      const userIds = getDMParticipantIdsToFetch(channel, currentUserID);
      if (userIds.length > 0 && userIds[0]) {
        return <Avatar userId={userIds[0]} size='sm' />;
      }
    }
    if (channel.visibility === ChannelVisibility.PRIVATE) {
      return <Lock size={14} />;
    }
    return <Hash size={14} />;
  };

  /**
   * The channels the surrounding stream is already showing, hoisted to the top of
   * the Channels tab.
   *
   * When Ask AI is a column in a stream, the columns beside it are the single best
   * guess at what a question is about — you assembled them because they are what
   * you are working on. Ranking them above a workspace-wide list by recency is
   * the difference between the picker guessing and the picker knowing.
   *
   * Empty everywhere else, so the group simply does not render.
   */
  const streamChannelIds = useStreamChannels();
  const streamChannels = useMemo(() => {
    if (streamChannelIds.length === 0) return [];
    const inStream = new Set(streamChannelIds);
    // Ordered by the stream, not by the corpus: the arrangement is the ranking.
    return streamChannelIds
      .map(id => filteredLocalChannels.find(item => item.channel.id === id))
      .filter((item): item is (typeof filteredLocalChannels)[number] =>
        item !== undefined ? inStream.has(item.channel.id) : false,
      );
  }, [streamChannelIds, filteredLocalChannels]);

  const unattachedStreamChannels = useMemo(
    () => streamChannels.filter(item => !selectedIds.channels.has(item.channel.id)),
    [streamChannels, selectedIds.channels],
  );

  // CHANNELS tab renders the local corpus grouped by category, like the menu —
  // minus whatever "In this stream" already lifted out.
  //
  // Hoisted means moved, not copied. Leaving the duplicate in was not just a
  // second row to scroll past: cmdk identifies an item by its `value`, and both
  // rows are the same channel with the same display name, so both carry the same
  // value. cmdk then marks BOTH as selected and the arrow keys land on a row you
  // are not looking at.
  const groupedChannels = useMemo(() => {
    const hoisted = new Set(streamChannels.map(item => item.channel.id));
    const groups: Partial<Record<ChannelCategory, typeof filteredLocalChannels>> = {};
    filteredLocalChannels.forEach(item => {
      if (hoisted.has(item.channel.id)) return;
      (groups[item.category] ??= []).push(item);
    });
    return groups;
  }, [filteredLocalChannels, streamChannels]);

  // Tab / Shift+Tab cycles the strip with wrap-around — ChannelCommandMenu's
  // inline-mode behaviour (the old context picker ran the menu inline).
  const cycleTab = (backwards: boolean): void => {
    const idx = PICKER_TABS.findIndex(item => item.tab === activeTab);
    const next = backwards ? idx - 1 : idx + 1;
    const wrapped = ((next % PICKER_TABS.length) + PICKER_TABS.length) % PICKER_TABS.length;
    setActiveTab(PICKER_TABS[wrapped]!.tab);
  };

  const activeTabLabel =
    PICKER_TABS.find(item => item.tab === activeTab)?.label.toLowerCase() ?? 'context';
  const isChannelsTab = activeTab === TabType.CHANNELS;
  const selectedResultIds = selectedSetForTab(selectedIds, activeTab);
  const pagination = paginationState[activeTab];

  return (
    <div ref={rootRef} className='w-full h-[400px] flex flex-col'>
      <div className='flex gap-1.5 items-start px-3 py-2 shrink-0 overflow-x-auto scrollbar-none'>
        {PICKER_TABS.map(item => {
          const isActive = activeTab === item.tab;
          return (
            <button
              key={item.tab}
              type='button'
              onClick={e => {
                // Clicking the active tab is a no-op in inline mode — matches
                // ChannelCommandMenu (only the overlay resets to ALL).
                if (!isActive) setActiveTab(item.tab);
                // Blur the input and centre the tab, like the menu's strip.
                inputRef.current?.blur();
                e.currentTarget.scrollIntoView({
                  behavior: 'smooth',
                  block: 'nearest',
                  inline: 'center',
                });
              }}
              onKeyDown={e => {
                // The menu disables arrow-key hops between tab triggers.
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault();
              }}
              aria-pressed={isActive}
              className={`flex items-center justify-center gap-2 px-2 py-1 rounded-md border-[0.5px] border-border overflow-hidden shrink-0 transition-colors ${
                isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              data-track-category='XyneAI'
              data-track-name='CONTEXT_PICKER_TAB'
              data-track-metadata={JSON.stringify({ tab: item.tab })}
            >
              {/* Rendered as a member expression so the component binding never
                  becomes a PascalCase parameter, which the naming rule rejects. */}
              <item.Icon className='w-3 h-3 shrink-0' />
              <span className="font-['Inter'] text-sm font-[450] whitespace-nowrap truncate">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* shouldFilter off — filtering already happened (Vespa, or the local
          searchableNames match); cmdk only supplies keyboard nav + row chrome. */}
      <Command shouldFilter={false} className='flex-1 min-h-0 flex flex-col'>
        <div className='px-3 pb-1 shrink-0'>
          <input
            ref={inputRef}
            type='text'
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                cycleTab(e.shiftKey);
                return;
              }
              // Escape, or ⌘+Shift+Option+/ again, closes the picker. Matched
              // on e.code — with Shift/Option held, e.key is layout-dependent
              // ('?', '¿', …) but the physical slash key is always 'Slash'.
              // ArrowUp/Down and Enter are left alone — they bubble to the
              // cmdk root, which owns row navigation and fires the highlighted
              // row's onSelect.
              if (
                e.key === 'Escape' ||
                ((e.metaKey || e.ctrlKey) && e.shiftKey && e.altKey && e.code === 'Slash')
              ) {
                e.preventDefault();
                onClose?.('key');
              }
            }}
            // ⌘+/ opens the picker mid-typing — focus lands here so the user
            // just keeps typing to filter.
            autoFocus
            placeholder={`Search ${activeTabLabel}…`}
            className="w-full bg-transparent outline-none border-none text-sm font-['Inter'] text-foreground placeholder:text-muted-foreground px-2 py-1.5"
            data-track-category='XyneAI'
            data-track-name='CONTEXT_PICKER_SEARCH'
          />
        </div>

        <Command.List
          className='flex-1 min-h-0 overflow-y-auto px-2 pb-2'
          ref={el => {
            if (el) setScrollContainer(el);
          }}
        >
          {isChannelsTab ? (
            // ── Local channel corpus, sectioned like the command menu ──
            filteredLocalChannels.length === 0 ? (
              <div className='px-2 py-6 text-sm text-muted-foreground text-center'>
                No channels found
              </div>
            ) : (
              <>
                {streamChannels.length > 0 && (
                  <Command.Group heading='In this stream' className={GROUP_HEADING_CLASS}>
                    {streamChannels.map(({ channel }) => (
                      <ChannelCommandItem
                        key={`stream-${channel.id}`}
                        channel={channel}
                        currentUserID={currentUserID}
                        unreadCount={unreadCounts[channel.id] ?? 0}
                        onSelect={displayName => onToggleChannel?.(channel, displayName)}
                        getChannelIcon={getChannelIcon}
                        isSelected={selectedIds.channels.has(channel.id)}
                      />
                    ))}
                    {/* Attaches only what is not attached yet. Toggling the whole
                        list would *detach* the ones you had already picked, which
                        is the opposite of what a control called "attach all"
                        promises — and the reason this is not simply a loop over
                        the same toggle the rows use. */}
                    {unattachedStreamChannels.length > 1 && onAttachChannels !== undefined && (
                      <button
                        type='button'
                        onClick={() => {
                          onAttachChannels(
                            unattachedStreamChannels.map(({ channel, searchableNames }) => ({
                              channel,
                              displayName: searchableNames?.[0] ?? channel.name ?? '',
                            })),
                          );
                        }}
                        className='w-full px-2 py-1.5 mt-1 text-sm text-muted-foreground rounded-sm text-left transition-colors hover:text-foreground hover:bg-accent'
                        data-track-category='XyneAI'
                        data-track-name='CONTEXT_PICKER_ATTACH_STREAM'
                      >
                        Attach all {unattachedStreamChannels.length} from this stream
                      </button>
                    )}
                  </Command.Group>
                )}
                {CHANNEL_CATEGORY_ORDER.map(category => {
                  const items = groupedChannels[category];
                  if (!items || items.length === 0) return null;

                  const isExpanded = expandedCategories.has(category);
                  const hasMore = items.length > DISPLAY_LIMIT;
                  const displayItems =
                    !isExpanded && hasMore ? items.slice(0, DISPLAY_LIMIT) : items;
                  const hiddenCount = items.length - DISPLAY_LIMIT;

                  return (
                    <Command.Group
                      key={category}
                      heading={CATEGORY_LABELS[category]}
                      className={GROUP_HEADING_CLASS}
                    >
                      {displayItems.map(({ channel }) => (
                        <ChannelCommandItem
                          key={channel.id}
                          channel={channel}
                          currentUserID={currentUserID}
                          unreadCount={unreadCounts[channel.id] ?? 0}
                          onSelect={displayName => onToggleChannel?.(channel, displayName)}
                          getChannelIcon={getChannelIcon}
                          isSelected={selectedIds.channels.has(channel.id)}
                        />
                      ))}
                      {hasMore && (
                        <button
                          type='button'
                          onClick={() =>
                            setExpandedCategories(prev => {
                              const next = new Set(prev);
                              if (next.has(category)) {
                                next.delete(category);
                              } else {
                                next.add(category);
                              }
                              return next;
                            })
                          }
                          className='w-full px-2 py-1.5 mt-1 text-sm text-muted-foreground rounded-sm text-left transition-colors hover:text-foreground hover:bg-accent'
                          data-track-category='XyneAI'
                          data-track-name='CONTEXT_PICKER_SHOW_MORE'
                          data-track-metadata={JSON.stringify({ category })}
                        >
                          {isExpanded ? 'Show less' : `Show ${hiddenCount} more`}
                        </button>
                      )}
                    </Command.Group>
                  );
                })}
              </>
            )
          ) : (
            // ── Vespa-backed tabs: tickets / canvas / calls / recordings ──
            <>
              {searchError && (
                <div className='px-2 py-6 text-sm text-destructive text-center'>{searchError}</div>
              )}
              {!searchError && isSearching && searchResults.length === 0 && (
                <div className='flex items-center justify-center gap-2 px-2 py-6 text-sm text-muted-foreground'>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  <span>Searching…</span>
                </div>
              )}
              {!searchError && !isSearching && searchResults.length === 0 && (
                <div className='px-2 py-6 text-sm text-muted-foreground text-center'>
                  {searchText.trim()
                    ? `No ${activeTabLabel} found`
                    : `Type to search ${activeTabLabel}`}
                </div>
              )}
              {searchResults.map(result => (
                <SearchResultItem
                  key={result.id}
                  result={result}
                  onSelect={picked => onToggleResult?.(picked, activeTab)}
                  isSelected={selectedResultIds?.has(rawResultId(result)) ?? false}
                />
              ))}
              {pagination?.hasMore && searchResults.length > 0 && (
                <div ref={loadMoreRef} className='py-4 flex justify-center'>
                  {isLoadingMore && (
                    <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                      <Loader2 className='h-4 w-4 animate-spin' />
                      <span>Loading more results...</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </Command.List>
      </Command>
    </div>
  );
};
