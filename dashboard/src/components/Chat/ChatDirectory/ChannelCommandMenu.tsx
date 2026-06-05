import React, { ReactElement, useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import {
  Hash,
  Loader2,
  MessageSquare,
  Users,
  FolderOpen,
  SquareDashedKanban,
  ArrowLeft,
  CornerDownLeft,
  MoveUp,
  MoveDown,
  Search,
  X,
  Check,
  LayoutDashboard,
  Phone,
  Mic,
  Lock,
  Mail,
  ArrowRight,
} from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Switch from '@radix-ui/react-switch';
import { Channel, ChannelVisibility, isDeskChannelType } from '@xyne/shared';
import {
  isDMChannel,
  isGroupDMChannel,
  isOneToOneDMChannel,
  getDMParticipantIdsToFetch,
  parseDMParticipantIds,
} from './ChatDirectory.utils';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import Avatar from '../../ui/Avatar/Avatar';
import Badge from '../../ui/Badge';
import { DisplaySearchResult } from '../../../types/search';
import {
  TabType,
  MentionType,
  ChannelCommandMenuProps,
  TYPE_SUGGESTIONS,
  SearchableTypes,
} from './ChannelCommandMenu.types';
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
import { useUsers, useUserSearch, useUser } from '../../../hooks/useUsers';
import { cn } from '../../../utils/classNames';
import SearchResultItem from './SearchResultItem';
import { getUserDisplayName, isUserDeactivated } from '../../../utils/userDisplayName';
import {
  mixpanelService,
  EVENTS,
  EVENT_PROPERTIES,
} from '../../../services/Analytics/mixpanelService';
import { LexicalSearchInput } from './LexicalSearchInput';
import { StatusIndicator } from '../../ui/StatusIndicator';
import {
  useSearchMetrics,
  filterChannelsBySearchableNames,
  rankUsers,
  CMDK_USER_LIMIT,
} from '../../../hooks/useSearchMetrics';
import { useScope, useShortcutById } from '../../../shortcuts';
import { usePlatform } from '../../../hooks/usePlatform';
import { FilePreviewModal } from '../../FileViewer/FileViewerModal';
import { TYPE_AUTOCOMPLETE_REGEX, parseTypeFilter } from '../../../utils/searchFilterParser';
import { TicketPreviewPanel } from './TicketPreviewPanel';

function stripHtmlTags(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || html;
}
const ChannelCommandItem = ({
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
      onSelect={() => onSelect(displayName)}
      onMouseDownCapture={onItemMouseDown}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer mt-1 ${!isMobile && 'aria-selected:bg-muted'}`}
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      <div className='flex items-center justify-center h-4 w-5 flex-shrink-0'>
        {getChannelIcon(channel)}
      </div>
      <div className='flex-1 min-w-0 flex items-center gap-1'>
        <span className='text-left text-sm font-medium text-foreground truncate'>
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
        <span className='flex-shrink-0 flex items-center justify-center w-4 h-4 rounded-full bg-primary text-white'>
          <Check size={10} />
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

const DEFAULT_ENABLED_TABS: TabType[] = [
  TabType.USERS,
  TabType.CHANNELS,
  TabType.MESSAGES,
  TabType.TICKETS,
  TabType.ATTACHMENTS,
  TabType.DESK,
];

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
  enabledTabs,
  inline = false,
  onTabChange,
  initialTab,
  hideTabs = false,
}: ChannelCommandMenuProps): ReactElement | null => {
  const navigate = useNavigate();
  const channelData = useAllChannels();
  const commandRef = useRef<HTMLDivElement>(null);
  // Tracks whether the most recent activation gesture (mouse or keyboard)
  // carried a Cmd/Ctrl modifier. cmdk's onSelect strips the event and a
  // synthetic .click() strips modifier flags, so we prime this ref from
  // onMouseDownCapture and from the Enter branch of handleCommandKeyDown.
  const lastModifierRef = useRef<boolean>(false);

  useScope('command', open);

  useShortcutById(
    'global.search',
    () => {
      onOpenChange(!open);
      if (!open && !searchSessionId) {
        onOpen('keyboard_shortcut');
      }
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
    }> = [];

    const getSearchableNames = (channel: Channel): string[] => {
      if (!isDMChannel(channel.scopeType)) {
        return [channel.name];
      }

      const userIds = parseDMParticipantIds(channel);

      // Check if this is a self-DM (only current user)
      const isSelfDM = userIds.length === 1 && userIds[0] === currentUserID;

      if (isSelfDM) {
        // For self-DMs, include current user's name so it's searchable
        const currentUserName = usersById.get(currentUserID)?.name;
        return currentUserName ? [currentUserName, 'You'] : ['You'];
      }

      // Exclude current user from regular DM names - only show other participants
      const otherUserIds = userIds.filter(id => id !== currentUserID);

      const participantNames = otherUserIds
        .map(userId => usersById.get(userId)?.name)
        .filter((name): name is string => !!name);

      return participantNames;
    };

    // Add starred channels
    starred.forEach(channel => {
      result.push({
        channel,
        category: ChannelCategory.STARRED,
        searchableNames: getSearchableNames(channel),
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
      result.push({
        channel,
        category: ChannelCategory.DIRECT_MESSAGES,
        searchableNames: getSearchableNames(channel),
      });
    });

    return result;
  }, [channels, starred, directMessages, usersById]);

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
    useVespaSearch,
    // setUseVespaSearch,
    includeBotMessages,
    setIncludeBotMessages,
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
  });

  // Aliases to match old usage if needed or just use new names
  const search = cleanedSearchText;
  const setSearch = setSearchText;

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Type filter visibility - match tab behavior
  // type:users/people shows grouped local users (same as USERS tab)
  // type:channels shows grouped local channels (same as CHANNELS tab)
  const types = parseTypeFilter(typeFilter);
  const isUsersType = types.some(t => t === SearchableTypes.USERS || t === SearchableTypes.PEOPLE);
  const isChannelsType = types.includes(SearchableTypes.CHANNELS);

  // Check if user has selected from: or in: or with: mention filters (for reordering results)
  const hasWithFilter = selectedMentions.some(m => m.prefix === 'with:');

  const showGroupedLocalResults = (!typeFilter || isChannelsType) && !hasWithFilter;
  const showGroupedUsers = (!typeFilter || isUsersType) && !hasWithFilter;

  // Check if user has selected from:/with: or in: mention filters (for reordering results)
  // Only count in: mentions that are CHANNEL type (not USER type from in: combined list)
  const hasFromOrInFilter = selectedMentions.some(
    m =>
      m.prefix === 'from:' ||
      m.prefix === 'with:' ||
      (m.prefix === 'in:' && m.type === MentionType.CHANNEL),
  );
  // Which trigger opened the channel typeahead: '#' acts like Slack's quick
  // switcher (navigate on select, show only regular channels); 'in:' creates a
  // filter chip and includes DMs/Group DMs.
  const [channelTrigger, setChannelTrigger] = useState<'#' | 'in:' | 'in:#' | 'in:@' | null>(null);

  const [userTrigger, setUserTrigger] = useState<
    '@' | 'from:' | 'with:' | 'assignee:' | 'in:@' | null
  >(null);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);

  const insertMentionRef = useRef<
    ((item: { id: string; name: string; email?: string; type?: MentionType }) => void) | null
  >(null);

  const insertTextRef = useRef<((text: string) => void) | null>(null);

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
  const autocompleteSuffix = typeAutocomplete.suffix;

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
    [onClose, onOpen],
  );

  // Handle mention selection from search results.
  // For `#`-triggered channel picks (Slack-style quick switcher) we navigate to
  // the channel and close the dialog instead of inserting a filter chip.
  // For `@`-triggered user picks, we navigate to the user's DM.
  const handleMentionSelect = useCallback(
    async (mention: { id: string; name: string; type: MentionType; email?: string }) => {
      if (mention.type === MentionType.CHANNEL && channelTrigger === '#') {
        setMentionSearchType(null);
        setMentionSearchQuery('');
        setChannelTrigger(null);
        setSelectedMentionIndex(0);
        onOpenChange(false);
        void navigate(`/chat/dir/${mention.id}`);
        return;
      }

      // For `@`-triggered user picks, navigate to DM instead of inserting a chip
      if (mention.type === MentionType.USER && userTrigger === '@') {
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
    [channelTrigger, userTrigger, onOpenChange, navigate],
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
    (query: string | null, trigger?: '@' | 'from:' | 'with:' | 'assignee:' | 'in:@') => {
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
    [],
  );

  // Handle channel search from mention plugin
  const handleChannelSearch = useCallback(
    (query: string | null, trigger?: '#' | 'in:' | 'in:#' | 'in:@') => {
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
    [],
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

  // Available users - populated when:
  // 1. mentionSearchType is USER (direct user search like @, from:, assignee:, in:@)
  // 2. channelTrigger is 'in:' (combined search - show both channels and users)
  const availableUsers = useMemo(() => {
    if (mentionSearchType !== MentionType.USER && channelTrigger !== 'in:') return [];
    return rankUsers(mentionUsers, mentionSearchQuery, dmContactRecency).map(user => ({
      id: user.id,
      name: user.name,
      status: user.status,
      ...(user.email && { email: user.email }),
    }));
  }, [mentionUsers, mentionSearchQuery, mentionSearchType, channelTrigger, dmContactRecency]);

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
        const currentUserName = usersById.get(currentUserID)?.name;
        return currentUserName ? `${currentUserName} (You)` : 'You';
      }

      // Regular DM with others
      const otherNames = otherUserIds
        .map(id => usersById.get(id)?.name)
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

  // Track search performed in command menu (debounced)
  useEffect(() => {
    if (!searchText.trim() && activeTab !== TabType.CHANNELS) return;

    const timer = setTimeout((): void => {
      mixpanelService.track(EVENTS.SEARCH_PERFORMED, {
        searchType: EVENT_PROPERTIES.SEARCH_TYPES.COMMAND_MENU,
        searchCategory: activeTab,
        resultsCount: filteredLocalChannels.length,
      });
    }, 500); // 500ms debounce

    return (): void => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, activeTab]);

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

  // Reset active tab if the current tab is no longer in the enabled set.
  // In inline mode, fall back to the first enabled tab (never ALL).
  useEffect(() => {
    if (!activeEnabledTabs.includes(activeTab)) {
      setActiveTab(inline ? (activeEnabledTabs[0] ?? TabType.ALL) : TabType.ALL);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEnabledTabs, inline]);

  // Reset state when menu closes; also reset tab on open so dialog always starts on ALL
  useEffect(() => {
    if (!open) {
      setSearch('');
      setSearchText('');
      setSelectedMentions([]);
      setMentionSearchQuery('');
      setMentionSearchType(null);
      setChannelTrigger(null);
      setUserTrigger(null);
      setActiveTab(TabType.ALL);
      onTabChange?.(TabType.ALL);
      resetSearchState();
      setExpandedCategories(new Set());
      setPreviewTicket(null);

      // Reset the previous search text refs
      prevSearchTextRef.current = '';
      lastModifierRef.current = false;

      if (searchSessionId) {
        onClose();
      }
    } else if (!inline) {
      // When opening the non-inline dialog, start on initialTab if provided, else ALL
      setActiveTab(initialTab ?? TabType.ALL);
    }
  }, [open, searchSessionId, onClose, resetSearchState, inline, initialTab]);

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
      console.error('Navigation failed:', err);
    }
  };

  const handleItemMouseDown = (e: React.MouseEvent): void => {
    lastModifierRef.current = e.metaKey || e.ctrlKey;
  };

  const handleFilePreview = useCallback((result: DisplaySearchResult): void => {
    // Handle attachment preview - show file preview modal
    if (result.type !== 'attachment' || !result.searchContext?.internalUrl) {
      return;
    }

    setPreviewFile({
      fileName: result.title,
      fileUrl: result.searchContext.internalUrl,
      mimeType: result.searchContext.mimeType || 'application/octet-stream',
      fileSize: result.searchContext.fileSize || 0,
    });
  }, []);

  // Handle mouse hover over ticket items to show preview
  const handleTicketMouseEnter = useCallback(
    (result: DisplaySearchResult): void => {
      setHoveredResult(result);
      setKeyboardSelectedResult(null); // Clear keyboard selection when mouse takes over
      // Only update when preview is already open
      if (!previewTicket) {
        return;
      }
      if (result.type !== 'ticket') {
        // In ALL tab, close preview when hovering over non-ticket items
        if (activeTab === TabType.ALL) {
          setPreviewTicket(null);
        }
        return;
      }
      // Only update if the ticket is different
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

  const iconSize = isMobile ? 14 : 12;

  const allTabDefinitions: Array<{ id: TabType; label: string; icon?: ReactElement }> = [
    { id: TabType.USERS, label: 'People', icon: <Users size={iconSize} /> },
    { id: TabType.MESSAGES, label: 'Messages', icon: <MessageSquare size={iconSize} /> },
    { id: TabType.CHANNELS, label: 'Channels', icon: <Hash size={iconSize} /> },
    { id: TabType.TICKETS, label: 'Tickets', icon: <SquareDashedKanban size={iconSize} /> },
    { id: TabType.ATTACHMENTS, label: 'Files', icon: <FolderOpen size={iconSize} /> },
    { id: TabType.CANVAS, label: 'Canvas', icon: <LayoutDashboard size={iconSize} /> },
    { id: TabType.CALL, label: 'Calls', icon: <Phone size={iconSize} /> },
    { id: TabType.RECORDING, label: 'Recordings', icon: <Mic size={iconSize} /> },
    { id: TabType.DESK, label: 'Desk', icon: <Mail size={iconSize} /> },
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
      default:
        return '';
    }
  };

  const hasResults =
    ((activeTab === TabType.ALL || activeTab === TabType.CHANNELS) &&
      filteredLocalChannels.length > 0) ||
    ((activeTab === TabType.ALL || activeTab === TabType.USERS) && filteredLocalUsers.length > 0) ||
    (activeTab !== TabType.CHANNELS && activeTab !== TabType.USERS && backendResults.length > 0);

  const showEmptyState = searchText.trim() && !isLoading && !hasResults;

  // Auto-select first result when search results change. Reset the
  // navigation flag when either the free-text query OR the active filter
  // chips change — both are inputs to the backend search.
  useEffect(() => {
    hasNavigatedRef.current = false;
  }, [searchText, selectedMentions]);

  // The user-facing banner shows a generic "Search is unavailable" message;
  // log the raw backend error to the console so devs can still triage from
  // DevTools without exposing implementation details in the UI.
  useEffect(() => {
    if (error) console.warn('[Cmd+K search]', error);
  }, [error]);

  useEffect(() => {
    // Auto-select fires when there's a query OR an active filter chip — the
    // latter catches the case where the user typed `from:<name>` / `in:<ch>`,
    // inserted a chip, and the backend returned results for that filter with
    // no free-text query.
    const hasActiveSearch = searchText.trim().length > 0 || selectedMentions.length > 0;
    if (!hasActiveSearch || !hasResults || hasNavigatedRef.current) return;
    // Small delay to let DOM render the items
    const timer = setTimeout(() => {
      if (hasNavigatedRef.current) return;
      const items = commandRef.current?.querySelectorAll('[cmdk-item]:not([aria-disabled="true"])');
      if (items && items.length > 0) {
        items.forEach((item, i) => {
          item.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
        });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [
    searchText,
    hasResults,
    activeTab,
    filteredLocalChannels.length,
    filteredLocalUsers.length,
    backendResults.length,
  ]);

  // Render backend results for the search-active branch (flat list filtered by activeTab)
  const renderSearchBackendResults = () => (
    <>
      {['conversation', 'ticket', 'attachment', 'canvas', 'transcript', 'recording', 'desk']
        .filter(groupKey => {
          if (activeTab === TabType.ALL) return true;
          if (activeTab === TabType.MESSAGES && groupKey === 'conversation') return true;
          if (activeTab === TabType.TICKETS && groupKey === 'ticket') return true;
          if (
            activeTab === TabType.ATTACHMENTS &&
            (groupKey === 'attachment' ||
              groupKey === 'canvas' ||
              groupKey === 'transcript' ||
              groupKey === 'recording')
          )
            return true;
          if (activeTab === TabType.CANVAS && groupKey === 'canvas') return true;
          if (activeTab === TabType.CALL && groupKey === 'transcript') return true;
          if (activeTab === TabType.RECORDING && groupKey === 'recording') return true;
          if (activeTab === TabType.DESK && groupKey === 'desk') return true;
          return false;
        })
        .map(groupKey => {
          const items = groupedBackendResults[groupKey];
          if (!items || items.length === 0) return null;

          const displayCount =
            useVespaSearch && activeTab !== TabType.ALL
              ? paginationState[activeTab].cumulativeCount
              : items.length;

          return (
            <div key={groupKey} className='mb-4'>
              <Command.Group
                heading={`${getGroupLabel(groupKey)} (${displayCount})`}
                className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono'
              >
                {items.map((result, index) => (
                  <SearchResultItem
                    key={result.id}
                    result={result}
                    onSelect={res => handleBackendResultSelect(res, index + 1)}
                    onPreview={handleFilePreview}
                    onItemMouseDown={handleItemMouseDown}
                    onItemMouseEnter={handleTicketMouseEnter}
                    onItemMouseLeave={handleTicketMouseLeave}
                    isSelected={contextItems.some(c => c.id === `${result.type}-${result.id}`)}
                  />
                ))}
              </Command.Group>
            </div>
          );
        })}

      {/* Infinite scroll trigger and loading indicator */}
      {paginationState[activeTab].hasMore && (
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
  );

  // Render backend results for the browse/no-search branch (sorted with expand/collapse)
  const renderDefaultBackendResults = () => (
    <>
      {Object.entries(groupedBackendResults)
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
          let displayCount: number;
          if (activeTab === TabType.ALL) {
            displayCount = items.length;
          } else if (useVespaSearch) {
            displayCount = paginationState[activeTab].cumulativeCount;
          } else {
            displayCount = items.length;
          }
          const isUserType = type === 'user';
          const isExpanded = expandedCategories.has(type);
          const hasMore = items.length > DISPLAY_LIMIT;
          const displayItems =
            isUserType && !isExpanded && hasMore ? items.slice(0, DISPLAY_LIMIT) : items;
          const hiddenCount = items.length - DISPLAY_LIMIT;

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
                    onSelect={res => handleBackendResultSelect(res, index + 1)}
                    onPreview={handleFilePreview}
                    onItemMouseDown={handleItemMouseDown}
                    onItemMouseEnter={handleTicketMouseEnter}
                    onItemMouseLeave={handleTicketMouseLeave}
                    isSelected={contextItems.some(c => c.id === `${result.type}-${result.id}`)}
                  />
                ))}
                {isUserType && hasMore && (
                  <button
                    onClick={() => toggleCategoryExpansion(type)}
                    className={`w-full px-2 py-1.5 mt-1 text-sm text-muted-foreground rounded-sm text-left transition-colors ${!isMobile && 'hover:text-foreground hover:bg-accent'}`}
                    style={{
                      WebkitTapHighlightColor: 'transparent',
                      userSelect: 'none',
                    }}
                    data-track-category='CHANNEL_SEARCH'
                    data-track-name='TOGGLE_BACKEND_USER_EXPANSION'
                    data-track-metadata={JSON.stringify({
                      type,
                      isExpanded,
                    })}
                  >
                    {isExpanded ? 'See less' : `See ${hiddenCount} more`}
                  </button>
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
              <Loader2 className='h-4 w-4 animate-spin' />
              <span>Loading more results...</span>
            </div>
          )}
        </div>
      )}
    </>
  );

  // Render the local sections (Starred, Users, Group DMs, Channels) for the search branch
  const renderSearchLocalSections = () => (
    <>
      {/* 0. Starred (from local channels) */}
      {(activeTab === TabType.ALL || activeTab === TabType.CHANNELS) &&
        showGroupedLocalResults &&
        groupedChannels['starred'] &&
        groupedChannels['starred'].length > 0 && (
          <div className='mb-4'>
            {(() => {
              const items = groupedChannels['starred'];
              const category = ChannelCategory.STARRED;
              const isExpanded = expandedCategories.has(category);
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
                    <button
                      onClick={() => toggleCategoryExpansion(category)}
                      className={`w-full px-2 py-1.5 mt-1 text-sm text-muted-foreground rounded-sm text-left transition-colors ${!isMobile && 'hover:text-foreground hover:bg-accent'}`}
                      data-track-category='CHANNEL_SEARCH'
                      data-track-name='TOGGLE_CHANNEL_CATEGORY_EXPANSION'
                      data-track-metadata={JSON.stringify({
                        category: category as string,
                        isExpanded,
                      })}
                    >
                      {isExpanded ? 'See less' : `See ${hiddenCount} more`}
                    </button>
                  )}
                </Command.Group>
              );
            })()}
          </div>
        )}

      {/* 1. Users (from local) */}
      {(activeTab === TabType.ALL || activeTab === TabType.USERS) &&
        showGroupedUsers &&
        filteredLocalUsers.length > 0 && (
          <div className='mb-4'>
            {(() => {
              // Apply the shared Cmd+K user rank, then map to DisplaySearchResult.
              const rankedUsers = rankUsers(
                filteredLocalUsers,
                cleanedSearchText,
                dmContactRecency,
              );
              const allItems: DisplaySearchResult[] = rankedUsers.map(user => ({
                id: user.id,
                type: 'user' as const,
                title: user.name,
                subtitle: user.email || '',
                relevanceScore: 1,
                metadata: {},
              }));

              const totalItemsCount = allItems.length;
              const displayCount = totalItemsCount;

              const isExpanded = expandedCategories.has('user');
              const hasMore = totalItemsCount > DISPLAY_LIMIT;

              const displayItems =
                !isExpanded && hasMore ? allItems.slice(0, DISPLAY_LIMIT) : allItems;

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
                    <button
                      onClick={() => toggleCategoryExpansion('user')}
                      className={`w-full px-2 py-1.5 mt-1 text-sm text-muted-foreground rounded-sm text-left transition-colors ${!isMobile && 'hover:text-foreground hover:bg-accent'}`}
                      style={{
                        WebkitTapHighlightColor: 'transparent',
                        userSelect: 'none',
                      }}
                      data-track-category='CHANNEL_SEARCH'
                      data-track-name='TOGGLE_CATEGORY_EXPANSION'
                      data-track-metadata={JSON.stringify({
                        category: 'user',
                        isExpanded,
                      })}
                    >
                      {isExpanded ? 'See less' : `See ${hiddenCount} more`}
                    </button>
                  )}
                </Command.Group>
              );
            })()}
          </div>
        )}

      {/* 2. Group DMs (from local channels) */}
      {(() => {
        const groupDMs =
          groupedChannels['direct-messages']?.filter(({ channel }) =>
            isGroupDMChannel(channel.scopeType),
          ) || [];
        return (
          (activeTab === TabType.ALL || activeTab === TabType.CHANNELS) &&
          showGroupedLocalResults &&
          groupDMs.length > 0 && (
            <div className='mb-4'>
              <Command.Group
                heading={getCategoryLabel(ChannelCategory.GROUP_DMS)}
                className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono'
              >
                {groupDMs.map(({ channel }, index) => {
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
              </Command.Group>
            </div>
          )
        );
      })()}

      {/* 3. Channels (from local channels) */}
      {(activeTab === TabType.ALL || activeTab === TabType.CHANNELS) &&
        showGroupedLocalResults &&
        groupedChannels['channels'] &&
        groupedChannels['channels'].length > 0 && (
          <div className='mb-4'>
            {(() => {
              const items = groupedChannels['channels'];
              const category = ChannelCategory.CHANNELS;
              const isExpanded = expandedCategories.has(category);
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
                    <button
                      onClick={() => toggleCategoryExpansion(category)}
                      className={`w-full px-2 py-1.5 mt-1 text-sm text-muted-foreground rounded-sm text-left transition-colors ${!isMobile && 'hover:text-foreground hover:bg-accent'}`}
                      style={{
                        WebkitTapHighlightColor: 'transparent',
                        userSelect: 'none',
                      }}
                      data-track-category='CHANNEL_SEARCH'
                      data-track-name='TOGGLE_GROUP_DM_CATEGORY_EXPANSION'
                      data-track-metadata={JSON.stringify({
                        category: category as string,
                        isExpanded,
                      })}
                    >
                      {isExpanded ? 'See less' : `See ${hiddenCount} more`}
                    </button>
                  )}
                </Command.Group>
              );
            })()}
          </div>
        )}
    </>
  );

  // Render the local channels for the browse branch (no search text)
  const renderBrowseLocalChannels = () => (
    <>
      {(activeTab === TabType.ALL || activeTab === TabType.CHANNELS || isChannelsType) &&
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
                      <button
                        onClick={() => toggleCategoryExpansion(category)}
                        className={`w-full px-2 py-1.5 mt-1 text-sm text-muted-foreground rounded-sm text-left transition-colors ${!isMobile && 'hover:text-foreground hover:bg-accent'}`}
                        style={{
                          WebkitTapHighlightColor: 'transparent',
                          userSelect: 'none',
                        }}
                        data-track-category='CHANNEL_SEARCH'
                        data-track-name='TOGGLE_LOCAL_CHANNEL_EXPANSION'
                        data-track-metadata={JSON.stringify({
                          category: category,
                          isExpanded,
                        })}
                      >
                        {isExpanded ? 'See less' : `See ${hiddenCount} more`}
                      </button>
                    )}
                  </Command.Group>
                </div>
              );
            })}
          </>
        )}
    </>
  );

  if (inline && !open) return null;

  const handleCommandKeyDown = (e: React.KeyboardEvent<HTMLElement>): void => {
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
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
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

      // Scroll into view if needed
      items[nextIndex]?.scrollIntoView({ block: 'nearest' });

      // Suppress mouse hover highlights while navigating with keyboard.
      setSuppressHover(true);
      hasNavigatedRef.current = true;

      // Track which result is currently selected via keyboard
      const newlySelectedItem = items[nextIndex];
      const resultId = newlySelectedItem?.getAttribute('data-result-id');
      const resultType = newlySelectedItem?.getAttribute('data-result-type');
      if (resultId && resultType) {
        const result = backendResults.find(r => r.type === resultType && r.id === resultId);
        setKeyboardSelectedResult(result || null);
        setHoveredResult(null); // Clear mouse hover state when using keyboard
      } else {
        setKeyboardSelectedResult(null);
      }

      // Linear-style preview: update preview when navigating to a different ticket
      if (previewTicket) {
        const ticketId = newlySelectedItem?.getAttribute('data-ticket-id');
        if (ticketId) {
          const ticket = backendResults.find(r => r.type === 'ticket' && r.id === ticketId);
          if (ticket && ticket.id !== previewTicket.id) {
            setPreviewTicket(ticket);
          }
        } else {
          // Navigated to non-ticket item, close the preview
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

    // ArrowRight: open ticket preview if a ticket is selected, otherwise do nothing (disable tab navigation)
    if (e.key === 'ArrowRight') {
      if (!typeAutocomplete.suggestion && !previewTicket) {
        // Check keyboard selection state (most reliable)
        const keyboardTicket = keyboardSelectedResult;
        // Check mouse hover state
        const mouseTicket = hoveredResult;

        // Use whichever is available
        const ticketToShow =
          keyboardTicket?.type === 'ticket'
            ? keyboardTicket
            : mouseTicket?.type === 'ticket'
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
              r => r.type === 'ticket' && r.id === ticketToShow.id,
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
        if (resultType === 'ticket' && resultId) {
          const ticketIndex = backendResults.findIndex(
            r => r.type === 'ticket' && r.id === resultId,
          );
          const ticket = ticketIndex >= 0 ? backendResults[ticketIndex] : undefined;
          if (ticket) {
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

    // If mention search is active, let the mention selection handle Enter
    if (mentionSearchType !== null) {
      // Select the currently highlighted mention
      e.preventDefault();
      e.stopPropagation();

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

    // Tell cmdk to select the active item
    const activeItem = commandRef.current?.querySelector(
      '[cmdk-item][aria-selected="true"]',
    ) as HTMLElement | null;

    // Prime modifier ref before the synthetic .click() — a synthetic click
    // loses modifier state, so downstream selection handlers read this ref
    // instead of checking event.metaKey.
    lastModifierRef.current = e.metaKey || e.ctrlKey;
    activeItem?.click();
  };

  const commandBody = (
    <>
      {/* Search Input */}
      <div className='flex items-center border-b border-border'>
        <div className='relative flex-1 flex items-center gap-2 px-4 py-2.5'>
          <button
            onClick={() => onOpenChange(false)}
            className='p-1 rounded-md text-foreground hover:text-muted-foreground hover:bg-accent transition-colors duration-200 sm:hidden'
            aria-label='Go back'
            data-track-category='CHANNEL_SEARCH'
            data-track-name='CLOSE_SEARCH_MENU`'
          >
            <ArrowLeft size={20} />
          </button>
          <LexicalSearchInput
            value={searchText}
            placeholder={`Search ${activeTab === TabType.ALL ? 'everything' : activeTab}...`}
            onChange={handleEditorChange}
            onUserSearch={handleUserSearch}
            onChannelSearch={handleChannelSearch}
            availableUsers={availableUsers}
            availableChannels={availableChannels.map(({ channel, displayName }) => ({
              id: channel.id,
              name: displayName,
            }))}
            className='flex-1'
            open={open}
            mentionSearchType={mentionSearchType}
            selectedMentionIndex={selectedMentionIndex}
            setSelectedMentionIndex={setSelectedMentionIndex}
            onInsertMentionReady={handleInsertMentionReady}
            onPasteDetected={onPasteDetected}
            onManualKeystroke={onManualKeystroke}
            autocompleteSuffix={autocompleteSuffix}
            onInsertTextReady={insertText => {
              insertTextRef.current = insertText;
            }}
            initialMention={initialMention}
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
              className='p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0 flex items-center justify-center'
              aria-label={search.trim() || searchText.trim() ? 'Clear search' : 'Search'}
              data-track-category='CHANNEL_SEARCH'
              data-track-name={search.trim() || searchText.trim() ? 'ClearSearch' : 'OpenSearch'}
              data-track-metadata={JSON.stringify({ searchQuery: searchText })}
            >
              {search.trim() || searchText.trim() ? (
                <X className='w-4 h-4' />
              ) : (
                <Search className='w-4 h-4' />
              )}
            </button>
          )}
          <kbd className='px-1.5 py-0.5 text-xs font-semibold text-muted-foreground border border-border rounded flex-shrink-0 hidden sm:block'>
            Esc
          </kbd>
        </div>
      </div>

      {/* Body: results panel + optional context panel side-by-side */}
      <div className='flex flex-1 min-h-0 overflow-hidden bg-background rounded-b-2xl'>
        {/* Tabs, Results, Footer Container - modal overlays everything below search input */}
        <div
          className='relative flex-1 flex flex-col min-h-0 overflow-x-hidden bg-background rounded-b-2xl'
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
            className={`overflow-x-auto no-scrollbar p-2 ${isMobile ? 'mx-1' : 'ml-4'} ${hideTabs ? 'hidden' : ''}`}
          >
            <Tabs.Root value={activeTab}>
              <Tabs.List
                className='flex items-center justify-start gap-1.5'
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
                        'flex items-center justify-center gap-1.5 px-2 text-sm py-0.5 max-h-6 whitespace-nowrap transition-colors cursor-pointer rounded-lg border',
                        activeTab === tab.id
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-foreground hover:text-foreground',
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

          {searchText.trim() && (
            <button
              type='button'
              onClick={() => {
                onOpenChange(false);
                void navigate(`/search-results?query=${encodeURIComponent(searchText.trim())}`);
              }}
              data-track-category='CHANNEL_COMMAND_MENU'
              data-track-name='SHOW_ALL_SEARCH_RESULTS'
              className='flex w-full items-center gap-2 px-4 py-2 text-sm text-muted-foreground border-b border-border hover:bg-muted transition-colors text-left'
            >
              <Search size={14} className='shrink-0' />
              <span className='truncate'>
                Show results for:{' '}
                <span className='text-foreground'>{`"${searchText.trim()}"`}</span>
              </span>
            </button>
          )}

          {/* Results */}
          <Command.List
            className={cn(
              'flex-1 overflow-y-auto md:max-h-[32rem] p-2 bg-background',
              suppressHover && '[&_[cmdk-item]]:pointer-events-none',
            )}
            ref={el => {
              if (el) {
                setScrollContainer(el);
              }
            }}
          >
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
                                if (setSelectedMentionIndex) {
                                  setSelectedMentionIndex(index);
                                }
                              }}
                              className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-all duration-150 mt-1 ${
                                index === selectedMentionIndex ? 'bg-muted' : ''
                              } ${!isMobile && 'active:bg-muted active:scale-[0.98]'}`}
                              style={{ WebkitTapHighlightColor: 'transparent' }}
                            >
                              <div className='flex items-center justify-center h-4 w-5 flex-shrink-0 text-muted-foreground'>
                                {getChannelIcon(channel)}
                              </div>
                              <div className='flex-1 min-w-0'>
                                <div className='font-semibold text-sm text-foreground truncate'>
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
                                if (setSelectedMentionIndex) {
                                  setSelectedMentionIndex(adjustedIndex);
                                }
                              }}
                              className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-all duration-150 mt-1 ${
                                adjustedIndex === selectedMentionIndex ? 'bg-muted' : ''
                              } ${!isMobile && 'active:bg-muted active:scale-[0.98]'}`}
                              style={{ WebkitTapHighlightColor: 'transparent' }}
                            >
                              <div className='flex items-center justify-center h-4 w-5 flex-shrink-0 text-muted-foreground'>
                                {getChannelIcon(channel)}
                              </div>
                              <div className='flex-1 min-w-0'>
                                <div className='font-semibold text-sm text-foreground truncate'>
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
                                  if (setSelectedMentionIndex) {
                                    setSelectedMentionIndex(index);
                                  }
                                }}
                                className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-all duration-150 mt-1 ${
                                  index === selectedMentionIndex ? 'bg-muted' : ''
                                } ${!isMobile && 'active:bg-muted active:scale-[0.98]'}`}
                                style={{ WebkitTapHighlightColor: 'transparent' }}
                              >
                                <Avatar userId={user.id} size='sm' />
                                <div className='flex-1 min-w-0'>
                                  <div className='flex items-center gap-1.5'>
                                    <div
                                      className={`font-semibold text-sm truncate ${isDeactivated ? 'text-muted-foreground' : 'text-foreground'}`}
                                    >
                                      {getUserDisplayName(user)}
                                    </div>
                                    {isDeactivated && (
                                      <span className='inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground shrink-0'>
                                        Deactivated
                                      </span>
                                    )}
                                  </div>
                                  {user.email && (
                                    <div className='text-xs text-muted-foreground truncate'>
                                      {user.email}
                                    </div>
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
                                if (setSelectedMentionIndex) {
                                  setSelectedMentionIndex(index);
                                }
                              }}
                              className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-all duration-150 mt-1 ${
                                index === selectedMentionIndex ? 'bg-muted' : ''
                              } ${!isMobile && 'active:bg-muted active:scale-[0.98]'}`}
                              style={{ WebkitTapHighlightColor: 'transparent' }}
                            >
                              <div className='flex items-center justify-center h-4 w-5 flex-shrink-0 text-muted-foreground'>
                                {getChannelIcon(channel)}
                              </div>
                              <div className='flex-1 min-w-0'>
                                <div className='font-semibold text-sm text-foreground truncate'>
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
                          if (setSelectedMentionIndex) {
                            setSelectedMentionIndex(index);
                          }
                        }}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-all duration-150 mt-1 ${
                          index === selectedMentionIndex ? 'bg-muted' : ''
                        } ${!isMobile && 'active:bg-muted active:scale-[0.98]'}`}
                        style={{ WebkitTapHighlightColor: 'transparent' }}
                      >
                        <div className='flex items-center justify-center h-4 w-5 flex-shrink-0 text-muted-foreground'>
                          {getChannelIcon(channel)}
                        </div>
                        <div className='flex-1 min-w-0'>
                          <div className='font-semibold text-sm text-foreground truncate'>
                            {displayName}
                          </div>
                        </div>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                {channelTrigger === 'in:@' && availableDMs.length === 0 && mentionSearchQuery && (
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
                            if (setSelectedMentionIndex) {
                              setSelectedMentionIndex(index);
                            }
                          }}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-all duration-150 mt-1 ${
                            index === selectedMentionIndex ? 'bg-muted' : ''
                          } ${!isMobile && 'active:bg-muted active:scale-[0.98]'}`}
                          style={{ WebkitTapHighlightColor: 'transparent' }}
                        >
                          <div className='flex items-center justify-center h-4 w-5 flex-shrink-0 text-muted-foreground'>
                            {getChannelIcon(channel)}
                          </div>
                          <div className='flex-1 min-w-0'>
                            <div className='font-semibold text-sm text-foreground truncate'>
                              {displayName}
                            </div>
                          </div>
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                )}
                {channelTrigger === '#' && availableChannels.length === 0 && mentionSearchQuery && (
                  <Command.Empty className='py-6 text-center text-sm text-muted-foreground'>
                    No channels found for &quot;{mentionSearchQuery}&quot;
                  </Command.Empty>
                )}

                {/* Regular USER mention search (@, from:, with:, assignee:) - Show only Users */}
                {mentionSearchType === MentionType.USER &&
                  (userTrigger === '@' ||
                    userTrigger === 'from:' ||
                    userTrigger === 'with:' ||
                    userTrigger === 'assignee:') &&
                  availableUsers.length > 0 && (
                    <Command.Group
                      heading='Users'
                      className='[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:font-mono'
                    >
                      {availableUsers.map((user, index) => (
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
                            if (setSelectedMentionIndex) {
                              setSelectedMentionIndex(index);
                            }
                          }}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-all duration-150 mt-1 ${
                            index === selectedMentionIndex ? 'bg-muted' : ''
                          } ${!isMobile && 'active:bg-muted active:scale-[0.98]'}`}
                          style={{ WebkitTapHighlightColor: 'transparent' }}
                        >
                          <Avatar userId={user.id} size='sm' />
                          <div className='flex-1 min-w-0'>
                            <div className='font-semibold text-sm text-foreground truncate'>
                              {getUserDisplayName(user)}
                            </div>
                            {user.email && (
                              <div className='text-xs text-muted-foreground truncate'>
                                {user.email}
                              </div>
                            )}
                          </div>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  )}
                {mentionSearchType === MentionType.USER &&
                  (userTrigger === '@' ||
                    userTrigger === 'from:' ||
                    userTrigger === 'with:' ||
                    userTrigger === 'assignee:') &&
                  availableUsers.length === 0 &&
                  mentionSearchQuery && (
                    <Command.Empty className='py-6 text-center text-sm text-muted-foreground'>
                      No users found for &quot;{mentionSearchQuery}&quot;
                    </Command.Empty>
                  )}
              </>
            )}

            {/* ─── Inline context picker: locked + recent sections ─────────────────── */}
            {inline && contextSelectionMode && !mentionSearchType && activeTab !== TabType.ALL && (
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
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer mt-1 ${!isMobile && 'hover:bg-muted aria-selected:bg-muted'}`}
                          style={{ WebkitTapHighlightColor: 'transparent' }}
                        >
                          {isChannelTab &&
                            (item.isPrivate ? (
                              <Lock size={14} className='text-muted-foreground flex-shrink-0' />
                            ) : (
                              <Hash size={14} className='text-muted-foreground flex-shrink-0' />
                            ))}
                          <span className='flex-1 min-w-0 text-left text-sm font-medium text-foreground truncate'>
                            {item.title}
                          </span>
                          {isSelected && (
                            <span className='flex-shrink-0 flex items-center justify-center w-4 h-4 rounded-full bg-primary text-white'>
                              <Check size={10} />
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
                {/* When from:/in: filter is active, backend results appear first */}
                {/* When with: filter is active, only show backend results (no local sections) */}
                {searchText.trim() || typeFilter ? (
                  <>
                    {/* When from:/in: filter is active, backend results appear first; otherwise local sections appear first */}
                    {/* with: filter suppresses local sections entirely */}
                    {hasFromOrInFilter ? (
                      <>
                        {backendResults.length > 0 && renderSearchBackendResults()}
                        {!hasWithFilter && renderSearchLocalSections()}
                      </>
                    ) : (
                      <>
                        {!hasWithFilter && renderSearchLocalSections()}
                        {backendResults.length > 0 && renderSearchBackendResults()}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {/* When from:/in: filter is active, backend results appear first; otherwise local channels appear first */}
                    {/* with: filter suppresses local sections entirely */}
                    {hasFromOrInFilter ? (
                      <>
                        {activeTab !== TabType.CHANNELS &&
                          backendResults.length > 0 &&
                          renderDefaultBackendResults()}
                        {!hasWithFilter && renderBrowseLocalChannels()}
                      </>
                    ) : (
                      <>
                        {!hasWithFilter && renderBrowseLocalChannels()}
                        {activeTab !== TabType.CHANNELS &&
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
          </Command.List>
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

      {/* Footer - outside body flex so TicketPreviewPanel only spans results area */}
      {!inline && !isMobile && (
        <div className='px-4 py-2 border-t border-border/40 text-sm text-muted-foreground flex items-center justify-between shrink-0 bg-muted/30 rounded-b-2xl'>
          {/* Vespa Search toggle - commented out, using Vespa as default
          <div className='flex items-center gap-2'>
            <label htmlFor='vespa-toggle' className='text-xs text-muted-foreground cursor-pointer'>
              Vespa Search
            </label>
            <Switch.Root
              id='vespa-toggle'
              checked={useVespaSearch}
              onCheckedChange={setUseVespaSearch}
              className='w-9 h-5 bg-muted-foreground/40 rounded-full relative data-[state=checked]:bg-blue-500 transition-colors'
            >
              <Switch.Thumb className='block w-4 h-4 bg-background rounded-full transition-transform duration-100 translate-x-0.5 will-change-transform data-[state=checked]:translate-x-5' />
            </Switch.Root>
          </div>
          */}
          <div className='flex items-center gap-2'>
            <label
              htmlFor='include-bot-messages-toggle'
              className='text-xs text-muted-foreground cursor-pointer'
              title={
                includeBotMessages
                  ? 'Bot messages are included in search results'
                  : 'Bot messages are hidden from search results'
              }
            >
              Include bot messages
            </label>
            <Switch.Root
              id='include-bot-messages-toggle'
              checked={includeBotMessages}
              onCheckedChange={setIncludeBotMessages}
              aria-label='Toggle bot messages in search results'
              className='w-9 h-5 bg-muted-foreground/40 rounded-full relative data-[state=checked]:bg-blue-500 transition-colors'
            >
              <Switch.Thumb className='block w-4 h-4 bg-background rounded-full transition-transform duration-100 translate-x-0.5 will-change-transform data-[state=checked]:translate-x-5' />
            </Switch.Root>
          </div>
          <div className='flex items-center gap-6'>
            <span className='flex gap-2.5 items-center'>
              <span>Open</span>
              <span className='p-1 bg-background rounded-md border border-border'>
                <CornerDownLeft size={10} />
              </span>
            </span>
            {/* <span className='text-gray-300'>|</span> */}
            <span className='flex gap-2.5 items-center'>
              <span>Navigate </span>
              <span className='flex gap-1'>
                <span className='p-1 bg-background rounded-md border border-border'>
                  <MoveUp size={12} />
                </span>
                <span className='p-1 bg-background rounded-md border border-border'>
                  <MoveDown size={12} />
                </span>
              </span>
            </span>
            {previewTicket ? (
              <span className='flex gap-2.5 items-center'>
                <span className='flex gap-1'>
                  <span className='p-1 bg-background rounded-md border border-border'>
                    <ArrowLeft size={12} />
                  </span>
                </span>
                <span>Close</span>
              </span>
            ) : activeTab === TabType.TICKETS ||
              (activeTab === TabType.ALL &&
                (hoveredResult?.type === 'ticket' || keyboardSelectedResult?.type === 'ticket')) ? (
              <span className='flex gap-2.5 items-center'>
                <span className='flex gap-1'>
                  <span className='p-1 bg-background rounded-md border border-border'>
                    <ArrowRight size={12} />
                  </span>
                </span>
                <span>Quick look</span>
              </span>
            ) : null}
          </div>
        </div>
      )}

      {/* File Preview Modal */}
      {!inline && previewFile && (
        <FilePreviewModal
          isOpen={!!previewFile}
          onClose={() => setPreviewFile(null)}
          fileName={stripHtmlTags(previewFile.fileName)}
          fileUrl={previewFile.fileUrl}
          mimeType={previewFile.mimeType}
          fileSize={previewFile.fileSize}
        />
      )}
    </>
  );

  if (inline) {
    return (
      <Command
        ref={commandRef}
        shouldFilter={false}
        className='w-full h-full flex flex-col bg-background'
        onMouseMove={() => {
          if (suppressHover) {
            commandRef.current
              ?.querySelectorAll('[cmdk-item][aria-selected="true"]')
              .forEach(item => {
                item.setAttribute('aria-selected', 'false');
              });
            setSuppressHover(false);
          }
        }}
        onKeyDownCapture={handleCommandKeyDown}
      >
        {commandBody}
      </Command>
    );
  }

  return (
    <Command.Dialog
      open={open}
      ref={commandRef}
      onOpenChange={onOpenChange}
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
      }}
      className={cn(
        'fixed left-0 md:left-1/2 top-0 md:top-[14vh] -translate-x-0 md:-translate-x-1/2 md:translate-y-0 w-full',
        isMobile ? 'h-[100dvh] flex flex-col' : 'h-screen',
        contextSelectionMode ? 'md:max-w-4xl' : 'md:max-w-3xl',
        'md:w-full md:h-auto bg-background md:rounded-2xl shadow-[0px_7px_15px_0px_#0000000D,0px_28px_28px_0px_#00000017,0px_62px_37px_0px_#0000000D,0px_111px_44px_0px_#00000003,0px_173px_48px_0px_#00000000] border border-border z-[9999]',
      )}
      onKeyDownCapture={handleCommandKeyDown}
    >
      {commandBody}
    </Command.Dialog>
  );
};

export default ChannelCommandMenu;
