import { logger, Event as LogEvent } from '../../../utils/logger';
import React, { ReactElement, useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { X, SlidersHorizontal, SignalHigh, Check } from 'lucide-react';
import {
  ChatDefault,
  UserTwo,
  UserDefault,
  Hashtag,
  Lock02Close,
  TicketToken,
  FolderDefault,
  File02Text,
  Phone,
  MicOn,
  EnvelopeDefault,
  Spinner,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ArrowTurnDownLeft,
  SearchDefault,
  CheckTickSingle,
  FilterFunnel,
} from '@xyne/icons';
import * as Tabs from '@radix-ui/react-tabs';
import * as Popover from '@radix-ui/react-popover';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Channel, ChannelVisibility, isDeskChannelType, TicketPriority } from '@xyne/shared';
import { PRIORITY_ICON_COLOR } from './FilterChipNode';
import {
  isDMChannel,
  isGroupDMChannel,
  isOneToOneDMChannel,
  getDMParticipantIdsToFetch,
  parseDMParticipantIds,
  getDMNames,
  formatChannelLabel,
} from './ChatDirectory.utils';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import Avatar from '../../ui/Avatar/Avatar';
import Badge from '../../ui/Badge';
import { DisplaySearchResult } from '../../../types/search';
import {
  TabType,
  TAB_TO_DOC_TYPE,
  MentionType,
  type MentionData,
  ChannelCommandMenuProps,
  TYPE_SUGGESTIONS,
  SearchableTypes,
  GROUP_KEY_TO_DOC_TYPE,
  getRelevantTabs,
} from './ChannelCommandMenu.types';
import type { ChannelTriggerType, UserTriggerType } from './MentionPlugin';
import { loadRecents } from '../../../utils/contextPickerRecents';
import ThreadContextPanel from '../ThreadContextPanel/ThreadContextPanel';
import {
  buildContextItemFromResult,
  buildContextItemFromChannel,
} from '../ThreadContextPanel/contextItem.utils';
import { ChannelCategory } from './ChatDirectory.types';
import {
  navigateToSearchResult,
  navigateToUser,
  openSearchResult,
} from '../../../utils/searchNavigation';
import { isElectronApp } from '../../../utils/electronApp';
import { useAllChannels } from '../../../hooks/useChannels';
import { useAffinityCallback } from '../../../hooks/useAffinityCallback';
import { useDeskContacts } from '../../../hooks/useDeskContacts';
import { useDeskPeople, ALL_DESK } from '../../../hooks/useDeskPeople';
import { useUsers, useUserSearch, useUser } from '../../../hooks/useUsers';
import { QuickDmComposer } from './SlashCommands/QuickDmComposer';
import type { CommandTarget } from './SlashCommands/QuickDmComposer';
import { ResultActionsMenu } from './ResultActionsMenu';
import { SlashCommandPalette } from './SlashCommands/SlashCommandPalette';
import { useSlashCommands, type SlashCommandClickInfo } from './SlashCommands/useSlashCommands';
import { getCommand, COMMAND_KINDS } from './SlashCommands/commands';
import { useSlashCommandMetrics } from '../../../hooks/useSlashCommandMetrics';
import type { SlashSelectionType } from '../../../types/slashCommandEvents';
import { CallConfirmationModal } from '../../Call/CallConfirmationModal';
import { ActionModal } from '../../Call/ActionModal';
import { cn } from '../../../utils/classNames';
import SearchResultItem from './SearchResultItem';
import { getUserDisplayName, isUserDeactivated } from '../../../utils/userDisplayName';
import { LexicalSearchInput, type InitialQueryData } from './LexicalSearchInput';
import { StatusIndicator } from '../../ui/StatusIndicator';
import { useSearchMetrics, CMDK_USER_LIMIT } from '../../../hooks/useSearchMetrics';
import { filterChannelsBySearchableNames, rankUsersWithMfu } from '../../../utils/rankingUtils';
import { searchMetricsService } from '../../../services/searchMetricsService';
import { useHistoryBackedOverlay } from '../../../hooks/useHistoryBackedOverlay';
import { useScope, useShortcutById } from '../../../shortcuts';
import { useSearchMode } from '../../../hooks/useSearchMode';
import { usePlatform } from '../../../hooks/usePlatform';
import { FilePreviewModal } from '../../FileViewer/FileViewerModal';
import { TYPE_AUTOCOMPLETE_REGEX, parseTypeFilter } from '../../../utils/searchFilterParser';
import { TicketPreviewPanel } from './TicketPreviewPanel';
import type { SearchResultsFilters } from '../../../hooks/useSearchResultsScreen';
import { apiInstance } from '../../../services/clients/apiClient';
import { MergeTicketsDialog } from '../../Tickets/MergeTicketsDialog/MergeTicketsDialog';
import { toast } from 'sonner';
import Button from '../../ui/Button';

type SearchResultsDocType = SearchResultsFilters['docType'];

