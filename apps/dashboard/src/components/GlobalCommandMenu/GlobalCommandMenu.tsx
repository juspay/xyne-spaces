import { ReactElement, useState, useMemo, useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isDeskChannelType, ChannelType } from '@xyne/shared';
import { useAuthContextValues } from '../../hooks/useAuth';
import {
  useAllChannels,
  useAllVisibleChannels,
  useUserChannelStatuses,
} from '../../hooks/useChannels';
import {
  groupChannelsByScope,
  resolveChannelLabel,
} from '../Chat/ChatDirectory/ChatDirectory.utils';
import { useAllUnreadCount } from '../../hooks/useUnreadCount';
import { rankChannelsByAffinity } from '../../utils/rankingUtils';
import { useAffinityCallback } from '../../hooks/useAffinityCallback';
import ChannelCommandMenu from '../Chat/ChatDirectory/ChannelCommandMenu';
import {
  COLLAPSE_TO_CMDK_EVENT,
  noteLocation,
  whenCollapseSettled,
  owedFullPageAnnouncement,
  recordDefaultFullPageOpen,
  resultsParamsForQuery,
  focusFullPageSearch,
  resumeSearchOnOpen,
  saveFullPageOrigin,
  SELECTED_RESULT_PARAM,
  isFullPageSearchPath,
  type CollapseToCmdkDetail,
} from '../Chat/ChatDirectory/cmdkFullPage';
import { loadCmdkPolicy, openCmdk, saveCmdkPolicy } from '../../search/cmdkPolicy';
import { useCmdkPolicyOptions } from '../../hooks/useCmdkSearchConfig';
import type { ContextItem } from '../Chat/ThreadContextPanel/ThreadContextPanel.types';
import {
  DOC_TYPE_TO_TAB,
  TabType,
  type ChipData,
  type SearchScopeToggles,
  type PaletteRestore,
} from '../Chat/ChatDirectory/ChannelCommandMenu.types';
import { VisibleChannel } from '../../machines/stateMachine';
import { useShortcutById } from '../../shortcuts';
import type { InitialQueryData } from '../Chat/ChatDirectory/LexicalSearchInput';
import { useUsers } from '../../hooks/useUsers';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { DEFAULT_SEARCH_FILTERS, readLastSearchState } from '../../hooks/useSearchResultsScreen';
import { buildChips, buildQueryText, readFiltersFromParams } from '../../search/filterRegistry';
import {
  OPEN_TICKET_SEARCH_EVENT,
  getCurrentTicketView,
  type TicketSearchView,
} from '../../search/ticketSearchScope';

interface GlobalCommandMenuProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  contextSelectionMode?: boolean;
  contextItems?: ContextItem[];
  selectionVariant?: 'filled' | 'outline';
  compactTabs?: boolean;
  onContextItemToggle?: (item: ContextItem) => void;
  onContextSelectionConfirm?: () => void;
  enabledTabs?: TabType[];
  inline?: boolean;
  onTabChange?: (tab: TabType) => void;
  disableAutoFocus?: boolean;
  initialMention?: ChipData | null;
  initialTab?: TabType;
  hideTabs?: boolean;
  restoreQueryFromUrl?: boolean;
  // Opened by the `mod+/` shortcut in screen mode: seed the box with `/` so it lands in command mode.
  seedCommand?: boolean;
  // Show the inline AI overview above the results. Only the cmd+K search overlay sets it;
  // the pickers built on this menu leave it off.
  aiOverview?: boolean;
  // Listen for the ticket screen's search bar and open as a search of that screen's tickets:
  // Tickets tab only, seeded with its filters. Only the app-level cmd+K instance sets it;
  // pickers built on this menu leave it off. Cmd+K itself always opens the global search.
  ticketScreenScope?: boolean;
  // The app-level cmd+K search: reopens with the last query on a quick return (offering the
  // full-page banner), and when the results page collapses full page back into the palette.
  // Only the app-level cmd+K instance sets it.
  fullPageSearch?: boolean;
}

