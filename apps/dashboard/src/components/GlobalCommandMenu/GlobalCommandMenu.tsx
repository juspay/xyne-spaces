import { ReactElement, useState, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthContextValues } from '../../hooks/useAuth';
import {
  useAllChannels,
  useAllVisibleChannels,
  useUserChannelStatuses,
} from '../../hooks/useChannels';
import { ChannelScopeType, isDeskChannelType, ChannelType } from '@xyne/shared';
import {
  groupChannelsByScope,
  isDMChannel,
  getDMParticipantIdsToFetch,
} from '../Chat/ChatDirectory/ChatDirectory.utils';
import { useAllUnreadCount } from '../../hooks/useUnreadCount';
import { rankChannelsByAffinity } from '../../utils/rankingUtils';
import { useAffinityCallback } from '../../hooks/useAffinityCallback';
import ChannelCommandMenu from '../Chat/ChatDirectory/ChannelCommandMenu';
import type { ContextItem } from '../Chat/ThreadContextPanel/ThreadContextPanel.types';
import {
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

export function resolveDMChannelName(
  channel: { name: string; scopeType: ChannelScopeType },
  currentUserId: string,
  allUsers: { id: string; name?: string | null; displayName?: string | null }[],
): string {
  if (!isDMChannel(channel.scopeType)) return channel.name;
  const participantIds = getDMParticipantIdsToFetch(channel, currentUserId);
  const names = participantIds
    .map(id => {
      const u = allUsers.find(u => u.id === id);
      return u ? u.displayName || u.name || null : null;
    })
    .filter((name): name is string => !!name);
  return names.length > 0 ? names.join(', ') : channel.name;
}

interface GlobalCommandMenuProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  contextSelectionMode?: boolean;
  contextItems?: ContextItem[];
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
}

const GlobalCommandMenu = ({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  contextSelectionMode,
  contextItems,
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

  // External props take priority over internal state (e.g. when opened from SupportScreen)
  const initialMention =
    externalInitialMention !== undefined ? externalInitialMention : internalInitialMention;
  const contextualTab =
    externalInitialTab !== undefined ? externalInitialTab : internalContextualTab;
  const effectiveHideTabs = hideTabs !== undefined ? hideTabs : internalHideTabs;
  const effectiveEnabledTabs = enabledTabs !== undefined ? enabledTabs : internalEnabledTabs;
  const location = useLocation();
  const allUsers = useUsers();
  const [allBoards] = useCachedQuery(queries.getAllBoardsList());

  const unreadCounts = useAllUnreadCount();

  const open = controlledOpen ?? internalOpen;
  const onOpenChange = controlledOnOpenChange ?? setInternalOpen;

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
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
      }
    },
    [onOpenChange, internalContextualTab, externalInitialTab, location.pathname],
  );

  const handleFindInChannel = useCallback(() => {
    const pathParts = location.pathname.split('/').filter(Boolean);
    const supportIndex = pathParts.indexOf('support');
    setDeskMergeEnabled(supportIndex !== -1);

    const buildChannelMention = (channel: (typeof channelData)[number]): ChipData => {
      const channelName = resolveDMChannelName(channel, context.userID ?? '', allUsers);
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
  }, [location.pathname, location.search, channelData, allUsers, onOpenChange, context.userID]);

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
          return channel
            ? resolveDMChannelName(channel, context.userID ?? '', allUsers)
            : undefined;
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

  const initialQuery = useMemo(
    () => (restoreQueryFromUrl ? buildQueryFromParams(new URLSearchParams(location.search)) : null),
    [restoreQueryFromUrl, location.search, buildQueryFromParams],
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
    () => (restoreQueryFromUrl ? togglesFromParams(new URLSearchParams(location.search)) : null),
    [restoreQueryFromUrl, location.search, togglesFromParams],
  );

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
    : initialQuery;

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
      {...(initialToggles !== null ? { initialToggles } : {})}
      restoreFromLastSearch={restoreFromLastSearch}
      {...(contextSelectionMode !== undefined ? { contextSelectionMode } : {})}
      {...(contextItems !== undefined ? { contextItems } : {})}
      {...(onContextItemToggle !== undefined ? { onContextItemToggle } : {})}
      {...(onContextSelectionConfirm !== undefined ? { onContextSelectionConfirm } : {})}
      {...(effectiveEnabledTabs !== undefined ? { enabledTabs: effectiveEnabledTabs } : {})}
      {...(inline !== undefined ? { inline } : {})}
      {...(onTabChange !== undefined ? { onTabChange } : {})}
      {...(contextualTab !== undefined ? { initialTab: contextualTab } : {})}
      {...(disableAutoFocus !== undefined ? { disableAutoFocus } : {})}
      {...(effectiveHideTabs ? { hideTabs: effectiveHideTabs } : {})}
      deskMergeEnabled={deskMergeEnabled}
    />
  );
};

export default GlobalCommandMenu;