function stripHtmlTags(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || html;
}
// Exported so the Ask AI inline context picker (XyneAISidebar/ContextPicker)
// renders channel rows with this exact component instead of a copy.
export const ChannelCommandItem = ({
  channel,
  currentUserID,
  unreadCount,
  onSelect,
  onItemMouseDown,
  getChannelIcon,
  isSelected = false,
}: {
  channel: Channel;
  currentUserID: string;
  unreadCount: number;
  onSelect: (displayName: string) => void;
  onItemMouseDown?: (e: React.MouseEvent) => void;
  getChannelIcon: (channel: Channel) => ReactElement;
  isSelected?: boolean;
}): ReactElement | null => {
  const { displayName } = useChannelDisplayName(channel, currentUserID);
  const { isMobile } = usePlatform();
  const otherUserId = isOneToOneDMChannel(channel.scopeType)
    ? (parseDMParticipantIds(channel).find(id => id !== currentUserID) ?? '')
    : '';
  const targetUser = useUser(otherUserId);
  const hasStatus = targetUser && (targetUser.statusEmoji || targetUser.statusContent);

  return (
    <Command.Item
      key={channel.id}
      value={`channel-${channel.id}-${displayName}`}
      data-item-label={displayName}
      data-result-id={channel.id}
      data-result-type='channel'
      onSelect={() => onSelect(displayName)}
      onMouseDownCapture={onItemMouseDown}
      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer mt-1.5 aria-selected:bg-accent ${!isMobile && 'hover:bg-accent'}`}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      <div className='flex items-center justify-center h-4 w-5 flex-shrink-0 text-muted-foreground'>
        {getChannelIcon(channel)}
      </div>
      <div className='flex-1 min-w-0 flex items-center gap-1'>
        <span className='text-left text-[15px] leading-[1.2] tracking-[-0.1px] text-foreground truncate'>
          {displayName}
        </span>
        {hasStatus && (
          <StatusIndicator
            statusEmoji={targetUser.statusEmoji}
            statusContent={targetUser.statusContent}
            statusExpiryAt={targetUser.statusExpiryAt}
            size='sm'
          />
        )}
      </div>
      {isSelected ? (
        <span className='flex-shrink-0 flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground'>
          <CheckTickSingle size={10} />
        </span>
      ) : (
        unreadCount > 0 && (
          <Badge variant='success' className='font-mono shrink-0 text-xs px-1.5 py-0'>
            {unreadCount}
          </Badge>
        )
      )}
    </Command.Item>
  );
};

// Call-site override for the shared ui/Button in the desk-merge bar: the primitive
// ships `focus-visible:ring-[3px]`, but nothing inside the palette is Tab-reachable
// (Tab is intercepted for tab-cycling), so that ring only ever appears as a
// click-then-Tab artifact. Overridden here rather than in ui/Button, which other
// screens rely on for real keyboard navigation.
const MERGE_BAR_BUTTON_NO_RING = 'focus-visible:outline-none focus-visible:ring-0';

const DEFAULT_ENABLED_TABS: TabType[] = [
  TabType.MESSAGES,
  TabType.USERS,
  TabType.CHANNELS,
  TabType.ATTACHMENTS,
  TabType.TICKETS,
  TabType.DESK,
];

// A backend result group belongs to the active tab (ALL shows all; Files shows every
// media kind). Prevents stale cross-tab groups from flashing during the search debounce.
const backendGroupBelongsToTab = (groupKey: string, tab: TabType): boolean => {
  if (tab === TabType.ALL) return true;
  if (tab === TabType.MESSAGES) return groupKey === 'conversation';
  if (tab === TabType.TICKETS) return groupKey === 'ticket';
  if (tab === TabType.ATTACHMENTS) {
    return (
      groupKey === 'attachment' ||
      groupKey === 'canvas' ||
      groupKey === 'transcript' ||
      groupKey === 'recording'
    );
  }
  if (tab === TabType.CANVAS) return groupKey === 'canvas';
  if (tab === TabType.CALL) return groupKey === 'transcript';
  if (tab === TabType.RECORDING) return groupKey === 'recording';
  if (tab === TabType.DESK) return groupKey === 'desk';
  return false;
};

// Faint format hints for filters that open NO typeahead popup, so the caret would
// otherwise sit after a bare colon with no cue. Shown only while the value is empty
// (regex ends at `:` ) and cleared as soon as the user types a value.
const TEXT_FILTER_HINTS: Record<string, string> = {
  before: 'YYYY-MM-DD',
  after: 'YYYY-MM-DD',
  on: 'YYYY-MM-DD',
  range: 'last 7 days',
  board: 'board name',
  tags: 'tag1, tag2',
  stage: 'stage name',
  status: 'open',
  // `type:` with no value - hint the value set; `typeAutocomplete` completes it once you type.
  type: 'messages, files, tickets…',
};
const TEXT_FILTER_HINT_REGEX = /\b(before|after|on|range|board|tags|stage|status|type):\s*$/i;

const isPreviewableTicketResult = (result: DisplaySearchResult | null): boolean =>
  !!result &&
  (result.type === 'ticket' ||
    (result.type === 'conversation' && result.searchContext?.subApp === 'DESK'));

// A cmdk item, not a button, so arrow keys reach it. No `data-item-label` on purpose — that
// would splice "See N more" into the input's ghost preview.
const SeeMoreItem = ({
  value,
  label,
  onSelect,
  hoverable,
  trackCategory,
  trackName,
  trackMetadata,
}: {
  value: string;
  label: string;
  onSelect: () => void;
  hoverable: boolean;
  trackCategory: string;
  trackName: string;
  trackMetadata: string;
}): ReactElement => (
  <Command.Item
    value={value}
    onSelect={onSelect}
    className={`w-full px-2 py-1.5 mt-1 text-sm text-muted-foreground rounded-lg text-left cursor-pointer transition-colors aria-selected:text-foreground aria-selected:bg-accent ${hoverable ? 'hover:text-foreground hover:bg-accent' : ''}`}
    style={{ WebkitTapHighlightColor: 'transparent', userSelect: 'none' }}
    data-track-category={trackCategory}
    data-track-name={trackName}
    data-track-metadata={trackMetadata}
  >
    {label}
  </Command.Item>
);

const ChannelCommandMenu = ({
  channels,
  starred,
  directMessages,
  currentUserID,
  unreadCounts,
  open,
  onOpenChange,
  contextSelectionMode = false,
  contextItems = [],
  onContextItemToggle,
  onContextSelectionConfirm,
  initialMention,
  initialQuery,
  enabledTabs,
  inline = false,
  onTabChange,
  initialTab,
  hideTabs = false,
  deskMergeEnabled = false,
}: ChannelCommandMenuProps): ReactElement | null => {
  const navigate = useNavigate();
  const channelData = useAllChannels();
  const commandRef = useRef<HTMLDivElement | null>(null);
  // MutationObserver (owned by attachCommandRef) that recomputes the ⌥↵ hint when cmdk adds/removes rows.
  const rowListObserverRef = useRef<MutationObserver | null>(null);
  // The highlighted result row the ⌥↵ Actions menu opens above.
  const actionsAnchorRef = useRef<HTMLElement | null>(null);
  // Tracks whether the most recent activation gesture (mouse or keyboard)
  // carried a Cmd/Ctrl modifier. cmdk's onSelect strips the event and a
  // synthetic .click() strips modifier flags, so we prime this ref from
  // onMouseDownCapture and from the Enter branch of handleCommandKeyDown.
  const lastModifierRef = useRef<boolean>(false);
  // Slash-command usage funnel (logs-only). `lastSlashSelectionRef` is primed by
  // the mouse/keyboard handlers before cmdk's synthetic onSelect fires, so the
  // click event can record how the row was chosen (mouse / tab / arrow+enter).
  // `slashSessionActiveRef`/`slashInvokedRef` drive the session start/end effects.
  const slashMetrics = useSlashCommandMetrics({ userId: currentUserID });
  const lastSlashSelectionRef = useRef<SlashSelectionType>('unknown');
  const slashSessionActiveRef = useRef(false);
  const slashInvokedRef = useRef(false);
  // The last rendered view (`stage:command:count`) logged, so a changed view —
  // including one reached by backspacing — re-emits, but a consecutive identical
  // render (e.g. async result settling) doesn't.
  const lastSlashImpressionKeyRef = useRef('');
  const openedAtHrefRef = useRef('');
  useEffect(() => {
    if (open) {
      openedAtHrefRef.current = window.location.pathname + window.location.search;
    }
  }, [open]);

  useScope('command', open);

  const { searchMode } = useSearchMode();

  // The top-bar palette (screen mode, tabs hidden) always routes to the results page;
  // the default cmd+K popup renders results inline. Both show the "Show results for"
  // row, but only the screen palette lets it own the default Enter target.
  const isScreenPalette = hideTabs && searchMode === 'screen';

  // The row's onSelect fires for both a click and an Enter press, and cmdk hands it no
  // event — so the pointer path stamps this ref and Enter falls through to the default.
  const showResultsTriggerRef = useRef<'click' | 'keyboard'>('keyboard');

  // Guards the jump to the results page against a double activation (onClick + onSelect).
  // Reset whenever the palette opens again.
  const navigatingToResultsRef = useRef(false);
  useEffect(() => {
    if (open) navigatingToResultsRef.current = false;
  }, [open]);

  // When opened via the `mod+/` shortcut, seed the search box with `/` so it lands in command mode.
  // The popup path flips this on in the shortcut handler; the screen overlay is mounted fresh with a
  // `/` initialQuery, so seed from that here to render the palette on frame 1 (no normal-search flash).
  const [seedCommandMode, setSeedCommandMode] = useState(
    () => initialQuery?.text === '/' && initialQuery?.mentions.length === 0,
  );
  // The search the user left behind when the palette sent them to the results page, handed
  // back by the history hook so pressing back reopens cmd+K exactly as they typed it.
  const [restoredQuery, setRestoredQuery] = useState<InitialQueryData | null>(null);

  // While seeding, feed the editor a `/` through the existing initial-query path; a restored
  // search goes down the same path. Otherwise pass the caller's query straight through.
  // Memoized so the reference stays stable across renders.
  const effectiveInitialQuery = useMemo(
    () =>
      seedCommandMode ? { mentions: [], text: '/' } : restoredQuery ? restoredQuery : initialQuery,
    [seedCommandMode, restoredQuery, initialQuery],
  );

  // Cmd+K joins the URL history stack: opening pushes an entry, so the top-bar back arrow
  // (and the browser back gesture) closes the palette instead of leaving the page. When a
  // row sends the user to the results page, that entry keeps the search — so back from the
  // results page reopens the palette with it rather than landing on a bare page.
  const { markNavigating, setPayload } = useHistoryBackedOverlay<InitialQueryData>({
    open,
    onClose: () => onOpenChange(false),
    onRestore: restored => {
      setRestoredQuery(restored ?? null);
      onOpenChange(true);
    },
    id: 'command-menu',
    enabled: !inline && !contextSelectionMode,
  });

  // A restore only seeds the open it triggered — the next plain cmd+K starts empty.
  useEffect(() => {
    if (!open) setRestoredQuery(null);
  }, [open]);

  useShortcutById(
    'global.search',
    () => {
      // Cmd+K opens this palette in both search modes. Screen-mode behavior (2-item previews +
      // "See more" that routes to `/search-results`) comes from the `searchMode === 'screen'`
      // checks below.
      onOpenChange(!open);
      if (!open && !searchSessionId) {
        onOpen('keyboard_shortcut');
      }
    },
    { enabled: !contextSelectionMode },
  );

  // `mod+/` opens the menu straight into command mode (seeds `/` for slash-command discovery)
  // in both search modes.
  useShortcutById(
    'global.openCommandMode',
    () => {
      onOpenChange(true);
      if (!open && !searchSessionId) {
        onOpen('keyboard_shortcut');
      }
      setSeedCommandMode(true);
    },
    { enabled: !contextSelectionMode },
  );

  useShortcutById(
    'command.close',
    () => {
      onOpenChange(false);
    },
    {
      enabled: open,
    },
  );

  const allUsers = useUsers();
  // Map users by ID for quick lookup
  const usersById = useMemo(() => {
    return new Map(allUsers.map(user => [user.id, user]));
  }, [allUsers]);

  // Move 'allChannels' definition up here to pass to hook
  const allChannels = useMemo(() => {
    const result: Array<{
      channel: Channel;
      category: ChannelCategory;
      searchableNames?: string[];
      searchNames?: string[];
    }> = [];

    // Add starred channels
    starred.forEach(channel => {
      const dmNames = getDMNames(channel, currentUserID, usersById);
      result.push({
        channel,
        category: ChannelCategory.STARRED,
        searchableNames: dmNames.display,
        searchNames: dmNames.search,
      });
    });

    // Add regular channels
    channels.forEach(channel => {
      result.push({
        channel,
        category: ChannelCategory.CHANNELS,
        searchableNames: [channel.name],
      });
    });

    // Add direct messages
    directMessages.forEach(channel => {
      const dmNames = getDMNames(channel, currentUserID, usersById);
      result.push({
        channel,
        category: ChannelCategory.DIRECT_MESSAGES,
        searchableNames: dmNames.display,
        searchNames: dmNames.search,
      });
    });

    return result;
  }, [channels, starred, directMessages, usersById]);

  const getResultChannelLabel = useCallback(
    (result: DisplaySearchResult): string | undefined => {
      const channelId = result.searchContext?.channelId;
      if (!channelId) return undefined;
      const channel = allChannels.find(item => item.channel.id === channelId);
      return channel ? formatChannelLabel(channel) : undefined;
    },
    [allChannels],
  );

  // Map of user IDs the current user has a 1:1 DM with → recency index
  // (0 = first DM in `directMessages`, which is the recency-ordered list also
  // used by the empty-state DIRECT MESSAGES section). `rankUsers` uses this
  // both as a "frequent contact" signal AND as a tie-breaker so the `from:`
  // typeahead's empty state mirrors the plain-search DM ordering.
  const dmContactRecency = useMemo(() => {
    const map = new Map<string, number>();
    directMessages.forEach(channel => {
      if (isOneToOneDMChannel(channel.scopeType)) {
        const participants = parseDMParticipantIds(channel);
        const otherUserId = participants.find(id => id !== currentUserID);
        if (otherUserId && !map.has(otherUserId)) map.set(otherUserId, map.size);
      }
    });
    return map;
  }, [directMessages, currentUserID]);

  // Resolved enabled tabs — computed early so useEffects below can reference it
  const activeEnabledTabs = enabledTabs ?? DEFAULT_ENABLED_TABS;

  // Mention search state - declared before useSearchMetrics so it can be passed to the hook
  const [mentionSearchQuery, setMentionSearchQuery] = useState('');
  const [mentionSearchType, setMentionSearchType] = useState<MentionType | null>(null);

  const {
    searchResults: backendResults,
    isSearching: isLoading,
    searchError: error,
    paginationState,
    isLoadingMore,
    isGrouped,
    resetSearchState,
    onOpen,
    onClose,
    onResultClick,
    setScrollContainer,
    searchSessionId,
    text: searchText,
    setText: setSearchText,
    inputRef,
    // New hookstate
    activeTab,
    setActiveTab,

    selectedMentions,
    setSelectedMentions,
    includeBotMessages,
    setIncludeBotMessages,
    onlyMyChannels,
    setOnlyMyChannels,
    loadMoreRef,
    filteredLocalUsers,
    filteredLocalChannels,
    typeFilter,
    searchText: cleanedSearchText,
    // Clipboard tracking callbacks
    onPasteDetected,
    onManualKeystroke,
  } = useSearchMetrics({
    allChannels,
    mentionSearchType,
    // Default "my channels" ON everywhere (restrict to the user's channels by default).
    defaultOnlyMyChannels: true,
  });

  // Aliases to match old usage if needed or just use new names
  const search = cleanedSearchText;
  const setSearch = setSearchText;

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const isFlatAllView = activeTab === TabType.ALL && !isGrouped;

  // type:channels shows grouped local channels (same as CHANNELS tab) — used by the
  // no-search channel browse further down.
  const types = parseTypeFilter(typeFilter);
  const isChannelsType = types.includes(SearchableTypes.CHANNELS);

  // Category tabs the active filters can narrow to (null = no constraint). Drives which local
  // quick-switch sections stay relevant — no tab ever moves. `searchText` is raw (with tokens).
  const relevantTabs = useMemo(
    () => getRelevantTabs(selectedMentions, searchText),
    [selectedMentions, searchText],
  );

  // Show the local People / Channels+DMs sections only when the filters can target that category.
  // No filter (null) shows both; from:/assignee:/priority:/date/with:/@/# scope to content and hide them.
  const showGroupedUsers = !relevantTabs || relevantTabs.has(TabType.USERS);
  const showGroupedLocalResults = !relevantTabs || relevantTabs.has(TabType.CHANNELS);

  // Check if user has selected from:/with: or in: mention filters (for reordering results)
  // Only count in: mentions that are CHANNEL type (not USER type from in: combined list)
  const hasFromOrInFilter = selectedMentions.some(
    m =>
      m.prefix === 'from:' ||
      m.prefix === 'with:' ||
      (m.prefix === 'in:' && m.type === MentionType.CHANNEL),
  );

  // Only show merge option when a desk channel is explicitly scoped via in:<channel>
  const hasDeskChannelFilter = selectedMentions.some(
    m => m.prefix === 'in:' && m.type === MentionType.CHANNEL,
  );

  // Shared Cmd+K user rank for the plain-search USERS section. Hoisted so the
  // strong-match check below and the rendered section use the exact same order.
  // Uses rankUsersWithMfu (not plain rankUsers) because filteredLocalUsers is the
  // 25-capped `useUserSearch` window: a frequently-used person who matches the query
  // but ranks past the cap would be sliced out before ranking. rankUsersWithMfu
  // recovers those query-matching weighted users from the full `allUsers` list.
  // Re-render once when affinity weights finish loading so the empty People-tab ranking re-reads
  // them (rankUsersWithMfu reads getUserWeight imperatively; same fix as GlobalCommandMenu browse).
  const affinityVersion = useAffinityCallback();
  const rankedLocalUsers = useMemo(() => {
    void affinityVersion;
    return rankUsersWithMfu(filteredLocalUsers, allUsers, cleanedSearchText, dmContactRecency);
  }, [filteredLocalUsers, allUsers, cleanedSearchText, dmContactRecency, affinityVersion]);

  // Slack-style strong user match: when the top-ranked user's full name
  // prefix-matches the query, the USERS section renders ABOVE the "Show
  // results for" row and the default Enter target becomes that top user.
  // Only applies to plain search (no from:/in:/with: chips, USERS section
  // shown and non-empty) — filter-chip ordering otherwise wins.
  //
  // The full-name-prefix test is intentionally the SAME rule `rankUsers` uses
  // for its top tier (key 1, `name.startsWith(q)`); gating on rankUsers'
  // own top-tier signal keeps ranking and the Enter target from drifting
  // apart. A user surfaced to #0 only by DM recency (keys 3–4, no name match)
  // therefore does NOT steal the default Enter target — Enter targets the user
  // only when the query is clearly naming them.
  const hasStrongUserMatch = useMemo(() => {
    if (hasFromOrInFilter || !showGroupedUsers) return false;
    const topUser = rankedLocalUsers[0];
    if (!topUser) return false;
    const q = cleanedSearchText.toLowerCase().trim();
    if (!q) return false;
    return topUser.name.toLowerCase().startsWith(q);
  }, [hasFromOrInFilter, showGroupedUsers, rankedLocalUsers, cleanedSearchText]);

  // Which trigger opened the channel typeahead: '#' acts like Slack's quick
  // switcher (navigate on select, show only regular channels); 'in:' creates a
  // filter chip and includes DMs/Group DMs.
  const [channelTrigger, setChannelTrigger] = useState<ChannelTriggerType | null>(null);

  const [userTrigger, setUserTrigger] = useState<UserTriggerType | null>(null);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  // Render-driving mirror of hasNavigatedRef: true once the user engages a specific row this
  // session (ArrowUp/Down or hover). Drives the two-tier highlight (gray resting -> blue active)
  // and whether the action-word ghost (Select/Open/Search) shows. Reset on query/chip change.
  const [hasNavigated, setHasNavigated] = useState(false);
  const markNavigated = useCallback(() => setHasNavigated(true), []);
  // Hovering a mention candidate is engagement too — highlight it (index) and mark navigated so
  // it renders in the active (blue) tier with its Select/Open ghost. (Programmatic resets to 0
  // stay on the raw setter so they don't count as navigation.)
  const selectMention = useCallback(
    (index: number) => {
      setSelectedMentionIndex(index);
      markNavigated();
    },
    [markNavigated],
  );

  const insertMentionRef = useRef<
    ((item: { id: string; name: string; email?: string; type?: MentionType }) => void) | null
  >(null);

  const insertTextRef = useRef<((text: string) => void) | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchFiltersOpen, setSearchFiltersOpen] = useState(false);

  // Type autocomplete - derived from searchText
  const typeAutocomplete = useMemo(() => {
    const match = searchText.match(TYPE_AUTOCOMPLETE_REGEX);
    if (!match || match[1] === undefined) {
      return { suffix: '', suggestion: null, match: null };
    }
    const query = match[1].split(',').pop() || '';
    if (query.length === 0) {
      return { suffix: '', suggestion: null, match: null };
    }
    const suggestion = TYPE_SUGGESTIONS.find(
      t =>
        t.name.toLowerCase().startsWith(query.toLowerCase()) &&
        t.name.toLowerCase() !== query.toLowerCase(),
    );
    return {
      suffix: suggestion ? suggestion.name.slice(query.length) : '',
      suggestion,
      match,
    };
  }, [searchText]);
  // Highlighted-row state, synced from the DOM (aria-selected) by syncEnterIntent:
  // enterWillOpen = Enter opens the row vs. runs a search; activeItemLabel = its name.
  const [enterWillOpen, setEnterWillOpen] = useState(false);
  const [activeItemLabel, setActiveItemLabel] = useState<string | null>(null);
  // Whether the highlighted row is a user/channel — the only rows ⌥↵ can act on. Gates the footer
  // Actions hint so it isn't shown (misleadingly) on messages/tickets/etc. where ⌥↵ does nothing.
  const [activeItemActionable, setActiveItemActionable] = useState(false);

  // Slash-command mode (`/call`, `/chat`, `/askai`). All command state + logic lives in the hook;
  // the parent feeds it the shared cmdk selection (activeItemLabel/hasNavigated) and wires its
  // outputs into the ghost text, mention guards, keyboard handler, and the palette render below.
  // Metrics: a command was applied or a target picked. Reads the gesture primed
  // by the mouse/keyboard handlers, and marks `slashInvokedRef` for terminal
  // clicks so the session-end reason is 'invoke'. Must run synchronously with the
  // priming gesture — the dispatch handlers call `onCommandClick` inline, so the
  // ref still holds the gesture that triggered this click; a deferred emit would
  // read a stale/reset value.
  const handleSlashCommandClick = useCallback(
    (info: SlashCommandClickInfo): void => {
      const selectionType = lastSlashSelectionRef.current;
      lastSlashSelectionRef.current = 'unknown';
      // The ⌥↵ Actions menu dispatches a command WITHOUT first typing `/`, so the commandActive
      // effect hasn't opened a slash session yet (⌥↵ Call never enters command mode at all) and
      // onClick would be dropped for want of a session id. Demand-start one here (mirroring the
      // effect's start branch) so the click — and its `source` — is logged; the effect won't
      // double-start because slashSessionActiveRef is now set.
      if (!slashSessionActiveRef.current) {
        slashSessionActiveRef.current = true;
        slashInvokedRef.current = false;
        lastSlashImpressionKeyRef.current = '';
        slashMetrics.onSessionStart();
      }
      if (info.terminal) slashInvokedRef.current = true;
      slashMetrics.onClick({
        stage: info.stage,
        command: info.command,
        selectionType,
        terminal: info.terminal,
        ...(info.targetType && { targetType: info.targetType }),
        ...(info.destination && { destination: info.destination }),
        ...(info.source && { source: info.source }),
      });
    },
    [slashMetrics],
  );

  const slash = useSlashCommands({
    open,
    onOpenChange,
    currentUserID,
    activeItemLabel,
    hasNavigated,
    resetSearchState,
    navigate: path => void navigate(path),
    onCommandClick: handleSlashCommandClick,
    dmContactRecency,
  });
  // The parent owns the input box, ghost, keydown handler, mention guards and the compose/confirm
  // overlays, so it reads these fields directly. Everything the palette needs is handed to it as the
  // whole `slash` controller (below) — so adding a command never adds another prop here.
  const {
    commandActive,
    commandText,
    commandTarget,
    isComposing,
    pendingChannelCall,
    recordingConflict,
    setRecordingConflict,
    commandGhost,
    setActiveCommandWord,
    setPendingChannelCall,
    clearTarget,
    applyCommand,
    startChannelCall,
    isInCommandMode,
    onSetTextReady,
    handleEditorText,
  } = slash;

  // ⌥↵ Actions menu: the highlighted user/channel result to act on (Message / Call). Null = closed.
  const [actionsMenuTarget, setActionsMenuTarget] = useState<CommandTarget | null>(null);

  // ── Slash-command funnel: session start / end ────────────────────────────
  // A session spans one entry into command mode (`/`) until a command executes
  // or the box leaves command mode. `commandActive` covers discovery, picker,
  // compose and call-confirm; pairing it with `open` ends the session when the
  // box closes. Declared before the impression effect so the session id exists
  // when the first impression fires.
  useEffect(() => {
    const inCommandMode = commandActive && open;
    if (inCommandMode && !slashSessionActiveRef.current) {
      slashSessionActiveRef.current = true;
      slashInvokedRef.current = false;
      lastSlashImpressionKeyRef.current = '';
      slashMetrics.onSessionStart();
    } else if (!inCommandMode && slashSessionActiveRef.current) {
      slashSessionActiveRef.current = false;
      const reason = slashInvokedRef.current ? 'invoke' : !open ? 'abandon' : 'clear';
      slashMetrics.onSessionEnd(reason);
      slashInvokedRef.current = false;
    }
  }, [commandActive, open, slashMetrics]);

  // ── Slash-command funnel: impressions ────────────────────────────────────
  // Fire once per distinct options view — the `/` discovery list, then each
  // command's picker — deduped by a stage+command key so keystrokes within the
  // same view don't re-log.
  useEffect(() => {
    // `isComposing` means a target is picked and the composer is on screen — there's no options
    // view to impress, so bail. This drops the phantom picker impression on the ⌥↵ Message path
    // (which seeds `/chat ` then jumps straight to compose) and, in the normal `/chat` flow, stops
    // re-logging the picker once a recipient is chosen. Clearing the key lets the picker re-log if
    // the user goes back to it.
    if (!(commandActive && open && commandText.startsWith('/')) || isComposing) {
      lastSlashImpressionKeyRef.current = '';
      return;
    }
    const kind = slash.commandKind;
    const def = kind ? getCommand(kind) : null;
    // A bare/partial `/` prefix shows the discovery list; any *resolved* command
    // (`kind` set) shows its own view — a picker (`/chat`/`/call`), the `/goto`
    // sections, or a single run row for an action (`/askai`/`/record`).
    const stage: 'discovery' | 'picker' = kind ? 'picker' : 'discovery';
    const command = kind;

    // Count the rows the palette actually renders for the current view.
    let optionsCount: number;
    if (!def) {
      // Discovery: the palette filters the command list by the raw typed prefix.
      optionsCount = COMMAND_KINDS.filter(k =>
        k.startsWith(commandText.slice(1).toLowerCase()),
      ).length;
    } else if (def.type === 'action') {
      optionsCount = 1; // a single run row (`/askai`, `/record`)
    } else if (def.type === 'goto') {
      optionsCount = slash.commandNavResults.length + slash.commandGotoExtras.length;
    } else {
      optionsCount =
        slash.commandUserResults.length +
        slash.commandChannelResults.length +
        slash.commandGroupDmResults.length;
    }

    // The typed text driving the view — the partial command word for discovery
    // (`/ch`), or just the command token for a resolved command (`/chat`). Never
    // the picker's recipient/query arg (PII), so drop everything after the first
    // token for discovery and use `/<command>` once one is resolved.
    const typedText = command ? `/${command}` : (commandText.split(/\s/)[0] ?? commandText);

    // Emit when the rendered view changes (stage + command + count + typed text),
    // so each intermediate text re-emits — `/ch`, `/cha`, `/c`, `/` all get their
    // own line, and backspacing re-logs them. Only a consecutive identical render
    // (e.g. picker results settling) is skipped. Re-visited views re-log — dedupe
    // per session in the query if a dashboard needs unique-per-session counts.
    const key = `${stage}:${command ?? ''}:${optionsCount}:${typedText}`;
    if (key === lastSlashImpressionKeyRef.current) return;

    // Debounce ~300ms so rapid typing (`/`→`/c`→`/ch`→`/chat`) collapses to the
    // view the user actually pauses on — one impression per settled view, not a
    // log line per keystroke. A change before the timer fires cancels it via the
    // cleanup and restarts the countdown toward the new view; leaving command
    // mode also cancels it (guard above returns without scheduling).
    const timer = setTimeout(() => {
      lastSlashImpressionKeyRef.current = key;
      slashMetrics.onImpression(stage, command, optionsCount, typedText);
    }, 300);
    return () => clearTimeout(timer);
  }, [
    commandActive,
    open,
    commandText,
    slash.commandKind,
    slash.commandNavResults,
    slash.commandGotoExtras,
    slash.commandUserResults,
    slash.commandChannelResults,
    slash.commandGroupDmResults,
    slashMetrics,
    isComposing,
  ]);

  // Once the seeded `/` actually lands (command mode is genuinely active), drop the seed flag so
  // normal search resumes if the user later clears the slash.
  useEffect(() => {
    if (seedCommandMode && commandText.startsWith('/')) {
      setSeedCommandMode(false);
    }
  }, [seedCommandMode, commandText]);

  const syncEnterIntent = useCallback((): void => {
    const container = commandRef.current;
    // The auto-select timer below can fire after the Command unmounts (Escape mid-timer), leaving a
    // null container — bail before the querySelector.
    if (!container) return;
    const active = container.querySelector('[cmdk-item][aria-selected="true"]');
    const willOpen = !!active && active.getAttribute('data-show-results-item') !== 'true';
    setEnterWillOpen(willOpen);
    setActiveItemLabel(willOpen ? (active?.getAttribute('data-item-label') ?? null) : null);
    // At rest (nothing selected yet) fall back to the first enabled row — the row ⌥↵ acts on
    // (matching resolveActionTarget) — so the hint is right before any arrow/hover.
    const actionRow = active ?? container.querySelector('[cmdk-item]:not([aria-disabled="true"])');
    const resultType = actionRow?.getAttribute('data-result-type');
    setActiveItemActionable(resultType === 'user' || resultType === 'channel');
  }, []);

  // Callback ref for the <Command> root. Recompute the ⌥↵ hint when rows actually land instead of
  // guessing with a setTimeout: sync once on mount (browse rows are already children), then observe
  // the results list for late/streamed rows. Null on unmount/branch swap → disconnect.
  const attachCommandRef = useCallback(
    (node: HTMLDivElement | null): void => {
      commandRef.current = node;
      rowListObserverRef.current?.disconnect();
      rowListObserverRef.current = null;
      if (!node) return;
      syncEnterIntent();
      // Observe the results list, not the <Command> root: the footer hint syncEnterIntent toggles
      // sits outside [cmdk-list], so scoping here avoids re-firing on our own hint writes.
      const listEl = node.querySelector('[cmdk-list]') ?? node;
      const observer = new MutationObserver((): void => syncEnterIntent());
      observer.observe(listEl, { childList: true, subtree: true });
      rowListObserverRef.current = observer;
    },
    [syncEnterIntent],
  );

  // Ghost suffix telling the user what Enter does - shown when there's typed text or a filter
  // chip and no mention typeahead is open. getScreenSearchSuffix() picks the text.
  const screenSearchActive =
    !mentionSearchType && (Boolean(searchText.trim()) || selectedMentions.length > 0);
  const getScreenSearchSuffix = (): string => {
    // At rest (before arrowing/hovering onto a row): "- Search" - Enter searches everything,
    // not the arbitrary first row previewed as if chosen.
    if (!hasNavigated) return '\u00a0\u2013 Search';
    // Navigated: preview the highlighted row - " - Search" for the search row, else the row
    // name's completion + " - Open".
    if (!enterWillOpen) return '\u00a0\u2013 Search';
    // Match the RAW typed text so the completion lines up after it (the ghost sits
    // right after the input); bare " - Open" when it can't (empty text left of a chip, or a
    // filter prefix, where startsWith("") would otherwise splice the whole row name).
    if (
      searchText.trim() &&
      activeItemLabel &&
      activeItemLabel.toLowerCase().startsWith(searchText.toLowerCase())
    ) {
      // nbsp: a leading space in the remainder would collapse in the ghost span.
      const completion = activeItemLabel.slice(searchText.length).replace(/^ /, '\u00a0');
      return `${completion}\u00a0\u2013 Open`;
    }
    return '\u00a0\u2013 Open';
  };
  // Format hint for a no-popup text filter whose value is still empty (e.g. "before:"
  // -> "YYYY-MM-DD"). No leading space (matches the mention preview / raw filter text).
  const textFilterHint = useMemo(() => {
    const match = searchText.match(TEXT_FILTER_HINT_REGEX);
    const keyword = match?.[1]?.toLowerCase();
    const hint = keyword ? TEXT_FILTER_HINTS[keyword] : undefined;
    return hint ?? '';
  }, [searchText]);

  // `popupFilterHint` and the final `autocompleteSuffix` are assembled lower down, after the
  // mention-candidate arrays (availableUsers / availableChannels / availablePriorities) they
  // read to inline-complete the highlighted row's name.

  // Empty-query browse: replace the placeholder with "<name> - Open" for the hovered/arrowed
  // row. Active in every cmd+K mode now (activeItemLabel is only set for a real openable row).
  const openTargetLabel = !searchText.trim() ? activeItemLabel : null;

  // Build URLSearchParams for navigating to the search results screen,
  // including human-readable display text resolved from mention IDs.
  function buildSearchParams(
    text: string,
    mentions: typeof selectedMentions,
    byId: typeof usersById,
    channels: typeof allChannels,
    tab?: SearchResultsDocType,
  ): URLSearchParams {
    const params = new URLSearchParams();
    if (text.trim()) params.set('query', text.trim());
    if (tab) params.set('tab', tab);

    // Carry the cmd+K toggles so the full-screen page issues the identical Vespa request
    // (same filtered results) and can reuse the popup's cached search.
    params.set('onlyMyChannels', String(onlyMyChannels));
    params.set('includeBotMessages', String(includeBotMessages));

    const fromMentions = mentions.filter(m => m.type === MentionType.USER && m.prefix === 'from:');
    const fromEmails = fromMentions.filter(m => m.id.includes('@')).map(m => m.id);
    const fromIds = fromMentions.filter(m => !m.id.includes('@')).map(m => m.id);
    if (fromIds.length > 0) params.set('from', fromIds.join(','));
    if (fromEmails.length > 0) params.set('fromEmail', fromEmails.join(','));

    const toEmails = mentions
      .filter(m => m.type === MentionType.USER && m.prefix === 'to:')
      .map(m => m.id);
    if (toEmails.length > 0) params.set('toEmail', toEmails.join(','));

    const inMentions = mentions.filter(m => m.type === MentionType.CHANNEL && m.prefix === 'in:');
    const inIds = inMentions.map(m => m.id);
    if (inIds.length > 0) params.set('in', inIds.join(','));

    // Bare @user / #channel chips (no prefix) are mention filters, not from/in.
    const mentionUserIds = mentions
      .filter(m => m.type === MentionType.USER && !m.prefix)
      .map(m => m.id);
    if (mentionUserIds.length > 0) params.set('mentions', mentionUserIds.join(','));

    const mentionChannelIds = mentions
      .filter(m => m.type === MentionType.CHANNEL && !m.prefix)
      .map(m => m.id);
    if (mentionChannelIds.length > 0) params.set('channelMentions', mentionChannelIds.join(','));

    const assigneeMentions = mentions.filter(
      m => m.type === MentionType.USER && m.prefix === 'assignee:',
    );
    const assigneeIds = assigneeMentions.map(m => m.id);
    if (assigneeIds.length > 0) params.set('assignee', assigneeIds.join(','));

    const withMentions = mentions.filter(m => m.type === MentionType.USER && m.prefix === 'with:');
    const withIds = withMentions.map(m => m.id);
    if (withIds.length > 0) params.set('with', withIds.join(','));

    // Priority's value reaches the results screen only via this param (the chip text is
    // stripped from `query`). `id` is the canonical uppercase enum.
    const priorityMention = mentions.find(m => m.type === MentionType.PRIORITY);
    if (priorityMention) params.set('priority', priorityMention.id);

    // Build human-readable display string for the global search bar
    const displayParts: string[] = [];
    if (fromMentions.length > 0) {
      const names = fromMentions
        .map(m => {
          const user = byId.get(m.id);
          return user ? `@${getUserDisplayName(user)}` : '';
        })
        .filter(Boolean);
      if (names.length > 0) displayParts.push(`from:${names.join(' ')}`);
    }
    if (inMentions.length > 0) {
      const names = inMentions
        .map(m => {
          const ch = channels.find(c => c.channel.id === m.id);
          if (!ch) return '';
          return formatChannelLabel(ch);
        })
        .filter(Boolean);
      if (names.length > 0) displayParts.push(`in:${names.join(' ')}`);
    }
    if (assigneeMentions.length > 0) {
      const names = assigneeMentions
        .map(m => {
          const user = byId.get(m.id);
          return user ? `@${getUserDisplayName(user)}` : '';
        })
        .filter(Boolean);
      if (names.length > 0) displayParts.push(`assignee:${names.join(' ')}`);
    }
    if (priorityMention) {
      // Display string lowercase for consistency; the functional param above stays uppercase.
      displayParts.push(`priority:${priorityMention.id.toLowerCase()}`);
    }
    // Free text before the bare @user/#channel mentions, matching how they're typed
    // ("test @user"), so the label isn't reordered to "@user test".
    if (text.trim()) displayParts.push(text.trim());
    if (mentionUserIds.length > 0) {
      const names = mentionUserIds
        .map(id => {
          const user = byId.get(id);
          return user ? `@${getUserDisplayName(user)}` : '';
        })
        .filter(Boolean);
      if (names.length > 0) displayParts.push(names.join(' '));
    }
    if (mentionChannelIds.length > 0) {
      const names = mentionChannelIds
        .map(id => {
          const ch = channels.find(c => c.channel.id === id);
          return ch ? `#${ch.channel.name}` : '';
        })
        .filter(Boolean);
      if (names.length > 0) displayParts.push(names.join(' '));
    }
    if (displayParts.length > 0) params.set('display', displayParts.join(' '));

    return params;
  }

  // Keep the palette's history entry carrying the current search. The palette can be left
  // in many ways — opening a DM, a channel, a message, a ticket, the results page — and
  // each goes through its own handler, so recording it here is what makes ANY of them
  // restorable when the user comes back.
  useEffect(() => {
    if (!open) return;
    setPayload({
      text: searchText,
      // The cast is the hook's looser `prefix: string` meeting the editor's prefix union —
      // same values at runtime, they're only ever set from that union.
      mentions: selectedMentions.map(m => ({ ...m, name: m.name ?? m.id })) as MentionData[],
    });
  }, [open, searchText, selectedMentions, setPayload]);

  // Leave the palette for the full-screen results page via the "Show results for" row.
  // Logged as its own event so the jump-out rate is readable per palette and trigger.
  const goToSearchResults = (trigger: 'click' | 'keyboard'): void => {
    // The row fires both onClick and cmdk's onSelect for one activation — first one wins.
    if (navigatingToResultsRef.current) return;
    navigatingToResultsRef.current = true;
    showResultsTriggerRef.current = 'keyboard';

    // Mark the close as a navigation so the palette's entry isn't popped out from under
    // us. The search itself is already on that entry, kept current by the effect above.
    markNavigating();

    // Metrics must never be able to swallow the navigation.
    try {
      if (searchSessionId && currentUserID) {
        searchMetricsService.trackShowResults({
          searchSessionId,
          userId: currentUserID,
          queryText: searchText.trim(),
          tab: activeTab,
          trigger,
          searchMode,
          filtersUsed: selectedMentions.length,
        });
      }
    } catch {
      // Swallowed on purpose — a broken log line must not block the results page.
    }

    onOpenChange(false);
    // Land on the tab the user was already filtering by — Messages stays on Messages,
    // Files on Files, and so on. Tabs with no results-page docType (and plain All) fall
    // through to undefined, which leaves the page on its own default.
    const docType = TAB_TO_DOC_TYPE[activeTab as keyof typeof TAB_TO_DOC_TYPE];
    void navigate(
      `/search-results?${buildSearchParams(searchText, selectedMentions, usersById, allChannels, docType).toString()}`,
    );
  };

  // Navigate to the full results page with a specific section's tab pre-selected
  // (from the screen-mode "See N more" links).
  const handleSeeMoreNavigate = (tab: SearchResultsDocType): void => {
    onOpenChange(false);
    void navigate(
      `/search-results?${buildSearchParams(searchText, selectedMentions, usersById, allChannels, tab).toString()}`,
    );
  };

  const acceptTypeAutocomplete = useCallback(() => {
    if (!typeAutocomplete.suggestion || !typeAutocomplete.match) return;
    if (insertTextRef.current && typeAutocomplete.suffix) {
      insertTextRef.current(typeAutocomplete.suffix);
    }
    const beforeType = searchText.slice(0, typeAutocomplete.match.index) || '';
    const newText = beforeType + 'type:' + typeAutocomplete.suggestion.name;
    setSearch(newText);
  }, [typeAutocomplete, searchText, setSearch]);

  // File preview modal state
  const [previewFile, setPreviewFile] = useState<{
    fileName: string;
    fileUrl: string;
    mimeType: string;
    fileSize: number;
  } | null>(null);
  const [previewTicket, setPreviewTicket] = useState<DisplaySearchResult | null>(null);
  const [hoveredResult, setHoveredResult] = useState<DisplaySearchResult | null>(null);
  const [keyboardSelectedResult, setKeyboardSelectedResult] = useState<DisplaySearchResult | null>(
    null,
  );

  // ── Ticket merge mode (only when opened via support screen search button) ─
  const [deskMergeMode, setDeskMergeMode] = useState(false);
  const [selectedMergeTickets, setSelectedMergeTickets] = useState<
    Map<string, DisplaySearchResult>
  >(new Map());
  const [showMergeDialog, setShowMergeDialog] = useState(false);

  // Extract ticketId from a desk email result for merge
  const getDeskTicketId = (result: DisplaySearchResult): string | null => {
    if (result.type === 'conversation' && result.searchContext?.subApp === 'DESK') {
      return result.searchContext?.ticketId || null;
    }
    return null;
  };

  const toggleDeskMergeMode = useCallback(() => {
    setDeskMergeMode(prev => {
      if (prev) setSelectedMergeTickets(new Map());
      return !prev;
    });
  }, []);

  const handleToggleDeskMergeSelect = useCallback((result: DisplaySearchResult) => {
    const ticketId = result.searchContext?.ticketId;
    if (!ticketId) return;
    setSelectedMergeTickets(prev => {
      const next = new Map(prev);
      if (next.has(ticketId)) {
        next.delete(ticketId);
      } else {
        next.set(ticketId, result);
      }
      return next;
    });
  }, []);

  const clearDeskMergeSelection = useCallback(() => {
    setSelectedMergeTickets(new Map());
  }, []);

  const DISPLAY_LIMIT = 5;

  // Suppress hover highlights when dialog first opens to prevent dual-highlight
  // (CSS :hover on one item + aria-selected on another) when mouse is already resting in the dialog area
  const [suppressHover, setSuppressHover] = useState(false);
  const hasNavigatedRef = useRef(false);

  // Platform detection - needs to be before useEffects that depend on it
  const { isMobile } = usePlatform();

  // Suppress hover on open to prevent dual-highlight when mouse is already in dialog area
  useEffect(() => {
    if (open) {
      setSuppressHover(true);
    }
  }, [open]);

  // Track previous search text to detect when cleared
  const prevSearchTextRef = useRef('');

  // Handle Lexical editor change - extract text and mentions
  const handleEditorChange = useCallback(
    (
      text: string,
      mentions: Array<{ id: string; type: MentionType; prefix?: string; name?: string }>,
    ) => {
      // Slash-command mode: the hook consumes `/`-prefixed text (keeping it OUT of the search
      // hook so Vespa never runs) and returns true; keep prevSearchTextRef in sync and bail.
      if (handleEditorText(text)) {
        // On the transition INTO command mode, drop any prior query + mentions so a pending
        // debounced Vespa search can't repopulate results and the old query doesn't resurface
        // when Cmd+K reopens (resetSearchState clears results/pagination but not the query text).
        if (!prevSearchTextRef.current.startsWith('/')) {
          setSearch('');
          setSelectedMentions([]);
        }
        prevSearchTextRef.current = text;
        return;
      }

      const trimmedText = text.trim();
      const prevTrimmedText = prevSearchTextRef.current.trim();

      // Start a new session when text is cleared (had content, now empty)
      // BUT don't trigger if mentions are present (indicates filter operator usage like from:/in:)
      if (prevTrimmedText && !trimmedText && mentions.length === 0) {
        onClose('clear');
        onOpen('keyboard_shortcut');
      }

      setSearch(text);
      setSearchText(text); // This will be used for search, mentions filtered separately
      setSelectedMentions(mentions);

      // Update refs for next comparison
      prevSearchTextRef.current = text;
    },
    [onClose, onOpen, handleEditorText],
  );

  // On a mention pick: quick-switch (navigate to the DM/channel) only when the box is truly
  // empty; otherwise it becomes a prefix-less mention-filter chip (mentions/channelMentions).
  const handleMentionSelect = useCallback(
    async (mention: { id: string; name: string; type: MentionType; email?: string }) => {
      // Quick-switch only for a "pure" bare mention: no chips AND nothing typed before the
      // trigger. "hi @vishal" has preceding text, so it becomes a mention filter instead.
      const triggerChar = mention.type === MentionType.CHANNEL ? '#' : '@';
      const triggerIndex = searchText.lastIndexOf(triggerChar);
      const hasTextBeforeMention =
        triggerIndex > 0 && searchText.slice(0, triggerIndex).trim().length > 0;
      const isQuickSwitch = selectedMentions.length === 0 && !hasTextBeforeMention;

      if (mention.type === MentionType.CHANNEL && channelTrigger === '#' && isQuickSwitch) {
        setMentionSearchType(null);
        setMentionSearchQuery('');
        setChannelTrigger(null);
        setSelectedMentionIndex(0);
        onOpenChange(false);
        void navigate(`/chat/dir/${mention.id}`);
        return;
      }

      // Navigate to the DM only in quick-switch; otherwise fall through to a mention chip.
      if (mention.type === MentionType.USER && userTrigger === '@' && isQuickSwitch) {
        setMentionSearchType(null);
        setMentionSearchQuery('');
        setUserTrigger(null);
        setSelectedMentionIndex(0);
        onOpenChange(false);

        // Use the same navigation logic as clicking a user in default view
        const result: DisplaySearchResult = {
          id: mention.id,
          type: 'user',
          title: mention.name,
          subtitle: mention.email || '',
          relevanceScore: 1,
          metadata: {},
        };
        await navigateToUser(result, navigate, channelData || []);
        return;
      }

      if (insertMentionRef.current) {
        insertMentionRef.current({
          id: mention.id,
          name: mention.name,
          type: mention.type,
          ...(mention.email ? { email: mention.email } : {}),
        });

        // Clear mention search state after a delay to allow insertion to complete
        setTimeout(() => {
          setMentionSearchType(null);
          setMentionSearchQuery('');
          setChannelTrigger(null);
          setUserTrigger(null);
          setSelectedMentionIndex(0);
        }, 100);
      }
    },
    [channelTrigger, userTrigger, onOpenChange, navigate, selectedMentions, searchText],
  );

  // Store the insertMention function when it's ready
  const handleInsertMentionReady = useCallback(
    (
      insertMention: (item: {
        id: string;
        name: string;
        email?: string;
        type?: MentionType;
      }) => void,
    ) => {
      insertMentionRef.current = insertMention;
    },
    [],
  );

  // Handle user search from mention plugin
  const handleUserSearch = useCallback(
    (query: string | null, trigger?: '@' | 'from:' | 'to:' | 'with:' | 'assignee:' | 'in:@') => {
      // In `/call`/`/chat` mode, `@` is a literal character in the message — never
      // open the user mention picker.
      if (isInCommandMode()) return;
      if (query === null) {
        // Mention search was cancelled/cleared
        setMentionSearchType(null);
        setMentionSearchQuery('');
        setUserTrigger(null);
        setSelectedMentionIndex(0);
        return;
      }
      setMentionSearchQuery(query);
      setMentionSearchType(MentionType.USER);
      setUserTrigger(trigger ?? 'from:');
      setSelectedMentionIndex(0); // Reset selection when search changes
    },
    [isInCommandMode],
  );

  // Handle channel search from mention plugin
  const handleChannelSearch = useCallback(
    (query: string | null, trigger?: '#' | 'in:' | 'in:#' | 'in:@') => {
      // In `/call`/`/chat` mode, `#` is a literal character in the message — never
      // open the channel mention picker.
      if (isInCommandMode()) return;
      if (query === null) {
        // Mention search was cancelled/cleared
        setMentionSearchType(null);
        setMentionSearchQuery('');
        setChannelTrigger(null);
        setSelectedMentionIndex(0);
        return;
      }
      setMentionSearchQuery(query);
      // When trigger is 'in:@', we want to show DMs (not users!)
      // When trigger is 'in:#', we want to show only channels
      // When trigger is 'in:', we want to show both channels and DMs
      // When trigger is '#', we want to show only channels (quick switcher)
      if (trigger === 'in:@') {
        // 'in:@' shows DMs only (not users!)
        setMentionSearchType(MentionType.CHANNEL);
        setChannelTrigger('in:@');
      } else if (trigger === 'in:#') {
        // Show only channels (like '#' trigger but with 'in:' prefix)
        setMentionSearchType(MentionType.CHANNEL);
        setChannelTrigger('in:#');
      } else if (trigger === '#') {
        // '#' trigger - show only channels (Slack-style quick switcher)
        setMentionSearchType(MentionType.CHANNEL);
        setChannelTrigger('#');
      } else {
        // Plain 'in:' - show both channels and DMs
        setMentionSearchType(MentionType.CHANNEL);
        setChannelTrigger('in:');
      }
      setSelectedMentionIndex(0); // Reset selection when search changes
    },
    [isInCommandMode],
  );

  // Handle priority search from mention plugin. Priority is a closed enum, so
  // there is no backend lookup — we just track the typed query to filter the
  // static value list (availablePriorities).
  const handlePrioritySearch = useCallback(
    (query: string | null) => {
      // In `/call`/`/chat` mode, `priority:` is literal message text.
      if (isInCommandMode()) return;
      if (query === null) {
        setMentionSearchType(null);
        setMentionSearchQuery('');
        setSelectedMentionIndex(0);
        return;
      }
      setMentionSearchQuery(query);
      setMentionSearchType(MentionType.PRIORITY);
      setSelectedMentionIndex(0);
    },
    [isInCommandMode],
  );

  // `from:` typeahead user candidates. Uses the same data source and rank as
  // plain user search (useUserSearch + rankUsers) so a query like "abhi"
  // returns the same Abhisheks in the same order regardless of how the user
  // typed it. ChatInput `@` mentions still go through useMentionSearch
  // because they need chat-context signals (channel participants, recency).

  // When using 'in:' (plain), we want to show both channels AND users
  // So we need to also fetch users for that case
  // But NOT for 'in:#' which should only show channels
  const mentionUsersQuery =
    mentionSearchType === MentionType.USER || channelTrigger === 'in:' ? mentionSearchQuery : '';
  const mentionUsers = useUserSearch(mentionUsersQuery, CMDK_USER_LIMIT);

  const deskChannelId = useMemo(() => {
    const inMention = selectedMentions.find(
      m => m.type === MentionType.CHANNEL && m.prefix === 'in:',
    );
    if (!inMention) return undefined;
    const match = allChannels.find(c => c.channel.id === inMention.id);
    return match && isDeskChannelType(match.channel.type) ? inMention.id : undefined;
  }, [selectedMentions, allChannels]);
  const isDeskContext = !!deskChannelId || activeTab === TabType.DESK;
  const deskContacts = useDeskContacts(deskChannelId);
  const deskPeopleId = deskChannelId ?? (activeTab === TabType.DESK ? ALL_DESK : undefined);
  const deskPeople = useDeskPeople(deskPeopleId);
  const isDeskPeopleTrigger = isDeskContext && (userTrigger === 'from:' || userTrigger === 'to:');

  // Available users - populated when:
  // 1. mentionSearchType is USER (direct user search like @, from:, assignee:, in:@)
  // 2. channelTrigger is 'in:' (combined search - show both channels and users)
  // In a Desk channel, `from:`/`to:` instead surface synced mailbox contacts
  // (id = email) so the chip carries an address for the mail from/to filter.
  const availableUsers = useMemo<
    Array<{ id: string; name: string; status?: string; email?: string }>
  >(() => {
    if (isDeskPeopleTrigger) {
      const raw = mentionSearchQuery.trim();
      const q = raw.toLowerCase();
      const deskPool = userTrigger === 'to:' ? deskPeople.recipients : deskPeople.senders;
      const byEmail = new Map<string, { email: string; name: string | null }>();
      for (const p of deskPool) {
        const e = p.email.toLowerCase();
        if (!byEmail.has(e)) byEmail.set(e, { email: p.email, name: p.name });
      }
      for (const c of deskContacts) {
        const e = c.email.toLowerCase();
        const existing = byEmail.get(e);
        if (!existing) byEmail.set(e, { email: c.email, name: c.name });
        else if (!existing.name && c.name) existing.name = c.name;
      }
      const pool = Array.from(byEmail.values());
      const matches = q
        ? pool.filter(
            p => p.email.toLowerCase().includes(q) || (p.name?.toLowerCase().includes(q) ?? false),
          )
        : pool;
      const items = matches.slice(0, CMDK_USER_LIMIT).map(p => ({
        id: p.email,
        name: p.name || p.email,
        email: p.email,
      }));
      const looksLikeEmail = /\S+@\S+\.\S+/.test(raw);
      const exactMatch = items.some(i => i.email.toLowerCase() === q);
      if (looksLikeEmail && !exactMatch) {
        items.unshift({ id: raw, name: raw, email: raw });
      }
      return items;
    }

    if (userTrigger === 'to:') return [];
    if (mentionSearchType !== MentionType.USER && channelTrigger !== 'in:') return [];
    // `useUserSearch` slices to CMDK_USER_LIMIT *before* ranking, so a frequently-used
    // person can be dropped from `mentionUsers` entirely. `rankUsersWithMfu` recovers
    // MFU-weighted matches from the full `allUsers` list so they can float back up.
    return rankUsersWithMfu(mentionUsers, allUsers, mentionSearchQuery, dmContactRecency).map(
      user => ({
        id: user.id,
        name: user.name,
        status: user.status,
        ...(user.email && { email: user.email }),
      }),
    );
  }, [
    isDeskPeopleTrigger,
    userTrigger,
    deskContacts,
    deskPeople,
    mentionUsers,
    allUsers,
    mentionSearchQuery,
    mentionSearchType,
    channelTrigger,
    dmContactRecency,
  ]);

  // Filter mention results for channels.
  // Mirrors the plain-search regular/DM split in useSearchMetrics so `in:` typeahead
  // matches the same channels the rest of the app does (fuzzy + hyphen-strip via
  // searchChannels). DM/Group DM matching is unchanged: comma-split AND-semantics
  // against participant searchableNames.

  // Regular channels (excludes DMs) - used for `in:` and `in:#` triggers
  // When DESK tab is active, show only email channels; otherwise exclude them.
  const availableRegularChannels = useMemo(() => {
    if (mentionSearchType !== MentionType.CHANNEL) return [];

    // Filter to only regular channels (no DMs), then scope by active tab
    const regularChannels = allChannels.filter(({ channel }) => {
      if (isDMChannel(channel.scopeType)) return false;
      if (activeTab === TabType.DESK) return isDeskChannelType(channel.type);
      return true;
    });

    // Apply search filtering
    const filtered = filterChannelsBySearchableNames(regularChannels, mentionSearchQuery, {
      excludeDMs: false, // Already filtered above
    });

    // Apply stricter filtering when there's a query
    const query = mentionSearchQuery.toLowerCase().trim();
    if (query) {
      const queryParts = query.split(/[,\s]+/).filter(Boolean);
      const strictlyFiltered = filtered.filter(({ channel }) => {
        const nameLower = channel.name.toLowerCase();
        return queryParts.every(part => nameLower.includes(part));
      });
      return strictlyFiltered.map(({ channel }) => ({ channel, displayName: channel.name }));
    }

    return filtered.map(({ channel }) => ({ channel, displayName: channel.name }));
  }, [allChannels, mentionSearchQuery, mentionSearchType, activeTab]);

  // Helper to get display name for a DM channel - includes self-DMs (notes to yourself)
  const getDMDisplayNameWithSelf = useCallback(
    (channel: Channel, searchableNames?: string[]): string => {
      if (!isDMChannel(channel.scopeType)) return channel.name;

      // For DMs, use participant names if available
      if (searchableNames && searchableNames.length > 0) {
        return searchableNames.join(', ');
      }

      // Fallback: try to get names from usersById
      const otherUserIds = getDMParticipantIdsToFetch(channel, currentUserID);

      // Check if this is a self-DM (only current user)
      const allParticipants = parseDMParticipantIds(channel);
      const isSelfDM = allParticipants.length === 1 && allParticipants[0] === currentUserID;

      if (isSelfDM) {
        // For self-DMs, show "You" or the user's own name
        const currentUser = usersById.get(currentUserID);
        const currentUserName = currentUser
          ? currentUser.displayName || currentUser.name
          : undefined;
        return currentUserName ? `${currentUserName} (You)` : 'You';
      }

      // Regular DM with others
      const otherNames = otherUserIds
        .map(id => {
          const u = usersById.get(id);
          return u ? u.displayName || u.name : undefined;
        })
        .filter((n): n is string => !!n);

      return otherNames.length > 0 ? otherNames.join(', ') : 'Group Chat';
    },
    [usersById, currentUserID],
  );

  // DMs and Group DMs - used for `in:` trigger (includes self-DMs / notes to yourself)
  // Hidden when DESK tab is active — only email channels are relevant there.
  const availableDMs = useMemo(() => {
    if (mentionSearchType !== MentionType.CHANNEL) return [];
    if (activeTab === TabType.DESK) return [];

    // Filter to only DM channels
    const dmChannels = allChannels.filter(({ channel }) => isDMChannel(channel.scopeType));

    // Apply search filtering
    const filtered = filterChannelsBySearchableNames(dmChannels, mentionSearchQuery, {
      excludeDMs: false,
    });

    // Apply stricter filtering when there's a query
    const query = mentionSearchQuery.toLowerCase().trim();
    if (query) {
      const queryParts = query.split(/[,\s]+/).filter(Boolean);
      const strictlyFiltered = filtered.filter(({ channel, searchableNames }) => {
        // Check if this is a self-DM
        const allParticipants = parseDMParticipantIds(channel);
        const isSelfDM = allParticipants.length === 1 && allParticipants[0] === currentUserID;

        if (isSelfDM) {
          // For self-DMs, check if query matches current user's name or "you"
          const currentUserName = usersById.get(currentUserID)?.name?.toLowerCase() || '';
          const selfDMNames = ['you', currentUserName].filter(Boolean);
          return queryParts.every(part => selfDMNames.some(name => name.includes(part)));
        }

        // Get names to check: use searchableNames or fallback to usersById lookup
        const namesToCheck =
          searchableNames && searchableNames.length > 0
            ? searchableNames
            : getDMParticipantIdsToFetch(channel, currentUserID)
                .map(id => usersById.get(id)?.name)
                .filter((n): n is string => !!n);

        if (namesToCheck.length === 0) return false;

        const namesLower = namesToCheck.map(n => n.toLowerCase());
        // All query parts must match at least one participant name
        return queryParts.every(part => namesLower.some(name => name.includes(part)));
      });

      // Map to display format, filtering out DMs with no resolvable names
      return strictlyFiltered
        .map(({ channel, searchableNames }) => {
          const displayName = getDMDisplayNameWithSelf(channel, searchableNames);
          // Only include if we have actual participant names
          if (displayName === 'Group Chat') {
            return null;
          }
          return { channel, displayName };
        })
        .filter((item): item is { channel: Channel; displayName: string } => item !== null);
    }

    // No query: show all DMs including self-DMs (with proper display names)
    return filtered
      .map(({ channel, searchableNames }) => {
        const displayName = getDMDisplayNameWithSelf(channel, searchableNames);
        // Only include if we have actual participant names
        if (displayName === 'Group Chat') {
          return null;
        }
        return { channel, displayName };
      })
      .filter((item): item is { channel: Channel; displayName: string } => item !== null);
  }, [
    allChannels,
    mentionSearchQuery,
    mentionSearchType,
    getDMDisplayNameWithSelf,
    usersById,
    currentUserID,
    activeTab,
  ]);

  // Legacy export for backward compatibility (combines both)
  const availableChannels = useMemo(() => {
    return [...availableRegularChannels, ...availableDMs];
  }, [availableRegularChannels, availableDMs]);

  // Priority typeahead — the closed TicketPriority enum, prefix-filtered by the query.
  // `id` is the canonical uppercase value (wire/backend); `name` is the capitalized
  // dropdown label. The chip renders lowercase (buildChipText), so the two are decoupled.
  const availablePriorities = useMemo(() => {
    if (mentionSearchType !== MentionType.PRIORITY) return [];
    const query = mentionSearchQuery.trim().toLowerCase();
    return Object.values(TicketPriority)
      .map(value => ({ id: value, name: value.charAt(0) + value.slice(1).toLowerCase() }))
      .filter(({ id }) => (query ? id.toLowerCase().startsWith(query) : true));
  }, [mentionSearchType, mentionSearchQuery]);

  // The highlighted candidate in the open mention popup — the exact row Enter/click selects.
  // Reads the same arrays the Enter handler indexes, so the ghost never disagrees with Enter.
  const mentionActiveLabel = useMemo<string | null>(() => {
    if (mentionSearchType === MentionType.USER) {
      const user = availableUsers[selectedMentionIndex];
      return user ? getUserDisplayName(user) : null;
    }
    if (mentionSearchType === MentionType.CHANNEL) {
      return availableChannels[selectedMentionIndex]?.displayName ?? null;
    }
    if (mentionSearchType === MentionType.PRIORITY) {
      return availablePriorities[selectedMentionIndex]?.name ?? null;
    }
    return null;
  }, [
    mentionSearchType,
    availableUsers,
    availableChannels,
    availablePriorities,
    selectedMentionIndex,
  ]);

  // Ghost suffix for an OPEN filter typeahead: previews the highlighted candidate + the action
  // Enter triggers - " - Select" for the filter prefixes (from/to/with/assignee/in/priority),
  // " - Open" for the @/# nav. Shown as soon as the typeahead is open (a selector is inherently a
  // "pick a value" context, so the first candidate previews at rest); the row's gray→blue tier
  // still signals navigation. Empty when there's no matching candidate.
  const popupFilterHint = useMemo(() => {
    if (!mentionSearchType || !mentionActiveLabel) return '';
    const query = mentionSearchQuery.trim();
    // @/# navigate on select; every other prefix builds a filter chip (a "select").
    const action = userTrigger === '@' || channelTrigger === '#' ? 'Open' : 'Select';
    // No value typed yet: at rest show only the action word ("from: - Select"), not the first
    // candidate's name - the resting highlight is arbitrary, so previewing it reads as if it were
    // already chosen. Once the user navigates, preview the actually-highlighted name.
    if (!query) {
      return hasNavigated
        ? `${mentionActiveLabel}\u00a0\u2013 ${action}`
        : `\u00a0\u2013 ${action}`;
    }
    // Typed value: inline-complete the remainder; nbsp keeps a leading space from collapsing.
    if (mentionActiveLabel.toLowerCase().startsWith(query.toLowerCase())) {
      const completion = mentionActiveLabel.slice(query.length).replace(/^ /, '\u00a0');
      return `${completion}\u00a0\u2013 ${action}`;
    }
    return '';
  }, [
    hasNavigated,
    mentionSearchType,
    mentionSearchQuery,
    userTrigger,
    channelTrigger,
    mentionActiveLabel,
  ]);

  // Never surface a ghost when the input is truly empty (no free text AND no chip). A stale
  // mention popup or a mid-delete transition can otherwise leave the suffix floating at the
  // caret with nothing to anchor to ("ghost text floating when deleted").
  const inputIsEmpty = !searchText.trim() && selectedMentions.length === 0;
  // The slash-command ghost wins first: command text lives in `commandText`, so
  // `searchText` (and thus `inputIsEmpty`) is empty during a `/call`/`/chat`; without
  // this priority the command format preview would be suppressed.
  const autocompleteSuffix = commandGhost.suffix
    ? commandGhost.suffix
    : inputIsEmpty
      ? undefined
      : typeAutocomplete.suffix ||
        textFilterHint ||
        popupFilterHint ||
        (screenSearchActive ? getScreenSearchSuffix() : undefined);

  // Reset expanded categories only when search text is cleared completely
  useEffect(() => {
    if (!searchText.trim()) {
      setExpandedCategories(new Set());
    }
  }, [searchText]);

  // Close ticket preview when switching tabs
  useEffect(() => {
    if (previewTicket) {
      setPreviewTicket(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // A tab-switch swaps the result set, so reset the navigation flag (new tab re-auto-selects row 0)
  // and the ghost. activeItemActionable is deliberately NOT reset — syncEnterIntent owns it and the
  // row-swap MutationObserver recomputes it; forcing false here races that sync and clobbers it.
  useEffect(() => {
    hasNavigatedRef.current = false;
    setHasNavigated(false);
    setActiveItemLabel(null);
    setEnterWillOpen(false);
  }, [activeTab]);

  // Reset active tab if the current tab is no longer in the enabled set.
  // In inline mode, fall back to the first enabled tab (never ALL).
  useEffect(() => {
    // When hideTabs is true (screen-mode popup), ALL is always valid — no reset needed
    if (!hideTabs && !activeEnabledTabs.includes(activeTab)) {
      setActiveTab(inline ? (activeEnabledTabs[0] ?? TabType.ALL) : TabType.ALL);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEnabledTabs, inline, hideTabs]);

  // Clear desk merge mode when switching away from DESK tab
  useEffect(() => {
    if (activeTab !== TabType.DESK) {
      setDeskMergeMode(false);
      setSelectedMergeTickets(new Map());
    }
  }, [activeTab]);

  // Clear desk merge mode when the desk channel filter is removed
  useEffect(() => {
    if (!hasDeskChannelFilter) {
      setDeskMergeMode(false);
      setSelectedMergeTickets(new Map());
    }
  }, [hasDeskChannelFilter]);

  // Reset state when menu closes; also reset tab on open so dialog always starts on ALL
  useEffect(() => {
    if (!open) {
      setSeedCommandMode(false);
      setSearch('');
      setSearchText('');
      setSelectedMentions([]);
      setMentionSearchQuery('');
      setMentionSearchType(null);
      setChannelTrigger(null);
      setUserTrigger(null);
      // Ghost/selection state must reset too, or a reopen shows the last session's
      // preview: openTargetLabel falls back to activeItemLabel when the query is empty,
      // so a stale label renders as a "‹prev item› – Open" placeholder.
      setSelectedMentionIndex(0);
      setHasNavigated(false);
      hasNavigatedRef.current = false;
      setEnterWillOpen(false);
      setActiveItemLabel(null);
      // Close the ⌥↵ Actions menu on palette close too. It renders as a sibling (survives the
      // dialog), so a leftover target keeps the popup open over a stale, detached anchor row and
      // re-surfaces it on the next Cmd+K open.
      setActionsMenuTarget(null);
      actionsAnchorRef.current = null;
      setActiveTab(TabType.ALL);
      onTabChange?.(TabType.ALL);
      resetSearchState();
      setExpandedCategories(new Set());
      setPreviewTicket(null);
      setDeskMergeMode(false);
      setSelectedMergeTickets(new Map());
      setShowMergeDialog(false);

      // Reset the previous search text refs
      prevSearchTextRef.current = '';
      lastModifierRef.current = false;

      if (searchSessionId) {
        onClose();
      }
    } else if (!inline) {
      // When opening the non-inline dialog, start on initialTab if provided, else ALL
      setActiveTab(initialTab ?? TabType.ALL);
    } else if (inline && !searchSessionId) {
      // Inline mode (screen-mode popup): start a search session so performSearch fires
      onOpen('click');
    }
  }, [open, searchSessionId, onClose, onOpen, resetSearchState, inline, initialTab]);

  const toggleCategoryExpansion = (category: string): void => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

  const consumeModifier = (): boolean => {
    const modifier = lastModifierRef.current;
    lastModifierRef.current = false;
    return modifier && !isMobile;
  };

  const handleChannelSelect = async (
    channel: Channel,
    displayName: string,
    rankPosition?: number,
  ): Promise<void> => {
    if (contextSelectionMode && onContextItemToggle) {
      onContextItemToggle(buildContextItemFromChannel(channel, displayName));
      return;
    }

    const route = `/chat/dir/${channel.id}`;

    // Track click on channel if metrics available
    onResultClick(
      { id: channel.id, type: 'channel' } as DisplaySearchResult,
      rankPosition ?? 1,
      channel.id,
      route,
    );

    if (consumeModifier()) {
      const channelResult = { id: channel.id, type: 'channel' } as DisplaySearchResult;
      await openSearchResult(
        channelResult,
        { modifier: true, isElectron: isElectronApp(), isMobile },
        navigate,
        channelData || [],
      );
      onOpenChange(false);
      return;
    }

    void navigate(route);
    onOpenChange(false);
  };

  const handleBackendResultSelect = async (
    result: DisplaySearchResult,
    rankPosition: number,
  ): Promise<void> => {
    // Desk merge mode: clicking a desk email toggles selection instead of navigating
    if (deskMergeMode && getDeskTicketId(result)) {
      handleToggleDeskMergeSelect(result);
      return;
    }

    if (contextSelectionMode && onContextItemToggle) {
      onContextItemToggle(buildContextItemFromResult(result));
      return;
    }

    // Track click on search result
    if (searchText.trim()) {
      onResultClick(result, rankPosition, result.searchContext?.channelId);
    }

    const useModifier = consumeModifier();

    try {
      if (useModifier) {
        await openSearchResult(
          result,
          { modifier: true, isElectron: isElectronApp(), isMobile },
          navigate,
          channelData || [],
        );
      } else {
        await navigateToSearchResult(result, navigate, channelData || []);
      }
      onOpenChange(false);
    } catch (err) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('Navigation failed:'),
        error: err,
      });
    }
  };

  const handleItemMouseDown = (e: React.MouseEvent): void => {
    lastModifierRef.current = e.metaKey || e.ctrlKey;
    // Metrics: prime the slash-command selection gesture before cmdk's onSelect.
    lastSlashSelectionRef.current = 'mouse';
  };

  // Mouse hover and keyboard selection both write `aria-selected`, but through
  // different mechanisms: cmdk drives the hovered item declaratively from its
  // own `value` state (onPointerMove), while the auto-select effect and the
  // ArrowUp/Down handler set `aria-selected` directly via setAttribute. cmdk
  // only re-renders (and so only clears) the item it tracks, leaving the
  // manually-set row stuck as a second highlighted "selected" row — and the
  // Enter handler reads the first such row, so it can act on a different item
  // than the one under the cursor. On mouse movement, reconcile to a single
  // source of truth: the row under the pointer wins (cmdk's own hover target),
  // matching the conventional cmdk/Slack behaviour where the mouse moves the
  // selection. Deferred to rAF so cmdk's pointer-driven re-render lands first.
  const reconcileHoverSelection = useCallback((): void => {
    requestAnimationFrame(() => {
      const items = commandRef.current?.querySelectorAll('[cmdk-item]:not([aria-disabled="true"])');
      if (!items || items.length === 0) return;
      const hovered = Array.from(items).find(item => item.matches(':hover'));
      if (!hovered) return;
      items.forEach(item => {
        item.setAttribute('aria-selected', item === hovered ? 'true' : 'false');
      });
      // Hover moves aria-selected (an attribute) — the row-list MutationObserver only watches
      // childList, so it's blind to this. Recompute the hint here or it freezes while hovering.
      syncEnterIntent();
      markNavigated();
    });
  }, [syncEnterIntent, markNavigated]);

  const handleFilePreview = useCallback((result: DisplaySearchResult): void => {
    // Handle attachment preview - show file preview modal
    if (result.type !== 'attachment' || !result.searchContext?.internalUrl) {
      return;
    }

    const { attachmentId, internalUrl } = result.searchContext;
    // Cmd+K stays open behind the preview so closing the preview returns to the
    // results instead of dismissing the whole palette.
    setPreviewFile({
      fileName: result.title,
      fileUrl: attachmentId ? `/attachments/${attachmentId}/download` : internalUrl,
      mimeType: result.searchContext.mimeType || 'application/octet-stream',
      fileSize: result.searchContext.fileSize || 0,
    });
  }, []);

  // Handle mouse hover over ticket and Desk items to show preview
  const handleTicketMouseEnter = useCallback(
    (result: DisplaySearchResult): void => {
      setHoveredResult(result);
      setKeyboardSelectedResult(null); // Clear keyboard selection when mouse takes over
      // Only update when preview is already open
      if (!previewTicket) {
        return;
      }
      if (!isPreviewableTicketResult(result)) {
        // In ALL tab, close preview when hovering over a non-previewable item.
        if (activeTab === TabType.ALL) {
          setPreviewTicket(null);
        }
        return;
      }
      // Only update if the preview target is different.
      if (previewTicket.id !== result.id) {
        setPreviewTicket(result);
      }
    },
    [previewTicket, activeTab],
  );

  // Handle mouse leave to clear hover state
  const handleTicketMouseLeave = useCallback((): void => {
    setHoveredResult(null);
  }, []);

  const getChannelIcon = (channel: Channel): ReactElement => {
    if (isGroupDMChannel(channel.scopeType)) {
      // Slack-style group icon: people glyph with participant count badge
      const otherCount = getDMParticipantIdsToFetch(channel, currentUserID).length;
      return (
        <div className='relative flex h-5 w-5 items-center justify-center'>
          <UserTwo size={16} className='text-muted-foreground' />
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
        return <Avatar userId={userIds[0]} size='xs' />;
      }
    }
    if (channel.visibility === ChannelVisibility.PRIVATE) {
      return <Lock02Close size={16} />;
    }
    return <Hashtag size={16} />;
  };

  /**
   * Channel tag for a ticket / file result row.
   *
   * The Vespa doc denormalizes both `searchContext.channelId` and
   * `metadata.channelName`, so this needs no lookup of its own: it resolves the id
   * against the already-loaded `allChannels`. No network call, no per-row hook.
   *
   * The row renders this as the phrase "in <name>", so a plain public channel
   * sends no icon — a hashtag would only repeat the word. Anything the word can't
   * say keeps its `getChannelIcon` glyph: private lock, DM avatar, group. The
   * fallback path (channel not in the local set — not a member, not yet loaded)
   * has only the denormalized name, so it reads as public.
   */
  const getResultChannelTag = (
    result: DisplaySearchResult,
  ): { name: string; icon?: ReactElement | undefined } | undefined => {
    const entry = result.searchContext?.channelId
      ? allChannels.find(item => item.channel.id === result.searchContext?.channelId)
      : undefined;
    if (entry) {
      const { channel } = entry;
      const isPlainPublic =
        !isDMChannel(channel.scopeType) &&
        !isGroupDMChannel(channel.scopeType) &&
        channel.visibility !== ChannelVisibility.PRIVATE;
      return isPlainPublic
        ? { name: channel.name }
        : { name: channel.name, icon: getChannelIcon(channel) };
    }
    const fallbackName = result.metadata.channelName;
    if (!fallbackName) return undefined;
    return { name: fallbackName };
  };

  // Group results by type for display
  const groupedBackendResults = useMemo(() => {
    const groups: Record<string, DisplaySearchResult[]> = {};
    backendResults.forEach(result => {
      let groupKey: string;
      if (result.searchContext?.subApp === 'DESK') {
        groupKey = 'desk';
      } else if (result.type === 'attachment' && result.searchContext?.subApp) {
        const subAppKey = result.searchContext.subApp.toLowerCase();
        if (subAppKey === 'canvas') {
          groupKey = 'canvas';
        } else if (subAppKey === 'transcript') {
          groupKey = activeTab === TabType.RECORDING ? 'recording' : 'transcript';
        } else {
          groupKey = 'attachment';
        }
      } else {
        groupKey = result.type;
      }
      const group = groups[groupKey];
      if (group) {
        group.push(result);
      } else {
        groups[groupKey] = [result];
      }
    });
    return groups;
  }, [backendResults, activeTab]);

  const flatAllBackendResults = useMemo(
    () => backendResults.filter(result => result.type !== 'user' && result.type !== 'channel'),
    [backendResults],
  );

  // Group local channels by category
  const groupedChannels = useMemo(() => {
    const groups: Record<string, typeof filteredLocalChannels> = {};
    filteredLocalChannels.forEach(item => {
      if (!groups[item.category]) {
        groups[item.category] = [];
      }
      groups[item.category]!.push(item);
    });
    return groups;
  }, [filteredLocalChannels]);

  const localGroupDMs =
    groupedChannels['direct-messages']?.filter(({ channel }) =>
      isGroupDMChannel(channel.scopeType),
    ) ?? [];

  // Slack-style strong channel match: when the top-ranked regular channel's
  // name prefix-matches the query, the CHANNELS section renders ABOVE the
  // "Show results for" row and the default Enter target becomes that channel.
  // Mirrors `hasStrongUserMatch` exactly — only applies to plain search (no
  // from:/in:/with: chips, CHANNELS section shown and non-empty) and only when
  // a strong USER match does NOT already win (users take precedence).
  //
  // `name.startsWith(q)` is the SAME full-name-prefix signal `searchChannels`
  // boosts to the top tier, so the ranking and the Enter target stay aligned.
  const hasStrongChannelMatch = useMemo(() => {
    if (hasStrongUserMatch) return false;
    if (hasFromOrInFilter || !showGroupedLocalResults) return false;
    const topChannel = groupedChannels['channels']?.[0]?.channel;
    if (!topChannel) return false;
    const q = cleanedSearchText.toLowerCase().trim();
    if (!q) return false;
    return topChannel.name.toLowerCase().startsWith(q);
  }, [
    hasStrongUserMatch,
    hasFromOrInFilter,
    showGroupedLocalResults,
    groupedChannels,
    cleanedSearchText,
  ]);

  // Slack-style strong starred match: the Starred section only LEADS (hoists above People/Channels)
  // when a starred item's displayed name prefix-matches the query. Without this, ANY query hoisted
  // Starred, so a weak fuzzy hit on a starred DM (e.g. "venkatesan" matching a starred
  // "…Venkattaramanujam" DM shown as "Mamtha") jumped above the exact "Venkatesan S" user. Checks
  // every matched starred item (not just the top, which affinity may hold), mirroring the prefix
  // rule hasStrongUserMatch/hasStrongChannelMatch use.
  const hasStrongStarredMatch = useMemo(() => {
    if (hasFromOrInFilter) return false;
    const q = cleanedSearchText.toLowerCase().trim();
    if (!q) return false;
    const starredMatches = groupedChannels[ChannelCategory.STARRED] ?? [];
    return starredMatches.some(item =>
      (item.searchableNames ?? []).some(name => name.toLowerCase().startsWith(q)),
    );
  }, [hasFromOrInFilter, groupedChannels, cleanedSearchText]);

  const iconSize = 14;

  const allTabDefinitions: Array<{ id: TabType; label: string; icon?: ReactElement }> = [
    { id: TabType.MESSAGES, label: 'Messages', icon: <ChatDefault size={iconSize} /> },
    { id: TabType.USERS, label: 'People', icon: <UserTwo size={iconSize} /> },
    { id: TabType.CHANNELS, label: 'Channels', icon: <Hashtag size={iconSize} /> },
    { id: TabType.ATTACHMENTS, label: 'Files', icon: <FolderDefault size={iconSize} /> },
    { id: TabType.CANVAS, label: 'Canvas', icon: <File02Text size={iconSize} /> },
    { id: TabType.TICKETS, label: 'Tickets', icon: <TicketToken size={iconSize} /> },
    { id: TabType.CALL, label: 'Calls', icon: <Phone size={iconSize} /> },
    { id: TabType.RECORDING, label: 'Recordings', icon: <MicOn size={iconSize} /> },
    { id: TabType.DESK, label: 'Desk', icon: <EnvelopeDefault size={iconSize} /> },
  ];

  const tabs = allTabDefinitions.filter(t => activeEnabledTabs.includes(t.id));

  const getCategoryLabel = (category: ChannelCategory): string => {
    switch (category) {
      case ChannelCategory.STARRED:
        return 'Starred';
      case ChannelCategory.CHANNELS:
        return 'Channels';
      case ChannelCategory.DIRECT_MESSAGES:
        return 'Direct Messages';
      case ChannelCategory.GROUP_DMS:
        return 'Group DMs';
      default:
        return '';
    }
  };

  const getGroupLabel = (type: string): string => {
    switch (type) {
      case 'user':
        return 'Users';
      case 'channel':
        return 'Channels';
      case 'conversation':
        return 'Messages';
      case 'ticket':
        return 'Tickets';
      case 'attachment':
        return 'Attachments';
      case 'canvas':
        return 'Canvas';
      case 'transcript':
        return 'Calls';
      case 'recording':
        return 'Recordings';
      case 'desk':
        return 'Desk';
      case 'others':
        return 'Others';
      default:
        return '';
    }
  };

  const hasResults =
    ((activeTab === TabType.ALL || activeTab === TabType.CHANNELS) &&
      showGroupedLocalResults &&
      filteredLocalChannels.length > 0) ||
    ((activeTab === TabType.ALL || activeTab === TabType.USERS) &&
      showGroupedUsers &&
      filteredLocalUsers.length > 0) ||
    (activeTab !== TabType.CHANNELS && activeTab !== TabType.USERS && backendResults.length > 0);

  const showEmptyState = searchText.trim() && !isLoading && !hasResults;

  // Auto-select first result when search results change. Reset the
  // navigation flag when either the free-text query OR the active filter
  // chips change — both are inputs to the backend search.
  useEffect(() => {
    hasNavigatedRef.current = false;
    setHasNavigated(false);
    // Emptying the input (e.g. Cmd+A + backspace over a chip) must also drop the stale row
    // preview, or openTargetLabel keeps rendering "<prev item> - Open" over the placeholder.
    // In command mode `searchText` is empty but a picker row IS highlighted (its label drives
    // the `<name> – Select` ghost), so don't clear it there. `commandText` is a dep so the flag
    // resets on each command keystroke — the from:/in: ghost behaviour the picker mirrors.
    if (!commandActive && !searchText.trim() && selectedMentions.length === 0) {
      setActiveItemLabel(null);
      setEnterWillOpen(false);
    }
  }, [searchText, selectedMentions, commandText, commandActive]);

  // The user-facing banner shows a generic "Search is unavailable" message;
  // log the raw backend error to the console so devs can still triage from
  // DevTools without exposing implementation details in the UI.
  useEffect(() => {
    if (error)
      logger.warn(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_warn',
        message: String('[Cmd+K search]'),
        context: [error],
      });
  }, [error]);

  // Signature of the backend result ORDER, not just count: a re-rank that keeps the same row
  // count (e.g. adding free-text to a `from:` filter) wouldn't change `backendResults.length`,
  // so the auto-select effect below wouldn't re-run and the highlight would stay stranded.
  const backendResultOrder = backendResults.map(r => r.id).join(',');

  useEffect(() => {
    // Auto-select fires when there's a query OR an active filter chip — the
    // latter catches the case where the user typed `from:<name>` / `in:<ch>`,
    // inserted a chip, and the backend returned results for that filter with
    // no free-text query.
    // Command mode (`/call`/`/chat`) keeps its text in `commandText`, not `searchText`,
    // and renders its own cmdk rows — so treat it as active and skip the `hasResults`
    // gate (which tracks Vespa results) so the first command row is highlighted at rest.
    const hasActiveSearch =
      searchText.trim().length > 0 || selectedMentions.length > 0 || commandActive;
    // While a mention typeahead is open, selection is owned by selectedMentionIndex - don't
    // also auto-select a cmdk row, or two rows light up.
    if (
      !hasActiveSearch ||
      (!hasResults && !commandActive) ||
      hasNavigatedRef.current ||
      mentionSearchType
    )
      return;
    // Small delay to let DOM render the items
    const timer = setTimeout(() => {
      if (hasNavigatedRef.current) return;
      const items = commandRef.current?.querySelectorAll('[cmdk-item]:not([aria-disabled="true"])');
      if (items && items.length > 0) {
        // The popup pins "Show results for" first in the DOM, but it must not become the
        // resting Enter target — highlight the first real result instead, falling back to
        // the row only when it is the sole item. The screen palette keeps first-row.
        const firstReal = isScreenPalette
          ? -1
          : Array.from(items).findIndex(
              item => item.getAttribute('data-show-results-item') !== 'true',
            );
        const selectedIndex = firstReal === -1 ? 0 : firstReal;
        items.forEach((item, i) => {
          item.setAttribute('aria-selected', i === selectedIndex ? 'true' : 'false');
        });
      }
      // No sync here: the results-list observer recomputes actionability whenever rows change
      // (incl. a re-rank, which reorders keyed rows = a childList mutation), and enterWillOpen/label
      // stay hidden until the user navigates (arrow/hover re-sync them then).
    }, 50);
    return () => clearTimeout(timer);
  }, [
    searchText,
    hasResults,
    activeTab,
    filteredLocalChannels.length,
    filteredLocalUsers.length,
    backendResultOrder,
    mentionSearchType,
    commandActive,
    // `commandText` is a dep (not read in the body) so the first-row auto-select
    // re-fires as the `/` command list / user picker narrows while typing.
    commandText,
  ]);

  // Browse-mode hint sync lives in attachCommandRef's MutationObserver (the auto-select effect above
  // only runs during an active search).

  // Render backend results for the search-active branch (flat list filtered by activeTab)
  const renderSearchBackendResults = () => (
    <>
      {isFlatAllView
        ? flatAllBackendResults.length > 0 && (
            <div className='mb-4'>
              <Command.Group
                heading={`${getGroupLabel('others')} (${flatAllBackendResults.length})`}
                className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono'
              >
                {flatAllBackendResults.map((result, index) => (
                  <SearchResultItem
                    key={`${result.type}-${result.id}`}
                    result={result}
                    channelDisplayName={getResultChannelLabel(result)}
                    channelTag={getResultChannelTag(result)}
                    onSelect={res => handleBackendResultSelect(res, index + 1)}
                    onPreview={handleFilePreview}
                    onItemMouseDown={handleItemMouseDown}
                    onItemMouseEnter={handleTicketMouseEnter}
                    onItemMouseLeave={handleTicketMouseLeave}
                    isSelected={contextItems.some(c => c.id === `${result.type}-${result.id}`)}
                    mergeMode={deskMergeMode && !!getDeskTicketId(result)}
                    isMergeSelected={selectedMergeTickets.has(result.searchContext?.ticketId || '')}
                    onToggleSelect={handleToggleDeskMergeSelect}
                  />
                ))}
              </Command.Group>
            </div>
          )
        : ['conversation', 'ticket', 'attachment', 'canvas', 'transcript', 'recording', 'desk']
            .filter(groupKey => backendGroupBelongsToTab(groupKey, activeTab))
            .map(groupKey => {
              const items = groupedBackendResults[groupKey];
              if (!items || items.length === 0) return null;

              const displayCount =
                activeTab !== TabType.ALL
                  ? paginationState[activeTab].cumulativeCount
                  : items.length;

              const isScreenAll = searchMode === 'screen' && activeTab === TabType.ALL;
              const displayItems = isScreenAll ? items.slice(0, 2) : items;
              const hiddenCount = items.length - displayItems.length;
              const sectionTab = GROUP_KEY_TO_DOC_TYPE[groupKey];

              // "See more" routes to the full results page with this section's tab
              // pre-selected. Offered on every tab, not just All: an active filter
              // (`assignee:`, `from:`) narrows the enabled tabs via getRelevantTabs and
              // moves activeTab off All, and those searches still need the way out.
              // Every section here is a capped slice, so there is more to see even when
              // nothing was truncated locally. Screen mode keeps its narrower rule: it
              // only offers the link when it actually cut items off.
              const showSeeMore = !!sectionTab && (!isScreenAll || hiddenCount > 0);

              return (
                <div key={groupKey} className='mb-4'>
                  <Command.Group
                    heading={
                      isScreenAll
                        ? getGroupLabel(groupKey)
                        : `${getGroupLabel(groupKey)} (${displayCount})`
                    }
                    className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono'
                  >
                    {displayItems.map((result, index) => (
                      <SearchResultItem
                        key={result.id}
                        result={result}
                        channelDisplayName={getResultChannelLabel(result)}
                        channelTag={getResultChannelTag(result)}
                        onSelect={res => handleBackendResultSelect(res, index + 1)}
                        onPreview={handleFilePreview}
                        onItemMouseDown={handleItemMouseDown}
                        onItemMouseEnter={handleTicketMouseEnter}
                        onItemMouseLeave={handleTicketMouseLeave}
                        isSelected={contextItems.some(c => c.id === `${result.type}-${result.id}`)}
                        mergeMode={deskMergeMode && !!getDeskTicketId(result)}
                        isMergeSelected={selectedMergeTickets.has(
                          result.searchContext?.ticketId || '',
                        )}
                        onToggleSelect={handleToggleDeskMergeSelect}
                      />
                    ))}
                    {showSeeMore && sectionTab && (
                      <SeeMoreItem
                        value={`__see-more-backend-${groupKey}__`}
                        label={hiddenCount > 0 ? `See ${hiddenCount} more` : 'See more'}
                        onSelect={() => handleSeeMoreNavigate(sectionTab)}
                        hoverable={!isMobile}
                        trackCategory='SEARCH'
                        trackName='SEE_MORE_SECTION'
                        trackMetadata={JSON.stringify({ tab: sectionTab })}
                      />
                    )}
                  </Command.Group>
                </div>
              );
            })}

      {/* Infinite scroll trigger and loading indicator */}
      {paginationState[activeTab].hasMore && (
        <div ref={loadMoreRef} className='py-4 flex justify-center'>
          {isLoadingMore && (
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Spinner className='h-4 w-4 animate-spin' />
              <span>Loading more results...</span>
            </div>
          )}
        </div>
      )}
    </>
  );

  // Render backend results for the browse/no-search branch (sorted with expand/collapse)
  const renderDefaultBackendResults = () => (
    <>
      {Object.entries(groupedBackendResults)
        .filter(([type]) => backendGroupBelongsToTab(type, activeTab))
        .sort(([typeA], [typeB]) => {
          if (hasFromOrInFilter) {
            // When from:/in: filter is active, prioritize Messages/Tickets before Users
            const filterPriority: Record<string, number> = {
              conversation: 0,
              ticket: 1,
              attachment: 2,
              user: 3,
            };
            return (filterPriority[typeA] ?? 99) - (filterPriority[typeB] ?? 99);
          }
          // Default: prioritize 'user' type to render first
          if (typeA === 'user') return -1;
          if (typeB === 'user') return 1;
          return 0;
        })
        .map(([type, items]) => {
          const displayCount =
            activeTab === TabType.ALL ? items.length : paginationState[activeTab].cumulativeCount;
          const isUserType = type === 'user';
          const isExpanded = expandedCategories.has(type);
          const hasMore = items.length > DISPLAY_LIMIT;
          const displayItems =
            isUserType && !isExpanded && hasMore ? items.slice(0, DISPLAY_LIMIT) : items;
          const hiddenCount = items.length - DISPLAY_LIMIT;
          const sectionTab = GROUP_KEY_TO_DOC_TYPE[type];

          return (
            <div key={type} className='mb-4'>
              <Command.Group
                heading={`${getGroupLabel(type)} (${displayCount})`}
                className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono'
              >
                {displayItems.map((result, index) => (
                  <SearchResultItem
                    key={result.id}
                    result={result}
                    channelDisplayName={getResultChannelLabel(result)}
                    channelTag={getResultChannelTag(result)}
                    onSelect={res => handleBackendResultSelect(res, index + 1)}
                    onPreview={handleFilePreview}
                    onItemMouseDown={handleItemMouseDown}
                    onItemMouseEnter={handleTicketMouseEnter}
                    onItemMouseLeave={handleTicketMouseLeave}
                    isSelected={contextItems.some(c => c.id === `${result.type}-${result.id}`)}
                  />
                ))}
                {isUserType && hasMore && (
                  <SeeMoreItem
                    value={`__see-more-default-${type}__`}
                    label={isExpanded ? 'See less' : `See ${hiddenCount} more`}
                    onSelect={() => toggleCategoryExpansion(type)}
                    hoverable={!isMobile}
                    trackCategory='CHANNEL_SEARCH'
                    trackName='TOGGLE_BACKEND_USER_EXPANSION'
                    trackMetadata={JSON.stringify({ type, isExpanded })}
                  />
                )}
                {/* Same routing link the search branch offers. This renderer runs when
                    a filter chip is applied with no free-text query (`from:`,
                    `assignee:`), so it needs the way out to the full results page too.
                    Users are excluded — their row above expands in place instead. */}
                {!isUserType && sectionTab && (
                  <SeeMoreItem
                    value={`__see-more-default-route-${type}__`}
                    label='See more'
                    onSelect={() => handleSeeMoreNavigate(sectionTab)}
                    hoverable={!isMobile}
                    trackCategory='SEARCH'
                    trackName='SEE_MORE_SECTION'
                    trackMetadata={JSON.stringify({ tab: sectionTab })}
                  />
                )}
              </Command.Group>
            </div>
          );
        })}

      {/* Infinite scroll trigger and loading indicator */}
      {paginationState[activeTab].hasMore && (
        <div ref={loadMoreRef} className='py-4 flex justify-center'>
          {isLoadingMore && (
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Spinner className='h-4 w-4 animate-spin' />
              <span>Loading more results...</span>
            </div>
          )}
        </div>
      )}
    </>
  );

  // Render the plain-search USERS section. Extracted so it can be rendered
  // above the "Show results for" row when there is a strong user match.
  const renderSearchUsersSection = () =>
    (activeTab === TabType.ALL || activeTab === TabType.USERS) &&
    showGroupedUsers &&
    filteredLocalUsers.length > 0 ? (
      <div className='mb-4'>
        {(() => {
          // Use the shared, hoisted Cmd+K user rank, then map to DisplaySearchResult.
          const allItems: DisplaySearchResult[] = rankedLocalUsers.map(user => ({
            id: user.id,
            type: 'user' as const,
            title: getUserDisplayName(user),
            subtitle: user.email || '',
            relevanceScore: 1,
            metadata: {},
          }));

          const totalItemsCount = allItems.length;
          const displayCount = totalItemsCount;

          const isExpanded = expandedCategories.has('user');
          // Full-screen (screen) mode: "See more" routes to the results page for ANY tab
          // (not just ALL); popup mode keeps the inline expand/collapse.
          const routeSeeMore = searchMode === 'screen';
          const hasMore = totalItemsCount > DISPLAY_LIMIT;

          const displayItems = !isExpanded && hasMore ? allItems.slice(0, DISPLAY_LIMIT) : allItems;

          const hiddenCount = totalItemsCount - DISPLAY_LIMIT;

          return (
            <Command.Group
              heading={`${getGroupLabel('user')} (${displayCount})`}
              className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono'
            >
              {displayItems.map((item, index) => (
                <SearchResultItem
                  key={item.id}
                  result={item}
                  onSelect={res => handleBackendResultSelect(res, index + 1)}
                  onItemMouseDown={handleItemMouseDown}
                  isSelected={contextItems.some(c => c.id === `${item.type}-${item.id}`)}
                />
              ))}
              {hasMore && (
                <SeeMoreItem
                  value='__see-more-local-user__'
                  label={!routeSeeMore && isExpanded ? 'See less' : `See ${hiddenCount} more`}
                  onSelect={() =>
                    routeSeeMore ? handleSeeMoreNavigate('people') : toggleCategoryExpansion('user')
                  }
                  hoverable={!isMobile}
                  trackCategory={routeSeeMore ? 'SEARCH' : 'CHANNEL_SEARCH'}
                  trackName={routeSeeMore ? 'SEE_MORE_SECTION' : 'TOGGLE_CATEGORY_EXPANSION'}
                  trackMetadata={JSON.stringify({ category: 'user', isExpanded })}
                />
              )}
            </Command.Group>
          );
        })()}
      </div>
    ) : null;

  // Render the plain-search CHANNELS section. Extracted (like
  // renderSearchUsersSection) so it can be rendered above the "Show results
  // for" row when there is a strong channel match.
  const renderSearchChannelsSection = () =>
    (activeTab === TabType.ALL || activeTab === TabType.CHANNELS) &&
    showGroupedLocalResults &&
    groupedChannels['channels'] &&
    groupedChannels['channels'].length > 0 ? (
      <div className='mb-4'>
        {(() => {
          const items = groupedChannels['channels'];
          const category = ChannelCategory.CHANNELS;
          const isExpanded = expandedCategories.has(category);
          const routeSeeMore = searchMode === 'screen';
          const hasMore = items.length > DISPLAY_LIMIT;
          const displayItems = !isExpanded && hasMore ? items.slice(0, DISPLAY_LIMIT) : items;
          const hiddenCount = items.length - DISPLAY_LIMIT;

          return (
            <Command.Group
              heading={getCategoryLabel(category)}
              className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono'
            >
              {displayItems.map(({ channel }, index) => {
                const unreadCount = unreadCounts[channel.id] ?? 0;
                return (
                  <ChannelCommandItem
                    key={channel.id}
                    channel={channel}
                    currentUserID={currentUserID}
                    unreadCount={unreadCount}
                    onSelect={displayName => {
                      void handleChannelSelect(channel, displayName, index + 1);
                    }}
                    onItemMouseDown={handleItemMouseDown}
                    getChannelIcon={getChannelIcon}
                    isSelected={contextItems.some(c => c.id === `channel-${channel.id}`)}
                  />
                );
              })}
              {hasMore && (
                <SeeMoreItem
                  value={`__see-more-group-dm-${category as string}__`}
                  label={!routeSeeMore && isExpanded ? 'See less' : `See ${hiddenCount} more`}
                  onSelect={() =>
                    routeSeeMore
                      ? handleSeeMoreNavigate('channels')
                      : toggleCategoryExpansion(category)
                  }
                  hoverable={!isMobile}
                  trackCategory={routeSeeMore ? 'SEARCH' : 'CHANNEL_SEARCH'}
                  trackName={
                    routeSeeMore ? 'SEE_MORE_SECTION' : 'TOGGLE_GROUP_DM_CATEGORY_EXPANSION'
                  }
                  trackMetadata={JSON.stringify({ category: category as string, isExpanded })}
                />
              )}
            </Command.Group>
          );
        })()}
      </div>
    ) : null;

  // Render the plain-search STARRED section. Extracted (like
  // renderSearchUsersSection / renderSearchChannelsSection) so it can be pinned
  // to the top of the list (both popup and screen).
  const renderSearchStarredSection = () =>
    (activeTab === TabType.ALL || activeTab === TabType.CHANNELS) &&
    showGroupedLocalResults &&
    groupedChannels['starred'] &&
    groupedChannels['starred'].length > 0 ? (
      <div className='mb-4'>
        {(() => {
          const items = groupedChannels['starred'];
          const category = ChannelCategory.STARRED;
          const isExpanded = expandedCategories.has(category);
          const routeSeeMore = searchMode === 'screen';
          const hasMore = items.length > DISPLAY_LIMIT;
          const displayItems = !isExpanded && hasMore ? items.slice(0, DISPLAY_LIMIT) : items;
          const hiddenCount = items.length - DISPLAY_LIMIT;

          return (
            <Command.Group
              heading={getCategoryLabel(category)}
              className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono'
            >
              {displayItems.map(({ channel }, index) => {
                const unreadCount = unreadCounts[channel.id] ?? 0;
                return (
                  <ChannelCommandItem
                    key={channel.id}
                    channel={channel}
                    currentUserID={currentUserID}
                    unreadCount={unreadCount}
                    onSelect={displayName => {
                      void handleChannelSelect(channel, displayName, index + 1);
                    }}
                    onItemMouseDown={handleItemMouseDown}
                    getChannelIcon={getChannelIcon}
                    isSelected={contextItems.some(c => c.id === `channel-${channel.id}`)}
                  />
                );
              })}
              {hasMore && (
                <SeeMoreItem
                  value={`__see-more-channel-${category as string}__`}
                  label={!routeSeeMore && isExpanded ? 'See less' : `See ${hiddenCount} more`}
                  onSelect={() =>
                    routeSeeMore
                      ? handleSeeMoreNavigate('channels')
                      : toggleCategoryExpansion(category)
                  }
                  hoverable={!isMobile}
                  trackCategory={routeSeeMore ? 'SEARCH' : 'CHANNEL_SEARCH'}
                  trackName={
                    routeSeeMore ? 'SEE_MORE_SECTION' : 'TOGGLE_CHANNEL_CATEGORY_EXPANSION'
                  }
                  trackMetadata={JSON.stringify({ category: category as string, isExpanded })}
                />
              )}
            </Command.Group>
          );
        })()}
      </div>
    ) : null;

  // Render the local sections (Starred, Users, Group DMs, Channels) for the search branch.
  // Each `include*` flag is false when that section is pinned to the top of the
  // list (hoistStarred / hoistUser / hoistChannel) — avoids a double-render.
  const renderSearchLocalSections = (
    includeStarred = true,
    includeUsers = true,
    includeChannels = true,
  ) => (
    <>
      {/* 0. Starred (from local channels) */}
      {includeStarred && renderSearchStarredSection()}

      {/* 1. Users (from local) */}
      {includeUsers && renderSearchUsersSection()}

      {/* 2. Group DMs (from local channels) */}
      {(activeTab === TabType.ALL || activeTab === TabType.CHANNELS) &&
        showGroupedLocalResults &&
        localGroupDMs.length > 0 &&
        (() => {
          // Cap the number of mounted rows (with an inline expand) the same way
          // the Starred / Channels sections do. A short query can match
          // thousands of DMs; mounting them all as cmdk items is what drove the
          // per-keystroke render + cmdk bookkeeping cost.
          const category = ChannelCategory.GROUP_DMS;
          const isExpanded = expandedCategories.has(category);
          const routeSeeMore = searchMode === 'screen';
          const hasMore = localGroupDMs.length > DISPLAY_LIMIT;
          const displayItems =
            !isExpanded && hasMore ? localGroupDMs.slice(0, DISPLAY_LIMIT) : localGroupDMs;
          const hiddenCount = localGroupDMs.length - DISPLAY_LIMIT;
          return (
            <div className='mb-4'>
              <Command.Group
                heading={getCategoryLabel(category)}
                className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono'
              >
                {displayItems.map(({ channel }, index) => {
                  const unreadCount = unreadCounts[channel.id] ?? 0;
                  return (
                    <ChannelCommandItem
                      key={channel.id}
                      channel={channel}
                      currentUserID={currentUserID}
                      unreadCount={unreadCount}
                      onSelect={displayName => {
                        void handleChannelSelect(channel, displayName, index + 1);
                      }}
                      onItemMouseDown={handleItemMouseDown}
                      getChannelIcon={getChannelIcon}
                      isSelected={contextItems.some(c => c.id === `channel-${channel.id}`)}
                    />
                  );
                })}
                {hasMore && (
                  <SeeMoreItem
                    value={`__see-more-group-dm-${category as string}__`}
                    label={!routeSeeMore && isExpanded ? 'See less' : `See ${hiddenCount} more`}
                    onSelect={() =>
                      routeSeeMore
                        ? handleSeeMoreNavigate('channels')
                        : toggleCategoryExpansion(category)
                    }
                    hoverable={!isMobile}
                    trackCategory={routeSeeMore ? 'SEARCH' : 'CHANNEL_SEARCH'}
                    trackName={
                      routeSeeMore ? 'SEE_MORE_SECTION' : 'TOGGLE_GROUP_DM_CATEGORY_EXPANSION'
                    }
                    trackMetadata={JSON.stringify({ category: category as string, isExpanded })}
                  />
                )}
              </Command.Group>
            </div>
          );
        })()}

      {/* 3. Channels (from local channels) */}
      {includeChannels && renderSearchChannelsSection()}
    </>
  );

  // Render the local channels for the browse branch (no search text)
  const renderBrowseLocalChannels = () => (
    <>
      {showGroupedLocalResults &&
        (activeTab === TabType.ALL || activeTab === TabType.CHANNELS || isChannelsType) &&
        filteredLocalChannels.length > 0 && (
          <>
            {Object.entries(groupedChannels).map(([category, items]) => {
              const typedCategory = category as ChannelCategory;
              const isExpanded = expandedCategories.has(category);
              const shouldLimit = !search.trim();
              const hasMore = items.length > DISPLAY_LIMIT;
              const displayItems =
                shouldLimit && !isExpanded && hasMore ? items.slice(0, DISPLAY_LIMIT) : items;
              const hiddenCount = items.length - DISPLAY_LIMIT;

              return (
                <div key={category} className='mb-4'>
                  <Command.Group
                    heading={getCategoryLabel(typedCategory)}
                    className='[&_[cmdk-group-heading]]:px-2  [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-["Geist_Mono"]'
                  >
                    {displayItems.map(({ channel }, index) => {
                      const unreadCount = unreadCounts[channel.id] ?? 0;
                      return (
                        <ChannelCommandItem
                          key={channel.id}
                          channel={channel}
                          currentUserID={currentUserID}
                          unreadCount={unreadCount}
                          onSelect={displayName => {
                            void handleChannelSelect(channel, displayName, index + 1);
                          }}
                          onItemMouseDown={handleItemMouseDown}
                          getChannelIcon={getChannelIcon}
                          isSelected={contextItems.some(c => c.id === `channel-${channel.id}`)}
                        />
                      );
                    })}
                    {shouldLimit && hasMore && (
                      <SeeMoreItem
                        value={`__see-more-browse-${category}__`}
                        label={isExpanded ? 'See less' : `See ${hiddenCount} more`}
                        onSelect={() => toggleCategoryExpansion(category)}
                        hoverable={!isMobile}
                        trackCategory='CHANNEL_SEARCH'
                        trackName='TOGGLE_LOCAL_CHANNEL_EXPANSION'
                        trackMetadata={JSON.stringify({ category, isExpanded })}
                      />
                    )}
                  </Command.Group>
                </div>
              );
            })}
          </>
        )}
    </>
  );

  // Hoist the best local matches to the top of the list — applies in BOTH the
  // popup and the screen search bar. Only in the combined ALL view (a single-type
  // tab has nothing to reorder) and not while a mention typeahead is open.
  // Starred always leads; a strong user/channel match then becomes the default
  // Enter target. `hasStrongUserMatch`/`hasStrongChannelMatch` already exclude
  // from:/in:/with: chips, where backend results lead instead.
  const canHoist = activeTab === TabType.ALL && !isFlatAllView && !mentionSearchType;
  const hoistStarred = canHoist && hasStrongStarredMatch;
  const hoistUser = canHoist && hasStrongUserMatch;
  const hoistChannel = canHoist && hasStrongChannelMatch;

  // Shared confirmation for a `/call` on a channel. Rendered from every return branch
  // (below) so it survives the Cmd+K close — the menu unmounts its dialog, this stays.
  const channelCallConfirm = (
    <CallConfirmationModal
      isOpen={pendingChannelCall !== null}
      onClose={() => setPendingChannelCall(null)}
      onConfirm={() => {
        if (pendingChannelCall) startChannelCall(pendingChannelCall.id, pendingChannelCall.name);
        setPendingChannelCall(null);
      }}
    />
  );

  // `/record` invoked while a recording is already active — tell the user instead of starting a
  // second session. Same sibling-of-Cmd+K rendering as the call confirm so it survives the close.
  const recordingActiveDialog = (
    <ActionModal
      isOpen={recordingConflict}
      onClose={() => setRecordingConflict(false)}
      showIcon={false}
      title='Recording in progress'
      subtitle="You're already recording. Stop the current recording before starting a new one."
      buttons={[
        { label: 'Dismiss', variant: 'outline', onClick: () => setRecordingConflict(false) },
        {
          label: 'Go to recording',
          onClick: () => {
            setRecordingConflict(false);
            void navigate('/recordings');
          },
        },
      ]}
    />
  );

  // ⌥↵ Actions menu, rendered on top of the still-open palette (unlike the confirm dialogs, which
  // close it first). Running an action dispatches through the slash-command hook; Esc/backdrop just
  // closes the menu and hands focus back to the search editor.
  const resultActionsMenu = (
    <ResultActionsMenu
      open={actionsMenuTarget !== null}
      target={actionsMenuTarget}
      anchorRef={actionsAnchorRef}
      onRun={kind => {
        if (actionsMenuTarget) slash.invokeActionOnTarget(kind, actionsMenuTarget);
        setActionsMenuTarget(null);
      }}
      onClose={() => {
        setActionsMenuTarget(null);
        // Return focus to the search editor on the NEXT frame — after the DropdownMenu unmounts and
        // Radix's modal focus-scope finishes its cleanup. Focusing synchronously loses that race
        // (focus lands on <body>), which leaves cmd+K arrow navigation dead until the user clicks.
        requestAnimationFrame(() => {
          (
            commandRef.current?.querySelector('[contenteditable="true"]') as HTMLElement | null
          )?.focus();
        });
      }}
    />
  );

  const commandConfirmations = (
    <>
      {channelCallConfirm}
      {recordingActiveDialog}
      {resultActionsMenu}
      {!inline && previewFile && (
        <FilePreviewModal
          isOpen={!!previewFile}
          onClose={() => setPreviewFile(null)}
          fileName={stripHtmlTags(previewFile.fileName)}
          fileUrl={previewFile.fileUrl}
          mimeType={previewFile.mimeType}
          fileSize={previewFile.fileSize}
          // Cmd+K's own surface is z-[9999]; the preview opens on top of it and
          // its default z-[56] would put it behind.
          zIndexClass='z-[10002]'
        />
      )}
    </>
  );

  if (inline && !open) return commandConfirmations;

  // Resolve the highlighted Cmd+K row into a chat/call target for the ⌥↵ Actions menu, then map it
  // to the full user/channel object. Only user & channel results are actionable — chat/call need a
  // target. Two rows can carry aria-selected at once (cmdk's own value + our manual arrow/hover
  // setAttribute), so a plain first-match can grab a row the user isn't looking at; prefer the one
  // whose label matches the visible "– Open" hint (activeItemLabel), then the first selected, then
  // the first enabled row (mirrors the Enter target fallback).
  const resolveActionTarget = (): { element: HTMLElement; target: CommandTarget } | null => {
    const container = commandRef.current;
    if (!container) return null;
    const selected = Array.from(
      container.querySelectorAll<HTMLElement>('[cmdk-item][aria-selected="true"]'),
    );
    const byLabel =
      activeItemLabel !== null
        ? selected.find(el => el.getAttribute('data-item-label') === activeItemLabel)
        : undefined;
    const element =
      byLabel ??
      selected[0] ??
      container.querySelector<HTMLElement>('[cmdk-item]:not([aria-disabled="true"])');
    if (!element) return null;
    const resultId = element.getAttribute('data-result-id');
    const resultType = element.getAttribute('data-result-type');
    if (!resultId || !resultType) return null;
    if (resultType === 'user') {
      const user = usersById.get(resultId);
      return user ? { element, target: { type: 'user', user } } : null;
    }
    if (resultType === 'channel') {
      const entry = allChannels.find(item => item.channel.id === resultId);
      if (!entry) return null;
      return {
        element,
        target: {
          type: 'channel',
          channel: entry.channel,
          displayName: getDMDisplayNameWithSelf(entry.channel, entry.searchableNames),
          isDm: isDMChannel(entry.channel.scopeType),
        },
      };
    }
    return null;
  };

  // Accept the currently highlighted mention row (user/channel/priority/DM). Shared by Enter
  // and by Tab/ArrowRight so `from:ar` + Tab completes the mention the same way Enter would,
  // instead of falling through to tab-cycling or the ticket-preview shortcut.
  const acceptHighlightedMention = (): void => {
    // Handle 'in:' trigger - Channels + DMs (NO Users)
    if (channelTrigger === 'in:') {
      const regularChannelCount = availableRegularChannels.length;

      if (selectedMentionIndex < regularChannelCount) {
        // Selecting a regular channel
        const channelIndex = selectedMentionIndex;
        if (availableRegularChannels[channelIndex]) {
          const { channel, displayName } = availableRegularChannels[channelIndex];
          void handleMentionSelect({
            id: channel.id,
            name: displayName,
            type: MentionType.CHANNEL,
          });
        }
      } else {
        // Selecting a DM
        const dmIndex = selectedMentionIndex - regularChannelCount;
        if (availableDMs[dmIndex]) {
          const { channel, displayName } = availableDMs[dmIndex];
          void handleMentionSelect({
            id: channel.id,
            name: displayName,
            type: MentionType.CHANNEL,
          });
        }
      }
      return;
    }

    // Handle 'in:#' trigger - Channels only (NO DMs)
    if (channelTrigger === 'in:#') {
      if (availableRegularChannels[selectedMentionIndex]) {
        const { channel, displayName } = availableRegularChannels[selectedMentionIndex];
        void handleMentionSelect({
          id: channel.id,
          name: displayName,
          type: MentionType.CHANNEL,
        });
      }
      return;
    }

    // Handle 'in:@' trigger - DMs only (NOT Users!)
    if (channelTrigger === 'in:@') {
      if (availableDMs[selectedMentionIndex]) {
        const { channel, displayName } = availableDMs[selectedMentionIndex];
        void handleMentionSelect({
          id: channel.id,
          name: displayName,
          type: MentionType.CHANNEL,
        });
      }
      return;
    }

    // Handle '#' trigger - only Channels (legacy combined list)
    if (channelTrigger === '#' && availableChannels[selectedMentionIndex]) {
      const { channel, displayName } = availableChannels[selectedMentionIndex];
      void handleMentionSelect({
        id: channel.id,
        name: displayName,
        type: MentionType.CHANNEL,
      });
      return;
    }

    // Handle priority value selection (closed enum, no backend)
    if (mentionSearchType === MentionType.PRIORITY && availablePriorities[selectedMentionIndex]) {
      const priority = availablePriorities[selectedMentionIndex];
      void handleMentionSelect({
        id: priority.id,
        name: priority.name,
        type: MentionType.PRIORITY,
      });
      return;
    }

    // Handle regular user mention search (@, from:, with:, assignee:)
    if (mentionSearchType === MentionType.USER && availableUsers[selectedMentionIndex]) {
      const user = availableUsers[selectedMentionIndex];
      void handleMentionSelect({
        id: user.id,
        name: getUserDisplayName(user),
        type: MentionType.USER,
        ...(user.email ? { email: user.email } : {}),
      });
    } else if (
      mentionSearchType === MentionType.CHANNEL &&
      availableChannels[selectedMentionIndex]
    ) {
      const { channel, displayName } = availableChannels[selectedMentionIndex];
      void handleMentionSelect({
        id: channel.id,
        name: displayName,
        type: MentionType.CHANNEL,
      });
    }
  };

  const handleCommandKeyDown = (e: React.KeyboardEvent<HTMLElement>): void => {
    // A picked target renders its own UI (composer or confirm modal) — let it own all
    // keys (typing, Enter to send/confirm, its own @/# mention pickers).
    if (commandTarget) return;

    // While the ⌥↵ Actions menu is open it owns the keyboard (via its own document-level capture
    // handler); the palette must stay inert underneath.
    if (actionsMenuTarget) return;

    // ── Slash-command mode: picker / `/` discovery ───────────────────────
    // Escape is intentionally NOT handled here — it falls through so the menu
    // closes like everywhere else (Radix dismiss), rather than a hidden
    // exit-command-mode step users aren't told about.
    if (commandActive) {
      // Tab / Right accept the command-name ghost (`/cal` → `/call `).
      if ((e.key === 'Tab' || e.key === 'ArrowRight') && commandGhost.canComplete) {
        e.preventDefault();
        e.stopPropagation();
        // Metrics: this is the only place Tab is a selection gesture (command-word autocomplete).
        lastSlashSelectionRef.current = e.key === 'Tab' ? 'tab' : 'arrow_right';
        applyCommand(commandGhost.word);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        return; // no tab-cycling in command mode
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        // Metrics: keyboard selection (arrow-navigate then Enter) — primed before the
        // synthetic click triggers cmdk's onSelect and the command dispatch.
        lastSlashSelectionRef.current = 'arrow_enter';
        const active = commandRef.current?.querySelector(
          '[cmdk-item][aria-selected="true"]',
        ) as HTMLElement | null;
        active?.click();
        return;
      }
      // ArrowUp/ArrowDown fall through to the shared list-navigation below.
    }

    // ── Tab / Right Arrow: accept the highlighted mention suggestion ──────
    // e.g. `from:ar` -> Tab/Right completes to `from:Arjun Rao`, mirroring Enter's mention
    // handling. Must run before tab-cycling and the ArrowRight ticket-preview shortcut below,
    // neither of which know about mention mode.
    if ((e.key === 'Tab' || e.key === 'ArrowRight') && mentionSearchType !== null) {
      e.preventDefault();
      e.stopPropagation();
      acceptHighlightedMention();
      return;
    }

    // ── Tab / Shift+Tab: cycle filter tabs ──────────────────────────────
    // If type autocomplete suggestion is showing, Tab accepts it instead of cycling tabs
    if (e.key === 'Tab' && !(typeAutocomplete.suggestion && typeAutocomplete.match)) {
      e.preventDefault();
      e.stopPropagation();

      if (activeTab === TabType.ALL) {
        // From ALL: Tab → first tab, Shift+Tab → last tab
        const newTab = e.shiftKey ? tabs[tabs.length - 1]!.id : tabs[0]!.id;
        setActiveTab(newTab);
        onTabChange?.(newTab);
        return;
      }

      const idx = tabs.findIndex(t => t.id === activeTab);
      if (idx === -1) return; // Not found, shouldn't happen

      const next = e.shiftKey ? idx - 1 : idx + 1;

      if (next < 0 || next >= tabs.length) {
        if (inline) {
          const wrappedIdx = ((next % tabs.length) + tabs.length) % tabs.length;
          setActiveTab(tabs[wrappedIdx]!.id);
          onTabChange?.(tabs[wrappedIdx]!.id);
        } else {
          setActiveTab(TabType.ALL);
          onTabChange?.(TabType.ALL);
        }
      } else {
        setActiveTab(tabs[next]!.id);
        onTabChange?.(tabs[next]!.id);
      }
      return;
    }

    // ── Arrow key handling ───────────────────────────────────────────────
    // cmdk expects a Command.Input with cmdk-input attribute for focus management.
    // Since we use LexicalSearchInput (ContentEditable), cmdk's native arrow key
    // navigation doesn't work. We manually manage aria-selected for navigation.
    // See: https://github.com/pacocoursey/cmdk/issues/322
    // When a mention typeahead is open, its own ArrowUp/Down handler (MentionPlugin) owns
    // navigation via selectedMentionIndex — don't also move aria-selected here.
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !mentionSearchType) {
      // We drive arrow nav imperatively; cmdk's own bubble-phase ArrowDown/Up handler would move
      // its selection and light up a SECOND row. cmdk skips it when the event is defaultPrevented,
      // so prevent it here (our onKeyDownCapture runs first).
      e.preventDefault();
      const items = commandRef.current?.querySelectorAll('[cmdk-item]:not([aria-disabled="true"])');
      if (!items || items.length === 0) return;

      // Find current selection (-1 if nothing selected yet)
      const currentIndex = Array.from(items).findIndex(
        item => item.getAttribute('aria-selected') === 'true',
      );

      // Calculate next index
      let nextIndex: number;
      if (e.key === 'ArrowDown') {
        nextIndex = currentIndex < 0 ? 0 : currentIndex >= items.length - 1 ? 0 : currentIndex + 1;
      } else {
        nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
      }

      // Update aria-selected on all items
      items.forEach((item, i) => {
        item.setAttribute('aria-selected', i === nextIndex ? 'true' : 'false');
      });
      syncEnterIntent();

      // Scroll into view if needed
      items[nextIndex]?.scrollIntoView({ block: 'nearest' });

      // Suppress mouse hover highlights while navigating with keyboard.
      setSuppressHover(true);
      hasNavigatedRef.current = true;
      markNavigated();

      // Track which result is currently selected via keyboard
      const newlySelectedItem = items[nextIndex];
      // Keep the command ghost in sync when arrowing through the `/` command list.
      const navCommandWord = newlySelectedItem?.getAttribute('data-command-word');
      if (navCommandWord) setActiveCommandWord(navCommandWord);
      const resultId = newlySelectedItem?.getAttribute('data-result-id');
      const resultType = newlySelectedItem?.getAttribute('data-result-type');
      if (resultId && resultType) {
        const result = backendResults.find(r => r.type === resultType && r.id === resultId);
        setKeyboardSelectedResult(result || null);
        setHoveredResult(null); // Clear mouse hover state when using keyboard
      } else {
        setKeyboardSelectedResult(null);
      }

      // Linear-style preview: update preview when navigating to another ticket/Desk result.
      if (previewTicket) {
        const selectedResult =
          resultId && resultType
            ? backendResults.find(r => r.type === resultType && r.id === resultId)
            : undefined;
        if (selectedResult && isPreviewableTicketResult(selectedResult)) {
          if (selectedResult.id !== previewTicket.id) {
            setPreviewTicket(selectedResult);
          }
        } else {
          // Navigated to a non-previewable item, close the preview.
          setPreviewTicket(null);
        }
      }

      e.preventDefault();
      return;
    }

    // ArrowLeft: close ticket preview if open, otherwise do nothing (disable tab navigation)
    if (e.key === 'ArrowLeft') {
      if (previewTicket) {
        e.preventDefault();
        e.stopPropagation();
        setPreviewTicket(null);
      }
      return;
    }

    // ArrowRight: open ticket/Desk preview for the selected result.
    if (e.key === 'ArrowRight') {
      if (!typeAutocomplete.suggestion && !previewTicket) {
        // Check keyboard selection state (most reliable)
        const keyboardTicket = keyboardSelectedResult;
        // Check mouse hover state
        const mouseTicket = hoveredResult;

        // Use whichever is available
        const ticketToShow = isPreviewableTicketResult(keyboardTicket)
          ? keyboardTicket
          : isPreviewableTicketResult(mouseTicket)
            ? mouseTicket
            : null;

        if (ticketToShow) {
          e.preventDefault();
          e.stopPropagation();
          setPreviewTicket(ticketToShow);
          setKeyboardSelectedResult(ticketToShow);
          // Track preview click
          if (searchText.trim()) {
            const ticketIndex = backendResults.findIndex(
              r => r.type === ticketToShow.type && r.id === ticketToShow.id,
            );
            onResultClick(
              ticketToShow,
              ticketIndex >= 0 ? ticketIndex + 1 : 1,
              ticketToShow.searchContext?.channelId,
              undefined,
              true,
            );
          }
          return;
        }

        // Fallback: check DOM directly
        const selectedItem = commandRef.current?.querySelector('[cmdk-item][aria-selected="true"]');
        const resultType = selectedItem?.getAttribute('data-result-type');
        const resultId = selectedItem?.getAttribute('data-result-id');
        if (resultType && resultId) {
          const ticketIndex = backendResults.findIndex(
            r => r.type === resultType && r.id === resultId,
          );
          const ticket = ticketIndex >= 0 ? backendResults[ticketIndex] : undefined;
          if (ticket && isPreviewableTicketResult(ticket)) {
            e.preventDefault();
            e.stopPropagation();
            setPreviewTicket(ticket);
            setKeyboardSelectedResult(ticket);
            setHoveredResult(null);
            // Track preview click
            if (searchText.trim()) {
              onResultClick(
                ticket,
                ticketIndex + 1,
                ticket.searchContext?.channelId,
                undefined,
                true,
              );
            }
            return;
          }
        }
      }
      return;
    }

    // ── Tab / Right Arrow: Accept type autocomplete suggestion ───────────
    if (
      (e.key === 'Tab' || e.key === 'ArrowRight') &&
      typeAutocomplete.suggestion &&
      typeAutocomplete.match
    ) {
      e.preventDefault();
      e.stopPropagation();
      acceptTypeAutocomplete();
      return;
    }

    // ── Enter handling ───────────────────────────────────────────────────
    if (e.key !== 'Enter') return;

    // Shift+Enter → allow newline in Lexical
    if (e.shiftKey) return;

    // ⌥↵ → open the Actions menu (Message / Call) for the highlighted user/channel result. If the
    // row isn't actionable (message/ticket/etc.), fall through to normal Enter navigation.
    if (e.altKey && mentionSearchType === null) {
      const resolved = resolveActionTarget();
      if (resolved) {
        e.preventDefault();
        e.stopPropagation();
        actionsAnchorRef.current = resolved.element;
        setActionsMenuTarget(resolved.target);
        return;
      }
    }

    // If mention search is active, let the mention selection handle Enter
    if (mentionSearchType !== null) {
      e.preventDefault();
      e.stopPropagation();
      acceptHighlightedMention();
      return;
    }

    // If type autocomplete is showing, accept it on Enter
    if (typeAutocomplete.suggestion && typeAutocomplete.match) {
      e.preventDefault();
      e.stopPropagation();
      acceptTypeAutocomplete();
      // Don't return - let the normal Enter flow continue to select the active item
    }

    // Prevent Lexical newline
    e.preventDefault();
    e.stopPropagation();

    // The explicitly-selected item; when nothing is highlighted (e.g. the empty resting state,
    // which shows no highlight) fall back to the first row so Enter still opens the first result.
    const activeItem = commandRef.current?.querySelector(
      '[cmdk-item][aria-selected="true"]',
    ) as HTMLElement | null;
    const enterTarget =
      activeItem ??
      (commandRef.current?.querySelector(
        // In the popup the pinned "Show results for" row is the first item in the DOM,
        // so exclude it here — the resting Enter target is still the first real result.
        isScreenPalette
          ? '[cmdk-item]:not([aria-disabled="true"])'
          : '[cmdk-item]:not([aria-disabled="true"]):not([data-show-results-item])',
      ) as HTMLElement | null) ??
      // Zero results leave the pinned row as the only item — then it IS the Enter target,
      // or Enter would go dead with an actionable row on screen.
      (commandRef.current?.querySelector(
        '[cmdk-item][data-show-results-item]',
      ) as HTMLElement | null);

    // Screen-mode popup: Enter navigates to search screen only when no result item is selected
    // (or when the "show results for" item is selected). If a regular result is selected, click it.
    if (isScreenPalette) {
      const isShowResultsItem = enterTarget?.getAttribute('data-show-results-item') === 'true';
      if (enterTarget && !isShowResultsItem) {
        lastModifierRef.current = e.metaKey || e.ctrlKey;
        enterTarget.click();
        return;
      }
      goToSearchResults('keyboard');
      return;
    }

    // The row is invoked directly, not via a synthetic .click() — that path would fire its
    // onClick and log this keyboard activation as a click.
    if (enterTarget?.getAttribute('data-show-results-item') === 'true') {
      goToSearchResults('keyboard');
      return;
    }

    // Prime modifier ref before the synthetic .click() — a synthetic click
    // loses modifier state, so downstream selection handlers read this ref
    // instead of checking event.metaKey.
    lastModifierRef.current = e.metaKey || e.ctrlKey;
    enterTarget?.click();
  };

  // "Show results for: <chips> <query>" — the row that leaves the palette for the
  // full-screen results page. Rendered in both palettes; where it sits in the list is
  // decided at the call sites below. Never in the inline/context-selection palettes
  // (Ask AI context picker, thread-panel context) — navigating away would hijack the
  // picking flow. The old screen-only gate excluded those implicitly.
  const showResultsForRow =
    !inline &&
    !contextSelectionMode &&
    !mentionSearchType &&
    (searchText.trim() || selectedMentions.length > 0) ? (
      <Command.Item
        value='__show-results-for__'
        data-show-results-item='true'
        onPointerDown={() => {
          showResultsTriggerRef.current = 'click';
        }}
        // Both paths are wired on purpose: cmdk's onSelect covers keyboard activation,
        // and the plain onClick covers the mouse without depending on cmdk's selection
        // state. goToSearchResults de-dupes when a click fires both.
        onClick={() => goToSearchResults('click')}
        onSelect={() => goToSearchResults(showResultsTriggerRef.current)}
        className={`flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer text-sm text-foreground ${!isMobile && 'hover:bg-muted'} aria-selected:bg-muted`}
        data-track-category='SEARCH'
        data-track-name='SHOW_RESULTS_FOR'
      >
        <SearchDefault size={14} className='text-muted-foreground shrink-0' />
        <span className='flex items-center flex-wrap gap-1'>
          <span className='text-sm'>Show detailed results for:</span>
          {selectedMentions.map(m => {
            const isPriority = m.type === MentionType.PRIORITY;
            const isUser = m.type === MentionType.USER;
            const name = isPriority
              ? m.id.toLowerCase()
              : isUser
                ? getUserDisplayName(usersById.get(m.id) ?? { displayName: m.id, email: '' })
                : (() => {
                    const ch = allChannels.find(c => c.channel.id === m.id);
                    if (!ch) return m.id;
                    return formatChannelLabel(ch);
                  })();
            const prefix = m.prefix ?? (isPriority ? 'priority:' : isUser ? 'from:' : 'in:');
            return (
              <span
                key={`${m.prefix}-${m.id}`}
                className='inline-flex items-center gap-1.5 px-1.5 py-1 rounded bg-muted text-foreground text-xs font-medium h-6'
              >
                {isPriority ? (
                  <div className='flex items-center justify-center flex-shrink-0 size-4 rounded-sm'>
                    <SignalHigh
                      size={12}
                      className={PRIORITY_ICON_COLOR[m.id] ?? 'text-foreground'}
                    />
                  </div>
                ) : isUser ? (
                  <Avatar userId={m.id} size='sm' className='rounded-none flex-shrink-0 size-3' />
                ) : (
                  <div className='flex items-center justify-center flex-shrink-0 size-4 rounded-sm'>
                    <Hashtag size={12} className='text-foreground' />
                  </div>
                )}
                <span className='leading-tight'>
                  {prefix} {name}
                </span>
              </span>
            );
          })}
          {searchText.trim() && <span className='font-semibold text-sm'>{searchText.trim()}</span>}
        </span>
      </Command.Item>
    ) : null;

  const commandBody = (
    <>
      {/* Search Input — hidden (but kept mounted) during `/chat` compose so its
          `/chat <query>` text survives for the "back" button. Stays visible during the
          `/call` channel-confirm so the modal overlays the picker. */}
      <div className={cn('flex items-center shrink-0', isComposing && 'hidden')}>
        <div className='relative flex-1 flex items-center gap-2 p-3'>
          <button
            onClick={() => onOpenChange(false)}
            className='p-1 rounded-md text-foreground hover:text-muted-foreground hover:bg-accent transition-colors duration-200 sm:hidden focus-visible:outline-none focus-visible:ring-0'
            aria-label='Go back'
            data-track-category='CHANNEL_SEARCH'
            data-track-name='CLOSE_SEARCH_MENU`'
          >
            <ArrowLeft size={20} />
          </button>
          <LexicalSearchInput
            value={searchText}
            placeholder={
              openTargetLabel
                ? `${openTargetLabel} – Open`
                : hideTabs || activeTab === TabType.ALL
                  ? 'Type / for quick commands, or search'
                  : `Search ${activeTab}...`
            }
            onChange={handleEditorChange}
            currentUserID={currentUserID}
            hideSearchIcon
            onUserSearch={handleUserSearch}
            onChannelSearch={handleChannelSearch}
            onPrioritySearch={handlePrioritySearch}
            enableToTrigger={isDeskContext}
            availableUsers={availableUsers}
            availableChannels={availableChannels.map(({ channel, displayName }) => ({
              id: channel.id,
              name: displayName,
            }))}
            availablePriorities={availablePriorities}
            className='flex-1 px-1.5'
            open={open}
            mentionSearchType={mentionSearchType}
            selectedMentionIndex={selectedMentionIndex}
            setSelectedMentionIndex={setSelectedMentionIndex}
            onNavigate={markNavigated}
            hasNavigated={hasNavigated}
            onInsertMentionReady={handleInsertMentionReady}
            onPasteDetected={onPasteDetected}
            onManualKeystroke={onManualKeystroke}
            autocompleteSuffix={autocompleteSuffix ?? ''}
            onInsertTextReady={insertText => {
              insertTextRef.current = insertText;
            }}
            onSetTextReady={onSetTextReady}
            initialMention={initialMention}
            initialQuery={effectiveInitialQuery}
          />
          {/* Search/Close Icon */}
          {isMobile && (
            <button
              onClick={() => {
                if (search.trim() || searchText.trim() || selectedMentions.length > 0) {
                  setSearch('');
                  setSearchText('');
                  setSelectedMentions([]);
                  prevSearchTextRef.current = '';
                  if (inputRef.current) {
                    inputRef.current.blur();
                  }
                }
              }}
              className='p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0 flex items-center justify-center focus-visible:outline-none focus-visible:ring-0'
              aria-label={search.trim() || searchText.trim() ? 'Clear search' : 'Search'}
              data-track-category='CHANNEL_SEARCH'
              data-track-name={search.trim() || searchText.trim() ? 'ClearSearch' : 'OpenSearch'}
              data-track-metadata={JSON.stringify({ searchQuery: searchText })}
            >
              {search.trim() || searchText.trim() ? (
                <X className='w-4 h-4' />
              ) : (
                <SearchDefault className='w-4 h-4' />
              )}
            </button>
          )}
          {hideTabs && (
            <Popover.Root open={filterOpen} onOpenChange={setFilterOpen}>
              <div className='relative group/filtertip'>
                <Popover.Trigger asChild>
                  <button
                    type='button'
                    className={cn(
                      'flex items-center px-2 py-1 rounded-md text-xs font-medium border flex-shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-0',
                      filterOpen
                        ? 'bg-primary/10 border-primary/40 text-primary'
                        : 'border-border text-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                    aria-label='Show filters'
                  >
                    <FilterFunnel size={13} />
                  </button>
                </Popover.Trigger>
                <div className='pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 rounded text-xs bg-foreground text-background whitespace-nowrap opacity-0 group-hover/filtertip:opacity-100 transition-opacity z-[10001]'>
                  Show filters
                </div>
                <Popover.Portal>
                  <Popover.Content
                    side='bottom'
                    align='end'
                    sideOffset={6}
                    className='z-[10000] bg-popover border border-border rounded-lg shadow-md min-w-[160px] p-1 text-popover-foreground'
                    onOpenAutoFocus={e => e.preventDefault()}
                  >
                    {[
                      { label: 'From', prefix: 'from: ', icon: <UserDefault size={13} /> },
                      { label: 'In', prefix: 'in: ', icon: <Hashtag size={13} /> },
                      { label: 'With', prefix: 'with: ', icon: <UserDefault size={13} /> },
                      { label: 'Assignee', prefix: 'assignee: ', icon: <UserDefault size={13} /> },
                    ].map(({ label, prefix, icon }) => (
                      <button
                        key={label}
                        type='button'
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => {
                          insertTextRef.current?.(prefix);
                          setFilterOpen(false);
                        }}
                        className='flex w-full items-center gap-2 px-3 py-1.5 text-sm rounded hover:bg-accent hover:text-accent-foreground text-popover-foreground text-left focus-visible:outline-none focus-visible:bg-accent focus-visible:text-accent-foreground'
                        data-track-category='SEARCH'
                        data-track-name={`INSERT_FILTER_${label.toUpperCase()}`}
                      >
                        <span className='text-muted-foreground'>{icon}</span>
                        {label}
                      </button>
                    ))}
                    <div className='my-1 border-t border-border' />
                    {/* State-only — deliberately not mirrored to the URL: a per-click searchParams
                        update would push a browser history entry each toggle. The URL is stamped
                        once at the full-screen hand-off (buildSearchParams) instead. */}
                    <button
                      type='button'
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => setIncludeBotMessages(v => !v)}
                      className='flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm rounded hover:bg-accent hover:text-accent-foreground text-popover-foreground text-left focus-visible:outline-none focus-visible:bg-accent focus-visible:text-accent-foreground'
                      data-track-category='SEARCH'
                      data-track-name='TOGGLE_BOT_MESSAGES'
                    >
                      <span>Include bot messages</span>
                      <span
                        className={cn(
                          'w-8 h-4 rounded-full transition-colors flex-shrink-0',
                          includeBotMessages ? 'bg-primary' : 'bg-muted-foreground/30',
                        )}
                      >
                        <span
                          className={cn(
                            'block w-3 h-3 rounded-full bg-white mt-0.5 transition-transform',
                            includeBotMessages ? 'translate-x-4' : 'translate-x-0.5',
                          )}
                        />
                      </span>
                    </button>
                  </Popover.Content>
                </Popover.Portal>
              </div>
            </Popover.Root>
          )}
          {!inline &&
            !hideTabs &&
            (() => {
              // Toggles inside this filter panel. Each row shows its on/off state in the
              // hover card; only the "on" toggles drive the badge count + red button state.
              const filterRows = [
                {
                  active: onlyMyChannels,
                  label: onlyMyChannels ? 'Only my channels' : 'All channels searched',
                },
                {
                  active: includeBotMessages,
                  label: includeBotMessages ? 'Bot messages included' : 'Bot messages hidden',
                },
              ];
              const activeFilterCount = filterRows.filter(r => r.active).length;
              return (
                <Popover.Root open={searchFiltersOpen} onOpenChange={setSearchFiltersOpen}>
                  <div className='relative group/filtertip'>
                    <Popover.Trigger asChild>
                      <button
                        type='button'
                        className={cn(
                          'relative flex items-center px-2 py-1 rounded-md text-xs font-medium border flex-shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-0',
                          searchFiltersOpen || activeFilterCount > 0
                            ? 'bg-primary/10 border-primary/40 text-primary'
                            : 'border-border text-foreground hover:bg-accent hover:text-accent-foreground',
                        )}
                        aria-label='Search filters'
                      >
                        <SlidersHorizontal size={13} />
                        {activeFilterCount > 0 && (
                          <span className='absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-semibold leading-none'>
                            {activeFilterCount}
                          </span>
                        )}
                      </button>
                    </Popover.Trigger>
                    {searchFiltersOpen ? null : activeFilterCount > 0 ? (
                      <div className='pointer-events-none absolute top-full right-0 mt-2 w-max rounded-xl bg-foreground text-background shadow-xl opacity-0 group-hover/filtertip:opacity-100 transition-opacity z-[10001] text-left'>
                        {/* caret pointing up to the button */}
                        <div className='absolute -top-1.5 right-3.5 h-3 w-3 rotate-45 rounded-[2px] bg-foreground' />
                        <div className='relative px-4 py-3'>
                          <div className='mb-2 text-[11px] font-bold uppercase tracking-wider text-background/40'>
                            Filters
                          </div>
                          <div className='flex flex-col gap-2'>
                            {filterRows.map(row => (
                              <div
                                key={row.label}
                                className='flex items-center gap-2.5 text-sm whitespace-nowrap'
                              >
                                {row.active ? (
                                  <Check
                                    size={15}
                                    strokeWidth={3}
                                    className='flex-shrink-0 text-primary'
                                  />
                                ) : (
                                  <X
                                    size={15}
                                    strokeWidth={3}
                                    className='flex-shrink-0 text-background/40'
                                  />
                                )}
                                <span className={row.active ? 'font-medium' : 'text-background/60'}>
                                  {row.label}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className='pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 rounded text-xs bg-foreground text-background whitespace-nowrap opacity-0 group-hover/filtertip:opacity-100 transition-opacity z-[10001]'>
                        Search filters
                      </div>
                    )}
                    <Popover.Portal>
                      <Popover.Content
                        side='bottom'
                        align='end'
                        sideOffset={6}
                        className='z-[10000] bg-popover border border-border rounded-lg shadow-md min-w-[180px] p-1 text-popover-foreground'
                        onOpenAutoFocus={e => e.preventDefault()}
                      >
                        {/* State-only — deliberately not mirrored to the URL: a per-click searchParams
                        update would push a browser history entry each toggle. The URL is stamped
                        once at the full-screen hand-off (buildSearchParams) instead. */}
                        <button
                          type='button'
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => setOnlyMyChannels(v => !v)}
                          className='flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm rounded hover:bg-accent hover:text-accent-foreground text-popover-foreground text-left focus-visible:outline-none focus-visible:bg-accent focus-visible:text-accent-foreground'
                          data-track-category='SEARCH'
                          data-track-name='TOGGLE_ONLY_MY_CHANNELS'
                        >
                          <span>Only my channels</span>
                          <span
                            className={cn(
                              'w-8 h-4 rounded-full transition-colors flex-shrink-0',
                              onlyMyChannels ? 'bg-primary' : 'bg-muted-foreground/30',
                            )}
                          >
                            <span
                              className={cn(
                                'block w-3 h-3 rounded-full bg-white mt-0.5 transition-transform',
                                onlyMyChannels ? 'translate-x-4' : 'translate-x-0.5',
                              )}
                            />
                          </span>
                        </button>
                        <button
                          type='button'
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => setIncludeBotMessages(v => !v)}
                          className='flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm rounded hover:bg-accent hover:text-accent-foreground text-popover-foreground text-left focus-visible:outline-none focus-visible:bg-accent focus-visible:text-accent-foreground'
                          data-track-category='SEARCH'
                          data-track-name='TOGGLE_BOT_MESSAGES'
                        >
                          <span>Include bot messages</span>
                          <span
                            className={cn(
                              'w-8 h-4 rounded-full transition-colors flex-shrink-0',
                              includeBotMessages ? 'bg-primary' : 'bg-muted-foreground/30',
                            )}
                          >
                            <span
                              className={cn(
                                'block w-3 h-3 rounded-full bg-white mt-0.5 transition-transform',
                                includeBotMessages ? 'translate-x-4' : 'translate-x-0.5',
                              )}
                            />
                          </span>
                        </button>
                      </Popover.Content>
                    </Popover.Portal>
                  </div>
                </Popover.Root>
              );
            })()}
          <kbd className='px-1.5 py-0.5 text-xs font-semibold text-muted-foreground border border-border rounded flex-shrink-0 hidden sm:block'>
            Esc
          </kbd>
        </div>
      </div>

      {/* Body: results panel + optional context panel side-by-side */}
      <div className='flex flex-1 min-h-0 overflow-hidden rounded-b-2xl'>
        {/* `/chat` compose: the real message composer (mentions, formatting, attachments).
            Stop keys from bubbling to cmdk (which wraps this) so cmdk can't steal focus
            or hijack Enter/arrows — the editor and its mention dropdown handle them.
            Radix (Escape) and ProseMirror listen at document/editor level, so they still
            work. */}
        {isComposing && commandTarget && (
          <div
            role='presentation'
            className='flex-1 min-h-0 overflow-y-auto focus:outline-none focus-visible:outline-none'
            onKeyDown={e => e.stopPropagation()}
          >
            <QuickDmComposer
              target={commandTarget}
              onSent={() => {
                // Metrics: sending is what completes `/chat` — mark the session invoked so its
                // end reason is 'invoke'. Escaping the composer without sending stays 'abandon'.
                slashInvokedRef.current = true;
                onOpenChange(false);
              }}
              onBack={clearTarget}
            />
          </div>
        )}
        {/* Tabs, Results, Footer Container - modal overlays everything below search input */}
        <div
          className={cn(
            'relative flex-1 flex flex-col min-h-0 overflow-x-hidden rounded-b-2xl',
            isComposing && 'hidden',
          )}
          role='presentation'
          data-track-category='CHANNEL_SEARCH'
          data-track-name='ClickSearchResultsArea'
          data-track-metadata={JSON.stringify({ hasResults })}
          onClick={() => {
            // Blur input when clicking anywhere in this container
            if (inputRef.current) {
              inputRef.current.blur();
            }
          }}
          onKeyDown={e => {
            // Blur input when pressing Enter or Space in this container
            if ((e.key === 'Enter' || e.key === ' ') && inputRef.current) {
              inputRef.current.blur();
            }
          }}
        >
          {/* Tabs - hidden when bot is selected or hideTabs is true */}
          <div
            className={`shrink-0 overflow-x-auto no-scrollbar px-4 py-1.5 focus:outline-none focus-visible:outline-none ${isMobile ? 'mx-1' : ''} ${hideTabs ? 'hidden' : ''}`}
          >
            <Tabs.Root value={activeTab}>
              <Tabs.List
                className='flex items-center justify-start gap-2'
                onKeyDownCapture={e => {
                  // Capture arrow keys before Radix UI's internal handler
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
              >
                {tabs.map(tab => (
                  <Tabs.Trigger
                    key={tab.id}
                    value={tab.id}
                    onKeyDown={e => {
                      // Disable left/right arrow key navigation between tabs
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        e.preventDefault();
                      }
                    }}
                    asChild
                  >
                    <button
                      onClick={e => {
                        if (activeTab === tab.id) {
                          if (!inline) {
                            setActiveTab(TabType.ALL);
                            onTabChange?.(TabType.ALL);
                          }
                          // In inline mode, clicking the active tab does nothing
                        } else {
                          setActiveTab(tab.id);
                          onTabChange?.(tab.id);
                        }
                        // Blur input when clicking tabs
                        if (inputRef.current) {
                          inputRef.current.blur();
                        }
                        e.currentTarget.scrollIntoView({
                          behavior: 'smooth',
                          block: 'nearest',
                          inline: 'center',
                        });
                      }}
                      className={cn(
                        // No focus ring: Tab is bound to tab-cycling here, so a click-focused
                        // trigger would paint a ring on the next Tab press. The active tab's
                        // bg-accent treatment already communicates position.
                        'flex items-center justify-center gap-2 px-3 py-1.5 text-sm whitespace-nowrap rounded-md transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-0',
                        activeTab === tab.id
                          ? 'bg-accent text-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        isMobile && 'text-base w-fit h-9 px-3',
                      )}
                      data-track-category='CHANNEL_SEARCH'
                      data-track-name='SELECT_SEARCH_TAB'
                      data-track-metadata={JSON.stringify({ tab: tab.id })}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </Tabs.Root>
          </div>

          {/* Results */}
          <Command.List
            className={cn(
              // flex-1 only — the shell owns the height (md:h-[72vh]); a second cap here
              // would leave the footer floating short of the bottom on tall viewports.
              // cmdk gives the list tabIndex={-1} + role="listbox", and it's a scroll
              // container (Chrome can keyboard-focus scrollers) — both outline. Row
              // position is communicated by aria-selected, never by a ring here.
              'flex-1 overflow-y-auto px-4 pt-3 pb-6 focus:outline-none focus-visible:outline-none',
              '[&_[cmdk-item]]:scroll-mb-[30px]',
              // The pinned "Show results for" row is exempt: it sits where the cursor
              // rests when the palette opens, and its first click must land even before
              // any mousemove clears suppressHover. Result rows keep the guard.
              suppressHover && '[&_[cmdk-item]:not([data-show-results-item])]:pointer-events-none',
            )}
            ref={el => {
              if (el) {
                setScrollContainer(el);
              }
            }}
          >
            {commandActive || seedCommandMode ? (
              <SlashCommandPalette command={slash} onItemMouseDown={handleItemMouseDown} />
            ) : (
              <>
                {/* Popup palette: the row is pinned here, directly under the tabs, so it
                    sits in the same place no matter what matched. It is skipped by the
                    first-row auto-select, so the top result keeps the Enter target. */}
                {!isScreenPalette && showResultsForRow}

                {/* Best local matches pinned to the top of the list — both popup and
                    screen. Starred leads; the strong-matched user/channel then becomes
                    the default Enter target (Slack-style). In screen mode these sit
                    above the "Show results for" row below. */}
                {hoistStarred && renderSearchStarredSection()}
                {hoistUser && renderSearchUsersSection()}
                {hoistChannel && renderSearchChannelsSection()}

                {/* Screen palette: the row stays below the hoisted best matches, which
                    own the Enter target there. */}
                {isScreenPalette && showResultsForRow}

                {/* Mention Suggestions - Show when mention search is active */}
                {mentionSearchType && (
                  <>
                    {/* 'in:' trigger - Show Channels + DMs (NO Users) */}
                    {channelTrigger === 'in:' && (
                      <>
                        {/* 1. Channels Section */}
                        {availableRegularChannels.length > 0 && (
                          <Command.Group
                            heading='Channels'
                            className='[&_[cmdk-group-heading]]:px-2  [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-["Geist_Mono"]'
                          >
                            {availableRegularChannels.map(({ channel, displayName }, index) => {
                              return (
                                <Command.Item
                                  key={channel.id}
                                  value={`mention-channel-${channel.id}`}
                                  onSelect={() => {
                                    void handleMentionSelect({
                                      id: channel.id,
                                      name: displayName,
                                      type: MentionType.CHANNEL,
                                    });
                                  }}
                                  onMouseEnter={() => {
                                    selectMention(index);
                                  }}
                                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-150 mt-1.5 ${
                                    index === selectedMentionIndex ? 'cmdk-active-row' : ''
                                  } ${!isMobile && 'active:bg-muted active:scale-[0.98]'}`}
                                  style={{ WebkitTapHighlightColor: 'transparent' }}
                                >
                                  <div className='flex items-center justify-center h-4 w-5 flex-shrink-0 text-muted-foreground'>
                                    {getChannelIcon(channel)}
                                  </div>
                                  <div className='flex-1 min-w-0'>
                                    <div className='text-[15px] leading-[1.2] tracking-[-0.1px] text-foreground truncate'>
                                      {displayName}
                                    </div>
                                  </div>
                                </Command.Item>
                              );
                            })}
                          </Command.Group>
                        )}
                        {/* 2. DMs Section (includes Group DMs) */}
                        {availableDMs.length > 0 && (
                          <Command.Group
                            heading='DMs'
                            className='[&_[cmdk-group-heading]]:px-2  [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-["Geist_Mono"]'
                          >
                            {availableDMs.map(({ channel, displayName }, index) => {
                              // Calculate index offset for keyboard navigation
                              const channelCount = availableRegularChannels.length;
                              const adjustedIndex = channelCount + index;
                              return (
                                <Command.Item
                                  key={channel.id}
                                  value={`mention-dm-${channel.id}`}
                                  onSelect={() => {
                                    void handleMentionSelect({
                                      id: channel.id,
                                      name: displayName,
                                      type: MentionType.CHANNEL,
                                    });
                                  }}
                                  onMouseEnter={() => {
                                    selectMention(adjustedIndex);
                                  }}
                                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-150 mt-1.5 ${
                                    adjustedIndex === selectedMentionIndex ? 'cmdk-active-row' : ''
                                  } ${!isMobile && 'active:bg-muted active:scale-[0.98]'}`}
                                  style={{ WebkitTapHighlightColor: 'transparent' }}
                                >
                                  <div className='flex items-center justify-center h-4 w-5 flex-shrink-0 text-muted-foreground'>
                                    {getChannelIcon(channel)}
                                  </div>
                                  <div className='flex-1 min-w-0'>
                                    <div className='text-[15px] leading-[1.2] tracking-[-0.1px] text-foreground truncate'>
                                      {displayName}
                                    </div>
                                  </div>
                                </Command.Item>
                              );
                            })}
                          </Command.Group>
                        )}
                        {/* Empty state for in: when nothing matches */}
                        {availableRegularChannels.length === 0 &&
                          availableDMs.length === 0 &&
                          mentionSearchQuery && (
                            <Command.Empty className='py-6 text-center text-sm text-muted-foreground'>
                              No results found for &quot;{mentionSearchQuery}&quot;
                            </Command.Empty>
                          )}

                        {/* Regular USER mention search (@, from:, assignee:) - Show only Users */}
                        {mentionSearchType === MentionType.USER &&
                          (userTrigger === '@' ||
                            userTrigger === 'from:' ||
                            userTrigger === 'to:' ||
                            userTrigger === 'assignee:') &&
                          availableUsers.length > 0 && (
                            <Command.Group
                              heading='Users'
                              className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono'
                            >
                              {availableUsers.map((user, index) => {
                                const isDeactivated = isUserDeactivated(user);
                                return (
                                  <Command.Item
                                    key={user.id}
                                    value={`mention-user-${user.id}`}
                                    onSelect={() => {
                                      void handleMentionSelect({
                                        id: user.id,
                                        name: getUserDisplayName(user),
                                        type: MentionType.USER,
                                        ...(user.email ? { email: user.email } : {}),
                                      });
                                    }}
                                    onMouseEnter={() => {
                                      selectMention(index);
                                    }}
                                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-150 mt-1.5 ${
                                      index === selectedMentionIndex ? 'cmdk-active-row' : ''
                                    } ${!isMobile && 'active:bg-muted active:scale-[0.98]'}`}
                                    style={{ WebkitTapHighlightColor: 'transparent' }}
                                  >
                                    <Avatar userId={user.id} size='xs' />
                                    <div className='flex-1 min-w-0 flex items-center gap-2'>
                                      <span
                                        className={`min-w-0 truncate text-[15px] leading-[1.2] tracking-[-0.1px] ${isDeactivated ? 'text-muted-foreground' : 'text-foreground'}`}
                                      >
                                        {getUserDisplayName(user)}
                                      </span>
                                      {isDeactivated && (
                                        <span className='shrink-0 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded'>
                                          Deactivated
                                        </span>
                                      )}
                                      {user.email && (
                                        <span className='min-w-0 truncate text-xs text-muted-foreground'>
                                          {user.email}
                                        </span>
                                      )}
                                    </div>
                                  </Command.Item>
                                );
                              })}
                            </Command.Group>
                          )}
                        {mentionSearchType === MentionType.USER &&
                          (userTrigger === '@' ||
                            userTrigger === 'from:' ||
                            userTrigger === 'to:' ||
                            userTrigger === 'assignee:') &&
                          availableUsers.length === 0 &&
                          mentionSearchQuery && (
                            <Command.Empty className='py-6 text-center text-sm text-muted-foreground'>
                              No users found for &quot;{mentionSearchQuery}&quot;
                            </Command.Empty>
                          )}
                      </>
                    )}

                    {/* 'in:#' trigger - Show Channels only (NO DMs, NO Users) */}
                    {channelTrigger === 'in:#' && (
                      <>
                        {/* Channels Section */}
                        {availableRegularChannels.length > 0 && (
                          <Command.Group
                            heading='Channels'
                            className='[&_[cmdk-group-heading]]:px-2  [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-["Geist_Mono"]'
                          >
                            {availableRegularChannels.map(({ channel, displayName }, index) => {
                              return (
                                <Command.Item
                                  key={channel.id}
                                  value={`mention-channel-${channel.id}`}
                                  onSelect={() => {
                                    void handleMentionSelect({
                                      id: channel.id,
                                      name: displayName,
                                      type: MentionType.CHANNEL,
                                    });
                                  }}
                                  onMouseEnter={() => {
                                    selectMention(index);
                                  }}
                                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-150 mt-1.5 ${
                                    index === selectedMentionIndex ? 'cmdk-active-row' : ''
                                  } ${!isMobile && 'active:bg-muted active:scale-[0.98]'}`}
                                  style={{ WebkitTapHighlightColor: 'transparent' }}
                                >
                                  <div className='flex items-center justify-center h-4 w-5 flex-shrink-0 text-muted-foreground'>
                                    {getChannelIcon(channel)}
                                  </div>
                                  <div className='flex-1 min-w-0'>
                                    <div className='text-[15px] leading-[1.2] tracking-[-0.1px] text-foreground truncate'>
                                      {displayName}
                                    </div>
                                  </div>
                                </Command.Item>
                              );
                            })}
                          </Command.Group>
                        )}
                        {/* Empty state */}
                        {availableRegularChannels.length === 0 && mentionSearchQuery && (
                          <Command.Empty className='py-6 text-center text-sm text-muted-foreground'>
                            No channels found for &quot;{mentionSearchQuery}&quot;
                          </Command.Empty>
                        )}
                      </>
                    )}

                    {/* 'in:@' trigger - Show DMs only (NOT Users!) */}
                    {channelTrigger === 'in:@' && availableDMs.length > 0 && (
                      <Command.Group
                        heading='DMs'
                        className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-["Geist_Mono"]'
                      >
                        {availableDMs.map(({ channel, displayName }, index) => (
                          <Command.Item
                            key={channel.id}
                            value={`mention-dm-${channel.id}`}
                            onSelect={() => {
                              void handleMentionSelect({
                                id: channel.id,
                                name: displayName,
                                type: MentionType.CHANNEL,
                              });
                            }}
                            onMouseEnter={() => {
                              selectMention(index);
                            }}
                            className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-150 mt-1.5 ${
                              index === selectedMentionIndex ? 'cmdk-active-row' : ''
                            } ${!isMobile && 'active:bg-muted active:scale-[0.98]'}`}
                            style={{ WebkitTapHighlightColor: 'transparent' }}
                          >
                            <div className='flex items-center justify-center h-4 w-5 flex-shrink-0 text-muted-foreground'>
                              {getChannelIcon(channel)}
                            </div>
                            <div className='flex-1 min-w-0'>
                              <div className='text-[15px] leading-[1.2] tracking-[-0.1px] text-foreground truncate'>
                                {displayName}
                              </div>
                            </div>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                    {channelTrigger === 'in:@' &&
                      availableDMs.length === 0 &&
                      mentionSearchQuery && (
                        <Command.Empty className='py-6 text-center text-sm text-muted-foreground'>
                          No DMs found for &quot;{mentionSearchQuery}&quot;
                        </Command.Empty>
                      )}

                    {/* '#' trigger - Show only Channels (Slack-style quick switcher) */}
                    {channelTrigger === '#' && availableChannels.length > 0 && (
                      <Command.Group
                        heading='Channels'
                        className='[&_[cmdk-group-heading]]:px-2  [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-["Geist_Mono"]'
                      >
                        {availableChannels.map(({ channel, displayName }, index) => {
                          return (
                            <Command.Item
                              key={channel.id}
                              value={`mention-channel-${channel.id}`}
                              onSelect={() => {
                                void handleMentionSelect({
                                  id: channel.id,
                                  name: displayName,
                                  type: MentionType.CHANNEL,
                                });
                              }}
                              onMouseEnter={() => {
                                selectMention(index);
                              }}
                              className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-150 mt-1.5 ${
                                index === selectedMentionIndex ? 'cmdk-active-row' : ''
                              } ${!isMobile && 'active:bg-muted active:scale-[0.98]'}`}
                              style={{ WebkitTapHighlightColor: 'transparent' }}
                            >
                              <div className='flex items-center justify-center h-4 w-5 flex-shrink-0 text-muted-foreground'>
                                {getChannelIcon(channel)}
                              </div>
                              <div className='flex-1 min-w-0'>
                                <div className='text-[15px] leading-[1.2] tracking-[-0.1px] text-foreground truncate'>
                                  {displayName}
                                </div>
                              </div>
                            </Command.Item>
                          );
                        })}
                      </Command.Group>
                    )}
                    {channelTrigger === '#' &&
                      availableChannels.length === 0 &&
                      mentionSearchQuery && (
                        <Command.Empty className='py-6 text-center text-sm text-muted-foreground'>
                          No channels found for &quot;{mentionSearchQuery}&quot;
                        </Command.Empty>
                      )}

                    {/* Regular USER mention search (@, from:, with:, assignee:) - Show only Users */}
                    {mentionSearchType === MentionType.USER &&
                      (userTrigger === '@' ||
                        userTrigger === 'from:' ||
                        userTrigger === 'to:' ||
                        userTrigger === 'with:' ||
                        userTrigger === 'assignee:') &&
                      availableUsers.length > 0 && (
                        <Command.Group
                          heading='Users'
                          className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono'
                        >
                          {availableUsers.map((user, index) => {
                            const isDeactivated = isUserDeactivated(user);
                            return (
                              <Command.Item
                                key={user.id}
                                value={`mention-user-${user.id}`}
                                onSelect={() => {
                                  void handleMentionSelect({
                                    id: user.id,
                                    name: getUserDisplayName(user),
                                    type: MentionType.USER,
                                    ...(user.email ? { email: user.email } : {}),
                                  });
                                }}
                                onMouseEnter={() => {
                                  selectMention(index);
                                }}
                                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-150 mt-1.5 ${
                                  index === selectedMentionIndex ? 'cmdk-active-row' : ''
                                } ${!isMobile && 'active:bg-muted active:scale-[0.98]'}`}
                                style={{ WebkitTapHighlightColor: 'transparent' }}
                              >
                                <Avatar userId={user.id} size='xs' />
                                <div className='flex-1 min-w-0 flex items-center gap-2'>
                                  <span
                                    className={`min-w-0 truncate text-[15px] leading-[1.2] tracking-[-0.1px] ${isDeactivated ? 'text-muted-foreground' : 'text-foreground'}`}
                                  >
                                    {getUserDisplayName(user)}
                                  </span>
                                  {isDeactivated && (
                                    <span className='shrink-0 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded'>
                                      Deactivated
                                    </span>
                                  )}
                                  {user.email && (
                                    <span className='min-w-0 truncate text-xs text-muted-foreground'>
                                      {user.email}
                                    </span>
                                  )}
                                </div>
                              </Command.Item>
                            );
                          })}
                        </Command.Group>
                      )}
                    {mentionSearchType === MentionType.USER &&
                      (userTrigger === '@' ||
                        userTrigger === 'from:' ||
                        userTrigger === 'to:' ||
                        userTrigger === 'with:' ||
                        userTrigger === 'assignee:') &&
                      availableUsers.length === 0 &&
                      mentionSearchQuery && (
                        <Command.Empty className='py-6 text-center text-sm text-muted-foreground'>
                          No users found for &quot;{mentionSearchQuery}&quot;
                        </Command.Empty>
                      )}

                    {/* 'priority:' trigger — the closed TicketPriority value list */}
                    {mentionSearchType === MentionType.PRIORITY &&
                      availablePriorities.length > 0 && (
                        <Command.Group
                          heading='Priority'
                          className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono'
                        >
                          {availablePriorities.map((priority, index) => (
                            <Command.Item
                              key={priority.id}
                              value={`mention-priority-${priority.id}`}
                              onSelect={() => {
                                void handleMentionSelect({
                                  id: priority.id,
                                  name: priority.name,
                                  type: MentionType.PRIORITY,
                                });
                              }}
                              onMouseEnter={() => {
                                selectMention(index);
                              }}
                              className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-150 mt-1.5 ${
                                index === selectedMentionIndex ? 'cmdk-active-row' : ''
                              } ${!isMobile && 'active:bg-muted active:scale-[0.98]'}`}
                              style={{ WebkitTapHighlightColor: 'transparent' }}
                            >
                              <div
                                className={`flex items-center justify-center h-4 w-5 flex-shrink-0 ${
                                  PRIORITY_ICON_COLOR[priority.id] ?? 'text-muted-foreground'
                                }`}
                              >
                                <SignalHigh size={16} />
                              </div>
                              <div className='flex-1 min-w-0'>
                                <div className='text-[15px] leading-[1.2] tracking-[-0.1px] text-foreground truncate'>
                                  {priority.name}
                                </div>
                              </div>
                            </Command.Item>
                          ))}
                        </Command.Group>
                      )}
                  </>
                )}

                {/* ─── Inline context picker: locked + recent sections ─────────────────── */}
                {inline &&
                  contextSelectionMode &&
                  !mentionSearchType &&
                  activeTab !== TabType.ALL && (
                    <>
                      {/* Recent items — shown when search box is empty, read directly from localStorage */}
                      {!searchText.trim() && loadRecents(activeTab).length > 0 && (
                        <Command.Group
                          heading='Recent'
                          className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono'
                        >
                          {loadRecents(activeTab).map(item => {
                            const isChannelTab = activeTab === TabType.CHANNELS;
                            const subApp =
                              activeTab === TabType.CANVAS
                                ? 'canvas'
                                : activeTab === TabType.CALL || activeTab === TabType.RECORDING
                                  ? 'transcript'
                                  : undefined;
                            const resultType: 'channel' | 'ticket' | 'attachment' = isChannelTab
                              ? 'channel'
                              : activeTab === TabType.TICKETS
                                ? 'ticket'
                                : 'attachment';
                            const compositeId = `${resultType}-${item.id}`;
                            const isSelected = contextItems.some(c => c.id === compositeId);
                            return (
                              <Command.Item
                                key={item.id}
                                value={`recent-${activeTab}-${item.id}`}
                                onSelect={() => {
                                  if (!onContextItemToggle) return;
                                  onContextItemToggle({
                                    id: compositeId,
                                    title: item.title,
                                    type: resultType,
                                    url: isChannelTab ? `/chat/dir/${item.id}` : '#',
                                    searchResult: {
                                      id: item.id,
                                      type: resultType,
                                      title: item.title,
                                      subtitle: '',
                                      relevanceScore: 0,
                                      metadata: {},
                                      ...(subApp
                                        ? { searchContext: { subApp, attachmentId: item.id } }
                                        : {}),
                                    } as DisplaySearchResult,
                                  });
                                }}
                                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer mt-1.5 aria-selected:bg-accent ${!isMobile && 'hover:bg-accent'}`}
                                style={{ WebkitTapHighlightColor: 'transparent' }}
                              >
                                {isChannelTab &&
                                  (item.isPrivate ? (
                                    <Lock02Close
                                      size={16}
                                      className='text-muted-foreground flex-shrink-0'
                                    />
                                  ) : (
                                    <Hashtag
                                      size={16}
                                      className='text-muted-foreground flex-shrink-0'
                                    />
                                  ))}
                                <span className='flex-1 min-w-0 text-left text-[15px] leading-[1.2] tracking-[-0.1px] text-foreground truncate'>
                                  {item.title}
                                </span>
                                {isSelected && (
                                  <span className='flex-shrink-0 flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground'>
                                    <CheckTickSingle size={10} />
                                  </span>
                                )}
                              </Command.Item>
                            );
                          })}
                        </Command.Group>
                      )}
                    </>
                  )}

                {showEmptyState && !mentionSearchType && (
                  <Command.Empty className='py-6 text-center text-sm text-muted-foreground'>
                    No results found for &quot;{search}&quot;
                  </Command.Empty>
                )}

                {/* Local results (channels, users, DMs) are computed client-side and
                    don't depend on the backend search — keep rendering them even
                    when Vespa fails. The backend-results section below is the part
                    that gracefully degrades to empty when there's an error. The
                    error notice itself is rendered after the local results below. */}
                {error && <div className='p-3 text-sm text-destructive'>{error}</div>}

                {!showEmptyState && !mentionSearchType && (
                  <>
                    {/* When searching, ordered results: Starred, Users, Group DMs, Channels, Messages, Tickets */}
                    {/* When a from:/in: chip is active, backend results appear first. Local sections
                        self-suppress via showGroupedUsers/showGroupedLocalResults when a filter makes
                        their category irrelevant (e.g. with:/from: → nothing renders). */}
                    {searchText.trim() || typeFilter ? (
                      <>
                        {hasFromOrInFilter ? (
                          <>
                            {backendResults.length > 0 && renderSearchBackendResults()}
                            {renderSearchLocalSections()}
                          </>
                        ) : (
                          <>
                            {/* A section pinned to the top (above) is skipped here to
                            avoid a double-render. */}
                            {renderSearchLocalSections(!hoistStarred, !hoistUser, !hoistChannel)}
                            {backendResults.length > 0 && renderSearchBackendResults()}
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        {hasFromOrInFilter ? (
                          <>
                            {activeTab !== TabType.CHANNELS &&
                              backendResults.length > 0 &&
                              renderDefaultBackendResults()}
                            {renderBrowseLocalChannels()}
                          </>
                        ) : (
                          <>
                            {renderBrowseLocalChannels()}
                            {/* People tab browse: rank by affinity (rankUsersWithMfu) like the
                                search branch, instead of the raw, unranked backend user list. */}
                            {activeTab === TabType.USERS
                              ? renderSearchUsersSection()
                              : activeTab !== TabType.CHANNELS &&
                                backendResults.length > 0 &&
                                renderDefaultBackendResults()}
                          </>
                        )}
                      </>
                    )}
                  </>
                )}

                {error && !mentionSearchType && (
                  <div className='px-3 py-2 text-sm text-red-600'>
                    Search is unavailable. Only People and Channels are accessible.
                  </div>
                )}
              </>
            )}
          </Command.List>

          {/* Desk merge action bar */}
          {deskMergeMode && (
            <div className='shrink-0 border-t border-border/40 bg-muted/30 px-4 py-3 flex items-center justify-between'>
              {selectedMergeTickets.size === 0 ? (
                <>
                  <span className='text-sm text-muted-foreground'>
                    Click tickets to select them for merging
                  </span>
                  <Button
                    variant='secondary'
                    size='sm'
                    onClick={toggleDeskMergeMode}
                    data-track-category='SEARCH'
                    data-track-name='TOGGLE_DESK_MERGE_MODE'
                    className={MERGE_BAR_BUTTON_NO_RING}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span className='text-sm font-medium'>
                    {selectedMergeTickets.size} ticket{selectedMergeTickets.size !== 1 ? 's' : ''}{' '}
                    selected
                  </span>
                  <div className='flex items-center gap-2'>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={clearDeskMergeSelection}
                      data-track-category='SEARCH'
                      data-track-name='CLEAR_DESK_MERGE_SELECTION'
                      className={MERGE_BAR_BUTTON_NO_RING}
                    >
                      Clear
                    </Button>
                    <Button
                      variant='secondary'
                      size='sm'
                      onClick={toggleDeskMergeMode}
                      data-track-category='SEARCH'
                      data-track-name='TOGGLE_DESK_MERGE_MODE'
                      className={MERGE_BAR_BUTTON_NO_RING}
                    >
                      Cancel
                    </Button>
                    <Button
                      size='sm'
                      disabled={selectedMergeTickets.size < 2}
                      onClick={() => setShowMergeDialog(true)}
                      data-track-category='SEARCH'
                      data-track-name='OPEN_MERGE_DIALOG'
                      className={MERGE_BAR_BUTTON_NO_RING}
                    >
                      Merge {selectedMergeTickets.size > 0 ? `(${selectedMergeTickets.size})` : ''}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Context Panel - shown on right side in context selection mode */}
        {!inline && contextSelectionMode && (
          <ThreadContextPanel
            items={contextItems}
            onRemove={id => {
              const item = contextItems.find(c => c.id === id);
              if (item && onContextItemToggle) onContextItemToggle(item);
            }}
            onConfirm={() => onContextSelectionConfirm?.()}
          />
        )}

        {!inline && previewTicket && (
          <TicketPreviewPanel ticket={previewTicket} onClose={() => setPreviewTicket(null)} />
        )}
      </div>
      {/* end body flex row */}

      {/* Footer - outside body flex so TicketPreviewPanel only spans results area. Hidden while the
          `/chat` composer is open (isComposing): its hints (Open/Navigate/Actions/Ask AI) are about
          the results list, which the composer replaces — you're typing a message, not navigating. */}
      {!inline && !isMobile && !isComposing && (
        <div className='relative px-6 py-4 text-sm font-medium text-muted-foreground flex items-center justify-between shrink-0 rounded-b-2xl'>
          {/* Fade the scrolling results into the footer (replaces the hard top border) */}
          <div className='pointer-events-none absolute inset-x-0 bottom-full h-[30px] bg-gradient-to-t from-card to-transparent' />
          {/* Left: slash-command hint for Ask AI */}
          <span className='flex items-center gap-2.5'>
            <span className='flex items-center justify-center px-1.5 py-1 bg-muted rounded-lg leading-none'>
              /
            </span>
            <span>Ask AI</span>
          </span>
          <div className='flex items-center gap-6'>
            {deskMergeEnabled &&
              activeTab === TabType.DESK &&
              !deskMergeMode &&
              hasDeskChannelFilter && (
                <button
                  onClick={toggleDeskMergeMode}
                  className='flex gap-2 items-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-0'
                  data-track-category='COMMAND_MENU'
                  data-track-name='TOGGLE_DESK_MERGE_MODE'
                >
                  <span>Select & Merge</span>
                </button>
              )}
            <span className='flex gap-2.5 items-center'>
              <span>Open</span>
              <span className='p-1 bg-muted rounded-lg'>
                <ArrowTurnDownLeft size={10} />
              </span>
            </span>
            {/* Navigate hint (↑↓). Shown when the selected row isn't ⌥↵-actionable — a message/
                ticket/file/desk row, or nothing selected — so the footer always offers a next step.
                Mutually exclusive with the Actions hint below (which covers user/channel rows). */}
            {!activeItemActionable && (
              <span className='flex gap-2.5 items-center'>
                <span>Navigate</span>
                <span className='flex items-center gap-1'>
                  <span className='p-1 bg-muted rounded-lg'>
                    <ArrowUp size={10} />
                  </span>
                  <span className='p-1 bg-muted rounded-lg'>
                    <ArrowDown size={10} />
                  </span>
                </span>
              </span>
            )}
            {/* Actions menu hint (⌥↵). Shown whenever the selected row is a user/channel — whether
                auto-selected on search or arrowed/hovered — since ⌥↵ acts on it. Non-actionable rows
                (messages/tickets/files/desk) fall to the Navigate hint above. */}
            {activeItemActionable && (
              <span className='flex gap-2.5 items-center'>
                <span>Actions</span>
                <span className='flex items-center gap-1 px-1.5 py-1 bg-muted rounded-lg leading-none'>
                  <span>⌥</span>
                  <ArrowTurnDownLeft size={10} />
                </span>
              </span>
            )}
            {previewTicket ? (
              <span className='flex gap-2.5 items-center'>
                <span className='flex gap-1'>
                  <span className='p-1 bg-muted rounded-lg'>
                    <ArrowLeft size={12} />
                  </span>
                </span>
                <span>Close</span>
              </span>
            ) : activeTab === TabType.TICKETS ||
              activeTab === TabType.DESK ||
              (activeTab === TabType.ALL &&
                (isPreviewableTicketResult(hoveredResult) ||
                  isPreviewableTicketResult(keyboardSelectedResult))) ? (
              <span className='flex gap-2.5 items-center'>
                <span className='flex gap-1'>
                  <span className='p-1 bg-muted rounded-lg'>
                    <ArrowRight size={12} />
                  </span>
                </span>
                <span>Quick look</span>
              </span>
            ) : null}
          </div>
        </div>
      )}

      {/* Desk Ticket Merge Dialog */}
      <MergeTicketsDialog
        open={showMergeDialog}
        onOpenChange={setShowMergeDialog}
        tickets={Array.from(selectedMergeTickets.entries()).map(([ticketId, result]) => ({
          id: ticketId,
          title: result.title,
          xyneId: result.searchContext?.xyneId ?? null,
          createdAt: result.metadata?.timestamp
            ? new Date(result.metadata.timestamp).getTime()
            : null,
        }))}
        onMerge={async (parentTicketId, ticketIds) => {
          try {
            // ticketIds comes pre-filtered from the dialog (archived tickets excluded).
            const ticketsToMerge = ticketIds.filter(id => id !== parentTicketId);
            await Promise.all(
              ticketsToMerge.map(ticketId =>
                apiInstance.post(`/tickets/${ticketId}/merge`, { targetTicketId: parentTicketId }),
              ),
            );

            setShowMergeDialog(false);
            setDeskMergeMode(false);
            setSelectedMergeTickets(new Map());

            const parentResult = selectedMergeTickets.get(parentTicketId);
            if (parentResult) {
              await navigateToSearchResult(parentResult, navigate, channelData || []);
            }
            onOpenChange(false);

            toast.success(`${ticketsToMerge.length + 1} tickets merged successfully`);
          } catch (err) {
            logger.error(LogEvent.FRONTEND_ERROR, {
              type: 'migrated_console_error',
              message: String('Merge failed:'),
              error: err,
            });
            toast.error('Failed to merge tickets. Please try again.');
          }
        }}
      />
    </>
  );

  if (inline) {
    return (
      <Command
        ref={attachCommandRef}
        // Selection is managed imperatively (aria-selected via setAttribute) because cmdk's
        // arrow-nav needs a Command.Input we don't use. Pin cmdk's value to a sentinel that
        // matches no item so it never marks one selected too — otherwise it latches a result row
        // and a SECOND highlight appears alongside the manually-selected one.
        value='__none__'
        onValueChange={() => undefined}
        data-nav-active={hasNavigated ? 'true' : undefined}
        data-mention-active={mentionSearchType ? 'true' : undefined}
        shouldFilter={false}
        // cmdk renders its root with tabIndex={-1}, so it can take programmatic focus
        // and paint an outline around the whole palette — suppress it (container, not
        // a control). Same on the dialog branch below and on Command.List.
        className='w-full h-full flex flex-col focus:outline-none focus-visible:outline-none'
        onMouseMove={() => {
          if (suppressHover) {
            commandRef.current
              ?.querySelectorAll('[cmdk-item][aria-selected="true"]')
              .forEach(item => {
                item.setAttribute('aria-selected', 'false');
              });
            setSuppressHover(false);
          }
          reconcileHoverSelection();
        }}
        onKeyDownCapture={handleCommandKeyDown}
      >
        {commandConfirmations}
        {commandBody}
      </Command>
    );
  }

  // Manual composition of cmdk's Command.Dialog (Radix Dialog > Command): cmdk
  // doesn't forward onCloseAutoFocus to Dialog.Content, which we need so that a
  // selection that navigated (e.g. cmd+K → DM) leaves focus with the
  // destination screen instead of restoring it to the pre-open element.
  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay />
          <DialogPrimitive.Content
            // Radix gives Content tabIndex={-1} and focuses it on open; opening via
            // Cmd+K means the browser treats that as keyboard focus and outlines the
            // whole palette. It's a container, never a navigation position.
            className='focus:outline-none focus-visible:outline-none'
            onInteractOutside={event => {
              // Keep the palette open when the interaction comes from a composer
              // overlay portaled to <body> (canvas/emoji modals). They live
              // outside this dialog's DOM subtree, so Radix would otherwise read
              // the click as "outside" and dismiss everything. Mirrors the
              // sonner-toast guard in Dialog.tsx.
              const target = (event.detail?.originalEvent?.target ?? null) as Element | null;
              if (target?.closest?.('[data-overlay-portal]')) {
                event.preventDefault();
              }
            }}
            onEscapeKeyDown={event => {
              // While the ⌥↵ Actions menu is open, Escape closes only it — never the palette.
              if (actionsMenuTarget !== null) {
                event.preventDefault();
                setActionsMenuTarget(null);
                return;
              }
              // While focus is inside such an overlay, Escape should close only
              // the overlay (it owns that via OverlayPortal), not the palette.
              // Scoped to the focused target — not a global query — so the
              // palette's own Escape is unchanged when no overlay is focused.
              const target = event.target as Element | null;
              if (target?.closest?.('[data-overlay-portal]')) {
                event.preventDefault();
              }
            }}
            onCloseAutoFocus={e => {
              const href = window.location.pathname + window.location.search;
              if (href !== openedAtHrefRef.current) e.preventDefault();
            }}
          >
            <Command
              ref={attachCommandRef}
              // See inline <Command> above: pin cmdk's value to a sentinel ('__none__') that matches no
              // item so it never adds a second highlighted row next to the imperatively-managed one.
              value='__none__'
              onValueChange={() => undefined}
              data-nav-active={hasNavigated ? 'true' : undefined}
              data-mention-active={mentionSearchType ? 'true' : undefined}
              shouldFilter={false}
              onMouseMove={() => {
                if (suppressHover) {
                  commandRef.current
                    ?.querySelectorAll('[cmdk-item][aria-selected="true"]')
                    .forEach(item => {
                      item.setAttribute('aria-selected', 'false');
                    });
                  setSuppressHover(false);
                }
                reconcileHoverSelection();
              }}
              className={cn(
                // cmdk root carries tabIndex={-1} — see the inline branch above.
                'fixed left-0 md:left-1/2 top-0 md:top-[14vh] -translate-x-0 md:-translate-x-1/2 md:translate-y-0 w-full flex flex-col focus:outline-none focus-visible:outline-none',
                isMobile ? 'h-[100dvh]' : 'h-screen',
                contextSelectionMode ? 'md:max-w-4xl' : 'md:max-w-3xl',
                // Fixed height (not max-height) so the shell doesn't grow/shrink as results
                // come and go. Header + footer are shrink-0; Command.List is flex-1 and
                // absorbs the remainder, so a wrapped filter-chip row or a hidden tab bar
                // changes the list height, never the total. Mobile keeps h-[100dvh]/h-screen.
                'md:w-full md:h-[549px] md:overflow-hidden bg-card md:rounded-2xl shadow-[0px_7px_15px_0px_#0000000D,0px_28px_28px_0px_#00000017,0px_62px_37px_0px_#0000000D,0px_111px_44px_0px_#00000003,0px_173px_48px_0px_#00000000] border border-border',
                showMergeDialog ? 'z-40' : 'z-[9999]',
              )}
              onKeyDownCapture={handleCommandKeyDown}
            >
              {commandBody}
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      {/* Siblings of the Cmd+K dialog (NOT children) so closing Cmd+K can't tear them down; the
          `/call` channel confirmation and the `/record` conflict dialog render after Cmd+K is
          dismissed, clear of z-[9999]. */}
      {commandConfirmations}
    </>
  );
};

export default ChannelCommandMenu;