// The longest a collapse waits for the palette to land before returning to the page anyway.
const COLLAPSE_SETTLE_TIMEOUT_MS = 1200;

const GlobalCommandMenu = ({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  contextSelectionMode,
  contextItems,
  selectionVariant,
  compactTabs,
  onContextItemToggle,
  onContextSelectionConfirm,
  enabledTabs,
  inline,
  onTabChange,
  disableAutoFocus,
  initialMention: externalInitialMention,
  initialTab: externalInitialTab,
  hideTabs,
  restoreQueryFromUrl,
  seedCommand,
  aiOverview,
  ticketScreenScope,
  fullPageSearch,
}: GlobalCommandMenuProps = {}): ReactElement | null => {
  const context = useAuthContextValues();
  const channelData = useAllChannels();
  const visibleAllChannels = useAllVisibleChannels();
  const allChannelsUserStatus = useUserChannelStatuses();
  // Re-render once when affinity weights finish loading so the ranking memo below re-reads them
  // (they load async after mount and are otherwise invisible until an unrelated dep changes).
  const affinityVersion = useAffinityCallback();
  const [internalOpen, setInternalOpen] = useState(false);
  const [internalInitialMention, setInternalInitialMention] = useState<ChipData | null>(null);
  const [internalContextualTab, setInternalContextualTab] = useState<TabType | undefined>(
    undefined,
  );
  const [internalHideTabs, setInternalHideTabs] = useState(false);
  const [internalEnabledTabs, setInternalEnabledTabs] = useState<TabType[] | undefined>(undefined);
  const [deskMergeEnabled, setDeskMergeEnabled] = useState(false);
  const [ticketView, setTicketView] = useState<TicketSearchView | null>(null);
  // The results page's search, while the palette is open because full page collapsed into it.
  const [collapsedSearch, setCollapsedSearch] = useState<string | null>(null);
  // Whether this open is Cmd+F (scoped, never teaches the size policy) or a search.
  const [sessionOrigin, setSessionOrigin] = useState<'search' | 'findInChannel'>('search');
  // The result that was highlighted on the results page, to keep highlighted after a collapse.
  const [preferredResultId, setPreferredResultId] = useState<string | null>(null);
  // The last query, restored because Cmd+K reopened right after a result was opened from it.
  const [returnOpen, setReturnOpen] = useState<{
    query: InitialQueryData;
    toggles: SearchScopeToggles;
    banner: boolean;
  } | null>(null);
  const policyOptions = useCmdkPolicyOptions();

  // External props take priority over internal state (e.g. when opened from SupportScreen)
  const initialMention =
    externalInitialMention !== undefined ? externalInitialMention : internalInitialMention;
  const contextualTab =
    externalInitialTab !== undefined ? externalInitialTab : internalContextualTab;
  const effectiveHideTabs = hideTabs !== undefined ? hideTabs : internalHideTabs;
  const effectiveEnabledTabs = enabledTabs !== undefined ? enabledTabs : internalEnabledTabs;
  const location = useLocation();
  const navigate = useNavigate();
  const allUsers = useUsers();
  const [allBoards] = useCachedQuery(queries.getAllBoardsList());

  const unreadCounts = useAllUnreadCount();

  const open = controlledOpen ?? internalOpen;
  const onOpenChange = controlledOnOpenChange ?? setInternalOpen;

  /**
   * Opens the palette scoped to the ticket screen underneath, read at open time so the
   * filters are never stale. False when no ticket screen is mounted.
   */
  const applyTicketView = useCallback((ticketContext: TicketSearchView): void => {
    setTicketView(ticketContext);
    setInternalInitialMention(null);
    setInternalContextualTab(TabType.TICKETS);
    setInternalHideTabs(true);
    setInternalEnabledTabs([TabType.TICKETS]);
  }, []);

  const openScopedToTicketScreen = useCallback((): boolean => {
    const ticketContext = getCurrentTicketView();
    if (!ticketContext) return false;
    applyTicketView(ticketContext);
    // The screen's own search, like Cmd+F: scoped, so it never teaches the open-size policy.
    setSessionOrigin('findInChannel');
    onOpenChange(true);
    return true;
  }, [applyTicketView, onOpenChange]);

  // Removing the view keeps the palette open on Tickets, as a plain search with every tab.
  const removeTicketView = useCallback((): void => {
    setTicketView(null);
    setInternalHideTabs(false);
    setInternalEnabledTabs(undefined);
  }, []);

  useEffect(() => {
    if (!ticketScreenScope) return;
    const open = (): void => {
      openScopedToTicketScreen();
    };
    window.addEventListener(OPEN_TICKET_SEARCH_EVENT, open);
    return (): void => window.removeEventListener(OPEN_TICKET_SEARCH_EVENT, open);
  }, [ticketScreenScope, openScopedToTicketScreen]);

  const handleOpenChange = useCallback(
    // False when an open went elsewhere instead of showing the palette.
    (newOpen: boolean, via?: 'shortcut'): boolean => {
      // Full page never has the palette over it: opening it there goes to the page's own search
      // box instead (where the page does not take it, as on mobile, the palette opens as before).
      if (newOpen && !open && fullPageSearch && focusFullPageSearch()) return false;
      if (newOpen && !open) setSessionOrigin('search');
      // Only Cmd+K itself (and the top bar's search, which invokes it) asks the policy what size to
      // open at and whether this is a quick return. A back-navigation reopening the palette on its
      // entry must not: with full page as the default it would send Back straight to full page
      // again. Not on the results page either (on mobile, the one place it opens there).
      if (
        via === 'shortcut' &&
        newOpen &&
        !open &&
        fullPageSearch &&
        context.workspaceId &&
        context.userID &&
        !isFullPageSearchPath(location.pathname)
      ) {
        const decision = openCmdk(
          loadCmdkPolicy(context.workspaceId, context.userID),
          Date.now(),
          policyOptions,
          'search',
        );
        saveCmdkPolicy(context.workspaceId, context.userID, decision.state);
        const restored = decision.restore?.query;
        // Full page is the learned default: go straight there, on the restored query if any.
        if (decision.size === 'full') {
          const params = restored ? resultsParamsForQuery(restored) : new URLSearchParams();
          saveFullPageOrigin(window.location.pathname + window.location.search);
          if (decision.announceFullPage) owedFullPageAnnouncement();
          recordDefaultFullPageOpen(context.userID);
          const query = params.toString();
          void navigate(`/search-results${query ? `?${query}` : ''}`);
          return false;
        }
        if (restored) {
          resumeSearchOnOpen();
          setReturnOpen({
            query: { mentions: restored.filterChips as ChipData[], text: restored.text },
            toggles: restored.toggles,
            banner: decision.bannerEligible,
          });
          setInternalContextualTab(restored.tab);
          onOpenChange(true);
          return true;
        }
      }
      if (newOpen && internalContextualTab === undefined && externalInitialTab === undefined) {
        const pathParts = location.pathname.split('/').filter(Boolean);
        if (pathParts.includes('support')) {
          setInternalContextualTab(TabType.DESK);
        }
      }
      onOpenChange(newOpen);
      if (!newOpen) {
        setInternalInitialMention(null);
        setInternalContextualTab(undefined);
        setInternalHideTabs(false);
        setInternalEnabledTabs(undefined);
        setDeskMergeEnabled(false);
        setTicketView(null);
        setCollapsedSearch(null);
        setReturnOpen(null);
        setPreferredResultId(null);
      }
      return true;
    },
    [
      navigate,
      onOpenChange,
      internalContextualTab,
      externalInitialTab,
      location.pathname,
      open,
      fullPageSearch,
      context.workspaceId,
      context.userID,
      policyOptions,
    ],
  );

  const handleFindInChannel = useCallback(() => {
    // On full page, Cmd+F goes to the page's own search box, like Cmd+K there.
    if (fullPageSearch && focusFullPageSearch()) return;
    // Cmd+F always opens the modal, whatever the learned size, and never teaches the policy.
    setSessionOrigin('findInChannel');
    // On a ticket screen, Cmd+F is the screen's search bar: a ticket search in its view.
    if (ticketScreenScope && openScopedToTicketScreen()) return;

    const pathParts = location.pathname.split('/').filter(Boolean);
    const supportIndex = pathParts.indexOf('support');
    setDeskMergeEnabled(supportIndex !== -1);

    const buildChannelMention = (channel: (typeof channelData)[number]): ChipData => {
      const channelName = resolveChannelLabel(channel, context.userID ?? '', allUsers);
      return { id: channel.id, name: channelName, type: 'channel', prefix: 'in:' };
    };

    if (pathParts.includes('tickets') || pathParts.includes('projects')) {
      setInternalInitialMention(null);
      setInternalContextualTab(TabType.TICKETS);
      setInternalHideTabs(false);
      setInternalEnabledTabs(undefined);
      onOpenChange(true);
      return;
    }

    if (supportIndex !== -1) {
      const deskChannelId = pathParts[supportIndex + 1] || null;
      const deskChannel = deskChannelId ? channelData.find(c => c.id === deskChannelId) : undefined;
      setInternalInitialMention(deskChannel ? buildChannelMention(deskChannel) : null);
      setInternalContextualTab(TabType.DESK);
      setInternalHideTabs(true);
      setInternalEnabledTabs([TabType.DESK]);
      onOpenChange(true);
      return;
    }

    const chatIndex = pathParts.indexOf('chat');
    let channelId: string | null = null;
    if (chatIndex !== -1) {
      const nextSegment = pathParts[chatIndex + 1];
      if (
        nextSegment === 'dir' ||
        nextSegment === 'dm' ||
        nextSegment === 'bookmarks' ||
        nextSegment === 'activity'
      ) {
        channelId = pathParts[chatIndex + 2] || null;
      }
    }

    if (channelId) {
      const channel = channelData.find(c => c.id === channelId);
      if (channel) {
        // Desk (support) channel → open with Desk tab + in:<channel> scope
        if (channel.type === ChannelType.SUPPORT) {
          setInternalInitialMention(buildChannelMention(channel));
          setInternalContextualTab(TabType.DESK);
          setInternalHideTabs(false);
          setInternalEnabledTabs(undefined);
          onOpenChange(true);
          return;
        }
        // Inside a channel but viewing its Tickets sub-tab (URL carries
        // `?tab=tickets`) → open with the Tickets tab + in:<channel> scope.
        const activeChannelTab = new URLSearchParams(location.search).get('tab');
        if (activeChannelTab === 'tickets') {
          setInternalContextualTab(TabType.TICKETS);
          setInternalInitialMention(buildChannelMention(channel));
          setInternalHideTabs(false);
          setInternalEnabledTabs(undefined);
          onOpenChange(true);
          return;
        }
        setInternalContextualTab(TabType.MESSAGES);
        setInternalInitialMention(buildChannelMention(channel));
        setInternalHideTabs(false);
        setInternalEnabledTabs(undefined);
        onOpenChange(true);
        return;
      }
    }

    // Fallback — open normally (ALL tab)
    setInternalContextualTab(undefined);
    setInternalInitialMention(null);
    setInternalHideTabs(false);
    setInternalEnabledTabs(undefined);
    onOpenChange(true);
  }, [
    location.pathname,
    location.search,
    channelData,
    allUsers,
    onOpenChange,
    context.userID,
    ticketScreenScope,
    openScopedToTicketScreen,
    fullPageSearch,
  ]);

  // Only the search-mode instance owns Cmd+F; the context-picker copy mounted in
  // ThreadPannel would otherwise win the tiebreak and hijack the shortcut.
  useShortcutById('global.findInChannel', handleFindInChannel, {
    enabled: !contextSelectionMode,
  });

  // Group channels by scope type
  const { starred, channels, directMessages } = useMemo(() => {
    // Referenced only so this memo re-runs when affinity weights finish loading (the weights
    // themselves are read imperatively via getChannelWeight below); keeps exhaustive-deps active.
    void affinityVersion;
    if (!channelData.length) return { starred: [], channels: [], directMessages: [] };

    // Index visible channels by id once (O(n)); the previous `.find` inside this
    // `.map` was O(n * m) over ~749 all x ~431 visible channels per recompute.
    const visibleById = new Map(visibleAllChannels.map(vc => [vc.id, vc]));
    const visibleChannels = channelData.map(channel => {
      const vc = visibleById.get(channel.id);
      if (vc) {
        return vc;
      }
      return {
        ...channel,
      };
    }) as VisibleChannel[];
    const grouped = groupChannelsByScope(visibleChannels, allChannelsUserStatus);

    // groupChannelsByScope excludes EMAIL channels (they live in Desk, not chat sidebar).
    // Re-include them so the search `in:` picker can scope to desk channels.
    const emailChannels = visibleChannels.filter(c => isDeskChannelType(c.type));

    // Rank each group by personalization weight (desc), tie-break on recency (shared with the
    // `/chat`/`/call` pickers). No weights → 0 ties → pure recency, identical to the previous order.
    const rankedStarred = rankChannelsByAffinity(grouped.starred);
    const rankedChannels = rankChannelsByAffinity([...grouped.channels, ...emailChannels]);
    const rankedDirectMessages = rankChannelsByAffinity(grouped.directMessages);

    return {
      starred: rankedStarred,
      channels: rankedChannels,
      directMessages: rankedDirectMessages,
    };
  }, [channelData, allChannelsUserStatus, visibleAllChannels, affinityVersion]);

  // Reconstruct a search (mention chips + trailing text) from results-page params.
  // Shared by both restore paths: the live URL when the palette is reopened from the
  // results header, and the parked state when the user navigates back to it.
  /**
   * Reconstruct a search (chips + trailing text) from results-page params. Both restore
   * paths use it: the live URL when reopened from the results header, and the parked state
   * on a back-navigation. Chips and text both come from the filter registry, so the palette
   * shows exactly the filters the page had.
   */
  const buildQueryFromParams = useCallback(
    (params: URLSearchParams): InitialQueryData | null => {
      const filters = { ...DEFAULT_SEARCH_FILTERS, ...readFiltersFromParams(params, {}) };

      const mentions: ChipData[] = buildChips(filters, {
        userName: id => {
          const user = allUsers.find(u => u.id === id);
          return user ? getUserDisplayName(user) : undefined;
        },
        channelName: id => {
          const channel = channelData.find(c => c.id === id);
          return channel ? resolveChannelLabel(channel, context.userID ?? '', allUsers) : undefined;
        },
        // Board chips carry the id the backend matches on; without this the restored chip
        // renders as a raw cuid.
        boardName: id =>
          (allBoards as ReadonlyArray<{ id: string; name: string }> | undefined)?.find(
            b => b.id === id,
          )?.name,
      })
        .map((chip): ChipData | null => {
          // An id with no resolvable name is a user/channel we can't render — drop it
          // rather than show a raw id. Emails and the priority chip are their own label.
          const isEntity = chip.type !== 'priority';
          const name = chip.name ?? (chip.id.includes('@') ? chip.id : '');
          if (isEntity && !name) return null;
          return {
            id: chip.id,
            name: chip.type === 'priority' ? chip.id.toLowerCase() : name,
            type: chip.type,
            ...(chip.prefix ? { prefix: chip.prefix } : {}),
          };
        })
        .filter((m): m is ChipData => m !== null);

      // Whatever has no chip form (status, tags, date ranges) goes back as the typed syntax
      // the palette parses — how it was expressible there in the first place. Filters that
      // do have chips return an empty queryText, so nothing is carried twice.
      const queryText = params.get('query')?.trim() ?? '';
      const text = [queryText, buildQueryText(filters)].filter(Boolean).join(' ');

      if (mentions.length === 0 && !text) return null;
      return { mentions, text };
    },
    [allUsers, channelData, context.userID, allBoards],
  );

  // The URL restore (top-bar screen search) or a collapse from full page, which carries the
  // results page's search because the location has already moved on by the time it opens.
  const restoreSearch = restoreQueryFromUrl ? location.search : collapsedSearch;

  const initialQuery = useMemo(
    () =>
      restoreSearch !== null ? buildQueryFromParams(new URLSearchParams(restoreSearch)) : null,
    [restoreSearch, buildQueryFromParams],
  );

  // The scope the results page is searching at, so reopening the palette doesn't quietly
  // re-run the search somewhere else. Absent `myChannels` means the default (ON).
  const togglesFromParams = useCallback(
    (params: URLSearchParams): SearchScopeToggles => ({
      onlyMyChannels: params.get('myChannels') !== '0',
      includeBotMessages: params.get('automations') === '1',
    }),
    [],
  );

  const initialToggles = useMemo(
    () => (restoreSearch !== null ? togglesFromParams(new URLSearchParams(restoreSearch)) : null),
    [restoreSearch, togglesFromParams],
  );

  const openCollapsed = useCallback(
    (search: string): void => {
      // The results page keeps its docType in `tab`; land the palette on the matching tab.
      const params = new URLSearchParams(search);
      const docType = params.get('tab');
      setCollapsedSearch(search);
      setSessionOrigin('search');
      setPreferredResultId(params.get(SELECTED_RESULT_PARAM));
      setInternalInitialMention(null);
      setInternalContextualTab(
        docType && docType in DOC_TYPE_TO_TAB
          ? DOC_TYPE_TO_TAB[docType as keyof typeof DOC_TYPE_TO_TAB]
          : undefined,
      );
      setInternalHideTabs(false);
      setInternalEnabledTabs(undefined);
      // The search the results page just ran: the palette re-runs it at once, from the cache.
      resumeSearchOnOpen();
      onOpenChange(true);
    },
    [onOpenChange],
  );

  // Where a collapse from full page is taking the user back to, until they get there. The palette
  // opens at once (the click must feel immediate), but the router applies navigations as
  // transitions and may keep the results page up while the origin route loads; the palette's
  // history entry waits for the origin, since pushing it earlier would cancel the way back.
  const [collapseReturnTo, setCollapseReturnTo] = useState<string | null>(null);

  // Every page the user lands on outside full page is a place a collapse can return to.
  useEffect(() => {
    noteLocation(location.pathname + location.search);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!fullPageSearch) return;
    const onCollapse = (event: Event): void => {
      const { search, origin, returnVia } = (event as CustomEvent<CollapseToCmdkDetail>).detail;
      openCollapsed(search);
      if (!origin) return;
      setCollapseReturnTo(origin.href);
      // Step back to the entry the palette expanded from rather than pushing a new one, so the
      // stack stays as it was before the expand and Back keeps meaning what it did. A step back
      // renders the page it lands on in one blocking pass, so it waits for the palette to land
      // with its content showing first: the collapse plays out in full, then the page fills in.
      const here = (window.history.state as { idx?: unknown } | null)?.idx;
      const returnBack = (): void => {
        if (
          origin.historyIndex !== null &&
          typeof here === 'number' &&
          origin.historyIndex < here
        ) {
          void navigate(origin.historyIndex - here);
        } else {
          void navigate(origin.href);
        }
      };
      void whenCollapseSettled(COLLAPSE_SETTLE_TIMEOUT_MS).then(returnVia ?? returnBack);
    };
    window.addEventListener(COLLAPSE_TO_CMDK_EVENT, onCollapse);
    return (): void => window.removeEventListener(COLLAPSE_TO_CMDK_EVENT, onCollapse);
  }, [fullPageSearch, openCollapsed, navigate]);

  useEffect(() => {
    if (!collapseReturnTo) return;
    const target = new URL(collapseReturnTo, window.location.origin);
    if (location.pathname === target.pathname && location.search === target.search) {
      setCollapseReturnTo(null);
      return;
    }
    // A return that never lands must not leave the palette without its history entry for good.
    const timer = setTimeout(() => setCollapseReturnTo(null), 5000);
    return (): void => clearTimeout(timer);
  }, [collapseReturnTo, location.pathname, location.search]);

  /**
   * The search the results page was actually showing, for a back-navigation. Preferred over
   * the palette's own snapshot, which froze when it handed off and so misses anything the
   * user filtered on the page.
   */
  const restoreFromLastSearch = useCallback((): PaletteRestore | null => {
    const params = readLastSearchState();
    if (!params) return null;
    const query = buildQueryFromParams(params);
    if (!query) return null;
    return { ...query, toggles: togglesFromParams(params) };
  }, [buildQueryFromParams, togglesFromParams]);

  // `mod+/` in screen mode seeds `/` so the overlay opens straight into slash-command discovery,
  // taking priority over any URL-restored query.
  const seededInitialQuery: InitialQueryData | null = seedCommand
    ? { mentions: [], text: '/' }
    : (initialQuery ?? returnOpen?.query ?? null);
  const seededToggles = initialToggles ?? returnOpen?.toggles ?? null;

  if (!context.userID) return null;

  return (
    <ChannelCommandMenu
      channels={channels}
      starred={starred}
      directMessages={directMessages}
      currentUserID={context.userID}
      unreadCounts={unreadCounts}
      open={open}
      onOpenChange={handleOpenChange}
      initialMention={initialMention}
      {...(seededInitialQuery !== null ? { initialQuery: seededInitialQuery } : {})}
      {...(seededToggles !== null ? { initialToggles: seededToggles } : {})}
      restoreFromLastSearch={restoreFromLastSearch}
      {...(contextSelectionMode !== undefined ? { contextSelectionMode } : {})}
      {...(contextItems !== undefined ? { contextItems } : {})}
      {...(selectionVariant !== undefined ? { selectionVariant } : {})}
      {...(compactTabs !== undefined ? { compactTabs } : {})}
      {...(onContextItemToggle !== undefined ? { onContextItemToggle } : {})}
      {...(onContextSelectionConfirm !== undefined ? { onContextSelectionConfirm } : {})}
      {...(effectiveEnabledTabs !== undefined ? { enabledTabs: effectiveEnabledTabs } : {})}
      {...(inline !== undefined ? { inline } : {})}
      {...(onTabChange !== undefined ? { onTabChange } : {})}
      {...(contextualTab !== undefined ? { initialTab: contextualTab } : {})}
      {...(disableAutoFocus !== undefined ? { disableAutoFocus } : {})}
      {...(effectiveHideTabs ? { hideTabs: effectiveHideTabs } : {})}
      {...(aiOverview !== undefined ? { aiOverview } : {})}
      deskMergeEnabled={deskMergeEnabled}
      fullPageSearch={fullPageSearch ?? false}
      returnBanner={returnOpen?.banner ?? false}
      deferHistory={collapseReturnTo !== null}
      sessionOrigin={sessionOrigin}
      preferredResultId={preferredResultId}
      ticketView={ticketView}
      onRemoveTicketView={removeTicketView}
      onRestoreTicketView={applyTicketView}
    />
  );
};

export default GlobalCommandMenu;
