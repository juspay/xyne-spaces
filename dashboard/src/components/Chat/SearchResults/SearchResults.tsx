import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { GitCompare, Hash, Loader2, Mail, MessageCircle, Paperclip, X } from 'lucide-react';
import ThreadMessages from '../ThreadPannel';
import { UserProfile } from '../../ui/UserProfile/UserProfile';
import { usePlatform } from '../../../hooks/usePlatform';
import { useAuth } from '../../../hooks/useAuth';
import {
  DEFAULT_SEARCH_FILTERS,
  type SearchResultsFilters,
} from '../../../hooks/useSearchResultsScreen';
import { DisplaySearchResult } from '../../../types/search';
import { SearchResultMessageCard } from './SearchResultMessageCard';
import { SearchResultsContext, SearchResultsThread } from './SearchResultsContext';
import { SearchFilterBar } from './SearchFilterBar';
import { useAllVisibleChannels, useAllChannels } from '../../../hooks/useChannels';
import ConversationPanelV2 from '../ConversationPannel/ConversationPanelV2';
import { useSearchMetrics } from '../../../hooks/useSearchMetrics';
import { TabType, MentionType } from '../ChatDirectory/ChannelCommandMenu.types';
import { navigateToSearchResult } from '../../../utils/searchNavigation';
import Avatar from '../../ui/Avatar/Avatar';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '../../../utils/classNames';
import { CompareSelectRow } from './compare/CompareSelectRow';
import { SearchCompareDialog } from './compare/SearchCompareDialog';
import { hasRankingData } from './compare/rankingFeatures';

type SidePanelState =
  | { kind: 'thread'; thread: SearchResultsThread }
  | { kind: 'profile'; userId: string }
  | {
      kind: 'channel';
      channelId: string;
      conversationId: string;
      conversationCreatedAt?: number;
      matchedMessageId?: string | null;
    }
  | null;

function docTypeToTabType(docType: SearchResultsFilters['docType']): TabType {
  switch (docType) {
    case 'messages':
      return TabType.MESSAGES;
    case 'files':
      return TabType.ATTACHMENTS;
    case 'tickets':
      return TabType.TICKETS;
    case 'desk':
      return TabType.DESK;
    case 'people':
      return TabType.USERS;
    default:
      return TabType.ALL;
  }
}

const SearchResults = (): ReactElement => {
  const [searchParams] = useSearchParams();
  const { isMobile } = usePlatform();
  const [selectedPanel, setSelectedPanel] = useState<SidePanelState>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const query = searchParams.get('query')?.trim() ?? '';

  const [filters, setFilters] = useState<SearchResultsFilters>(() => {
    const fromParam = searchParams.get('from') ?? '';
    const inParam = searchParams.get('in') ?? '';
    const assigneeParam = searchParams.get('assignee') ?? '';
    return {
      ...DEFAULT_SEARCH_FILTERS,
      fromUserIds: fromParam ? fromParam.split(',').filter(Boolean) : [],
      inChannelIds: inParam ? inParam.split(',').filter(Boolean) : [],
      assigneeIds: assigneeParam ? assigneeParam.split(',').filter(Boolean) : [],
    };
  });

  // —— Compare mode (ranking comparison) ——
  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState<DisplaySearchResult[]>([]);
  const [relevantIds, setRelevantIds] = useState<Set<string>>(() => new Set());
  const [compareOpen, setCompareOpen] = useState(false);
  const selectedIds = useMemo(() => new Set(selected.map(r => r.id)), [selected]);

  const toggleSelect = useCallback((r: DisplaySearchResult) => {
    setSelected(prev =>
      prev.some(s => s.id === r.id) ? prev.filter(s => s.id !== r.id) : [...prev, r],
    );
  }, []);
  const removeFromCompare = useCallback((id: string) => {
    setSelected(prev => prev.filter(s => s.id !== id));
  }, []);
  const toggleRelevant = useCallback((id: string) => {
    setRelevantIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => {
    setSelected([]);
    setRelevantIds(() => new Set());
  }, []);
  const closeCompare = useCallback(() => setCompareOpen(false), []);

  // Use the exact same hook as the popup modal — no separate search infrastructure
  const {
    searchResults: backendResults,
    isSearching: isLoading,
    searchError: error,
    setText,
    setActiveTab,
    setSelectedMentions,
    setIncludeBotMessages,
    setRankProfile,
    setIncludeDebugInfo,
    loadMoreRef,
    paginationState,
  } = useSearchMetrics({ allChannels: [], mentionSearchType: null });

  // Sync hook text whenever the URL query param changes; also close sidebar on new search
  useEffect(() => {
    setText(query);
    setSelectedPanel(null);
    setSelected([]);
    setRelevantIds(() => new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Sync from/in/assignee URL params → filter state on navigation (popup → search screen while already mounted)
  const fromParam = searchParams.get('from') ?? '';
  const inParam = searchParams.get('in') ?? '';
  const assigneeParam = searchParams.get('assignee') ?? '';
  useEffect(() => {
    setFilters(prev => ({
      ...prev,
      fromUserIds: fromParam ? fromParam.split(',').filter(Boolean) : [],
      inChannelIds: inParam ? inParam.split(',').filter(Boolean) : [],
      assigneeIds: assigneeParam ? assigneeParam.split(',').filter(Boolean) : [],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromParam, inParam, assigneeParam]);

  // Sync docType filter → hook active tab
  useEffect(() => {
    if (filters.docType !== 'channels') {
      setActiveTab(docTypeToTabType(filters.docType));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.docType]);

  // Sync includeBotMessages filter → hook
  useEffect(() => {
    setIncludeBotMessages(filters.includeBotMessages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.includeBotMessages]);

  // Sync rankProfile filter → hook; clear selection so the matrix never mixes
  // ranking data captured under different profiles
  useEffect(() => {
    setRankProfile(filters.rankProfile);
    setSelected([]);
    setRelevantIds(() => new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.rankProfile]);

  // Compare mode → request ranking debug info; clear selection when leaving.
  useEffect(() => {
    setIncludeDebugInfo(compareMode);
    if (!compareMode) {
      setSelected([]);
      setRelevantIds(() => new Set());
      setCompareOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareMode]);

  // Local channel filtering (channels are not in Vespa — use local data)
  const isChannelsMode = filters.docType === 'channels';
  const allChannels = useAllVisibleChannels();
  const allChannelsForNav = useAllChannels();

  // Channels to pass as in: mentions — explicit selection takes precedence over "only my channels"
  const channelIdsForSearch = useMemo(
    () =>
      filters.inChannelIds.length > 0
        ? filters.inChannelIds
        : filters.onlyMyChannels
          ? allChannels.map(c => c.id)
          : [],
    [filters.inChannelIds, filters.onlyMyChannels, allChannels],
  );

  // Sync from/in/assignee filters → hook selected mentions
  useEffect(() => {
    const mentions = [
      ...filters.fromUserIds.map(id => ({ id, type: MentionType.USER, prefix: 'from:' as const })),
      ...channelIdsForSearch.map(id => ({
        id,
        type: MentionType.CHANNEL,
        prefix: 'in:' as const,
      })),
      ...filters.assigneeIds.map(id => ({
        id,
        type: MentionType.USER,
        prefix: 'assignee:' as const,
      })),
    ];
    setSelectedMentions(mentions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.fromUserIds, channelIdsForSearch, filters.assigneeIds]);

  const handleFiltersChange = useCallback(
    (newFilters: SearchResultsFilters) => {
      setFilters(newFilters);
      // Immediately sync tab and mentions to hook
      if (newFilters.docType !== 'channels') {
        setActiveTab(docTypeToTabType(newFilters.docType));
      }
      const resolvedChannelIds =
        newFilters.inChannelIds.length > 0
          ? newFilters.inChannelIds
          : newFilters.onlyMyChannels
            ? allChannels.map(c => c.id)
            : [];
      const mentions = [
        ...newFilters.fromUserIds.map(id => ({
          id,
          type: MentionType.USER,
          prefix: 'from:' as const,
        })),
        ...resolvedChannelIds.map(id => ({
          id,
          type: MentionType.CHANNEL,
          prefix: 'in:' as const,
        })),
        ...newFilters.assigneeIds.map(id => ({
          id,
          type: MentionType.USER,
          prefix: 'assignee:' as const,
        })),
      ];
      setSelectedMentions(mentions);
    },
    [setActiveTab, setSelectedMentions, allChannels],
  );
  const localChannelResults = useMemo((): DisplaySearchResult[] => {
    if (!isChannelsMode && filters.docType !== 'all') return [];
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase().replace(/^#/, '');
    return allChannels
      .filter(c => c.name.toLowerCase().includes(q))
      .map(c => ({
        type: 'channel' as const,
        id: c.id,
        title: `#${c.name}`,
        subtitle: '',
        relevanceScore: 1,
        metadata: {},
      }));
  }, [isChannelsMode, filters.docType, query, allChannels]);

  const baseResults = useMemo(() => {
    if (isChannelsMode) return localChannelResults;
    if (filters.docType === 'all') return [...backendResults, ...localChannelResults];
    return backendResults;
  }, [isChannelsMode, localChannelResults, filters.docType, backendResults]);

  const results = useMemo(() => {
    if (filters.sortBy === 'relevance' || isChannelsMode) return baseResults;
    return [...baseResults].sort((a, b) => {
      const aTime = a.metadata.timestamp ? new Date(a.metadata.timestamp).getTime() : 0;
      const bTime = b.metadata.timestamp ? new Date(b.metadata.timestamp).getTime() : 0;
      return filters.sortBy === 'newest' ? bTime - aTime : aTime - bTime;
    });
  }, [baseResults, filters.sortBy, isChannelsMode]);

  // Track whether a search has been initiated for the current query/filters to avoid
  // showing "No results" before the first search fires (300ms debounce window)
  const hasEverLoadedRef = useRef(false);
  const autoOpenedRef = useRef(false);
  const prevSearchKeyRef = useRef(`${query}|${fromParam}|${inParam}|${assigneeParam}`);
  const currentSearchKey = `${query}|${fromParam}|${inParam}|${assigneeParam}`;
  // Full key includes all local filter state so auto-open resets on any filter change
  const fullSearchKey = `${currentSearchKey}|${filters.docType}|${filters.sortBy}|${filters.includeBotMessages}|${filters.onlyMyChannels}`;
  if (currentSearchKey !== prevSearchKeyRef.current) {
    prevSearchKeyRef.current = currentSearchKey;
    hasEverLoadedRef.current = false; // reset for new search
  }
  if (isLoading) hasEverLoadedRef.current = true;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query]);

  // Reset auto-open and close stale panel whenever the search or any filter changes
  useEffect(() => {
    autoOpenedRef.current = false;
    setSelectedPanel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullSearchKey]);

  const handleSelectThread = useCallback((thread: SearchResultsThread) => {
    setSelectedPanel({ kind: 'thread', thread });
  }, []);
  const handleSelectUser = useCallback((userId: string) => {
    setSelectedPanel({ kind: 'profile', userId });
  }, []);
  const handleSelectChannelContext = useCallback(
    (
      channelId: string,
      conversationId: string,
      conversationCreatedAt?: number,
      matchedMessageId?: string | null,
    ) => {
      setSelectedPanel({
        kind: 'channel',
        channelId,
        conversationId,
        ...(conversationCreatedAt !== undefined && { conversationCreatedAt }),
        ...(matchedMessageId !== undefined && { matchedMessageId }),
      });
    },
    [],
  );
  const handleClosePanel = (): void => setSelectedPanel(null);

  // Auto-open the first result once results arrive for a new search (desktop only)
  useEffect(() => {
    if (isMobile || isLoading || results.length === 0) return;
    if (autoOpenedRef.current) return;
    const first = results[0];
    if (!first || first.type === 'channel') return;
    const ctx = first.searchContext;
    if (!ctx?.channelId || !ctx?.conversationId) return;
    autoOpenedRef.current = true;
    handleSelectThread({
      channelId: ctx.channelId,
      conversationId: ctx.conversationId,
      matchedMessageId: ctx.messageId ?? null,
    });
  }, [results, isMobile, isLoading, handleSelectThread]);

  const contextValue = useMemo(
    () => ({
      onSelectThread: handleSelectThread,
      onSelectUser: handleSelectUser,
      onSelectChannelContext: handleSelectChannelContext,
    }),
    [handleSelectThread, handleSelectUser, handleSelectChannelContext],
  );

  const currentTab = docTypeToTabType(filters.docType);
  const totalCount = isChannelsMode
    ? localChannelResults.length
    : (paginationState[currentTab]?.total ?? 0);

  const resultsColumn = (
    <div className='relative flex flex-col h-full min-h-0'>
      <div className='shrink-0 px-4'>
        {query && (
          <p className='pt-4 text-base text-muted-foreground'>
            Results for: <span className='font-semibold text-foreground'>{query}</span>
          </p>
        )}
        <div className='mt-3'>
          <SearchFilterBar filters={filters} onFiltersChange={handleFiltersChange} />
        </div>
        {(results.length > 0 || (query && totalCount > 0)) && (
          <div className='flex items-center justify-between gap-3 pb-2'>
            <p className='text-xs text-muted-foreground tabular-nums'>
              {(totalCount || results.length).toLocaleString()} results
            </p>
            <button
              onClick={() => setCompareMode(v => !v)}
              title='Compare how results ranked'
              data-track-category='SEARCH_RESULTS'
              data-track-name='TOGGLE_COMPARE'
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md active:scale-[0.96] transition',
                compareMode
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-border',
              )}
            >
              <GitCompare size={13} />
              Compare
            </button>
          </div>
        )}
      </div>
      <div ref={scrollRef} className='flex-1 min-h-0 overflow-y-auto px-4'>
        <ResultsBody
          query={query}
          hasActiveFilters={
            filters.fromUserIds.length > 0 ||
            filters.inChannelIds.length > 0 ||
            filters.assigneeIds.length > 0 ||
            filters.onlyMyChannels
          }
          hasEverLoaded={hasEverLoadedRef.current}
          isLoading={isLoading}
          error={error}
          results={results}
          loadMoreRef={loadMoreRef}
          selectedPanel={selectedPanel}
          onSelectUser={handleSelectUser}
          channelData={allChannelsForNav}
          compareMode={compareMode}
          selectedIds={selectedIds}
          relevantIds={relevantIds}
          onToggleSelect={toggleSelect}
        />
      </div>

      <div className='pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center'>
        <AnimatePresence>
          {compareMode && selected.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
              className='pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-background/95 backdrop-blur shadow-lg py-1.5 pl-4 pr-1.5'
            >
              <span className='text-xs text-foreground'>
                <span className='font-semibold tabular-nums'>{selected.length}</span> selected
              </span>
              <button
                onClick={clearSelection}
                data-track-category='SEARCH_RESULTS'
                data-track-name='CLEAR_COMPARE'
                className='text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-full hover:bg-muted active:scale-[0.96] transition'
              >
                Clear
              </button>
              <button
                onClick={() => setCompareOpen(true)}
                disabled={selected.length < 2}
                data-track-category='SEARCH_RESULTS'
                data-track-name='OPEN_COMPARE'
                className='inline-flex items-center gap-1.5 text-xs font-medium bg-primary text-primary-foreground px-3 py-1.5 rounded-full shadow-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.96] transition'
              >
                <GitCompare size={13} />
                Compare in depth
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  return (
    <SearchResultsContext.Provider value={contextValue}>
      <div
        className='h-full flex flex-col relative bg-background overflow-hidden md:rounded-2xl shadow-md'
        data-id='search-results-screen'
      >
        <div className='flex-1 flex min-h-0 relative'>
          {isMobile ? (
            <MobileLayout
              selectedPanel={selectedPanel}
              onClose={handleClosePanel}
              resultsColumn={resultsColumn}
            />
          ) : (
            <DesktopLayout
              selectedPanel={selectedPanel}
              onClose={handleClosePanel}
              resultsColumn={resultsColumn}
            />
          )}
        </div>

        <SearchCompareDialog
          open={compareOpen}
          query={query}
          results={selected}
          relevantIds={relevantIds}
          onToggleRelevant={toggleRelevant}
          onRemove={removeFromCompare}
          onClose={closeCompare}
        />
      </div>
    </SearchResultsContext.Provider>
  );
};
export default SearchResults;

// —— Inline subcomponents ———

interface ResultsBodyProps {
  query: string;
  hasActiveFilters: boolean;
  hasEverLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  results: DisplaySearchResult[];
  loadMoreRef: React.RefObject<HTMLDivElement | null>;
  selectedPanel: SidePanelState;
  onSelectUser: (userId: string) => void;
  channelData: ReturnType<typeof useAllChannels>;
  compareMode: boolean;
  selectedIds: Set<string>;
  relevantIds: Set<string>;
  onToggleSelect: (result: DisplaySearchResult) => void;
}

function ResultsBody({
  query,
  hasActiveFilters,
  hasEverLoaded,
  isLoading,
  error,
  results,
  loadMoreRef,
  selectedPanel,
  onSelectUser,
  channelData,
  compareMode,
  selectedIds,
  relevantIds,
  onToggleSelect,
}: ResultsBodyProps): ReactElement {
  const navigate = useNavigate();

  if (results.length === 0 && !error) {
    if (!query && !hasActiveFilters) {
      return (
        <EmptyState
          title='Search for messages, files, and tickets'
          subtitle='Type above and press Enter to search'
        />
      );
    }
    // Show spinner while waiting for the first search to fire (debounce) or while loading
    if (isLoading || !hasEverLoaded) {
      return (
        <div className='flex items-center justify-center h-full'>
          <Loader2 className='animate-spin text-muted-foreground' size={32} />
        </div>
      );
    }
    const subtitle = query
      ? `Nothing matched "${query}"`
      : 'No results found for the active filters';
    return <EmptyState title='No results found' subtitle={subtitle} />;
  }
  if (error) {
    return (
      <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
        <p className='text-destructive text-base font-semibold mb-2'>Search failed</p>
        <p className='text-muted-foreground text-sm'>{error}</p>
      </div>
    );
  }

  return (
    <div className='w-full space-y-2 pt-2 pb-6'>
      {results.map((result, index) => {
        const key = `${result.type}-${result.id}`;
        const el = ((): ReactElement | null => {
          // User card — opens profile panel
          if (result.type === 'user') {
            return (
              <button
                key={key}
                onClick={() => onSelectUser(result.id)}
                className='w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-left'
                data-track-category='SEARCH_RESULTS'
                data-track-name='OPEN_USER'
              >
                <Avatar userId={result.id} size='md' showActiveStatus={false} />
                <div className='min-w-0'>
                  <p className='text-sm font-medium text-foreground truncate'>{result.title}</p>
                  {result.subtitle && (
                    <p className='text-xs text-muted-foreground truncate'>{result.subtitle}</p>
                  )}
                </div>
              </button>
            );
          }

          // Channel card
          if (result.type === 'channel') {
            const channelId = result.searchContext?.channelId ?? result.id;
            return (
              <button
                key={key}
                onClick={() => void navigate(`/chat/dir/${channelId}`)}
                className='w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-left'
                data-track-category='SEARCH_RESULTS'
                data-track-name='OPEN_CHANNEL'
              >
                <div className='flex items-center justify-center size-9 rounded-lg bg-muted shrink-0'>
                  <Hash className='size-4 text-muted-foreground' />
                </div>
                <div className='min-w-0'>
                  <p className='text-sm font-medium text-foreground truncate'>{result.title}</p>
                  {result.subtitle && result.subtitle !== 'Channel' && (
                    <p className='text-xs text-muted-foreground truncate'>{result.subtitle}</p>
                  )}
                </div>
              </button>
            );
          }

          // Attachment / file card
          if (result.type === 'attachment') {
            const icon =
              result.searchContext?.subApp === 'DESK' ? (
                <Mail className='size-4 text-muted-foreground' />
              ) : (
                <Paperclip className='size-4 text-muted-foreground' />
              );
            return (
              <button
                key={key}
                onClick={() => void navigateToSearchResult(result, navigate, channelData)}
                className='w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-left'
                data-track-category='SEARCH_RESULTS'
                data-track-name='OPEN_ATTACHMENT'
              >
                <div className='flex items-center justify-center size-9 rounded-lg bg-muted shrink-0'>
                  {icon}
                </div>
                <div className='min-w-0'>
                  <p className='text-sm font-medium text-foreground truncate'>{result.title}</p>
                  {result.subtitle && (
                    <p className='text-xs text-muted-foreground truncate'>{result.subtitle}</p>
                  )}
                </div>
              </button>
            );
          }

          // Conversation message card (type === 'conversation')
          // DESK mails navigate away; regular messages open in the side panel
          if (result.type === 'conversation' && result.searchContext?.subApp === 'DESK') {
            return (
              <button
                key={key}
                onClick={() => void navigateToSearchResult(result, navigate, channelData)}
                className='w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-left'
                data-track-category='SEARCH_RESULTS'
                data-track-name='OPEN_MAIL'
              >
                <div className='flex items-center justify-center size-9 rounded-lg bg-muted shrink-0'>
                  <Mail className='size-4 text-muted-foreground' />
                </div>
                <div className='min-w-0'>
                  <p className='text-sm font-medium text-foreground truncate'>{result.title}</p>
                  {result.subtitle && (
                    <p className='text-xs text-muted-foreground truncate'>{result.subtitle}</p>
                  )}
                </div>
              </button>
            );
          }

          // Regular message card
          const ctx = result.searchContext;
          if (!ctx?.channelId || !ctx?.conversationId) return null;
          return (
            <SearchResultMessageCard
              key={key}
              channelId={ctx.channelId}
              conversationId={ctx.conversationId}
              matchedMessageId={ctx.messageId ?? null}
              {...(result.context && { searchSnippet: result.context })}
              isSelected={
                (selectedPanel?.kind === 'channel' &&
                  selectedPanel.conversationId === ctx.conversationId &&
                  selectedPanel.matchedMessageId === (ctx.messageId ?? null)) ||
                (selectedPanel?.kind === 'thread' &&
                  selectedPanel.thread.conversationId === ctx.conversationId &&
                  selectedPanel.thread.matchedMessageId === (ctx.messageId ?? null))
              }
            />
          );
        })();

        if (!el) return null;
        if (!compareMode) return el;
        return (
          <CompareSelectRow
            key={key}
            rank={index + 1}
            score={result.relevanceScore}
            selected={selectedIds.has(result.id)}
            relevant={relevantIds.has(result.id)}
            hasDebug={hasRankingData(result)}
            onToggle={() => onToggleSelect(result)}
          >
            {el}
          </CompareSelectRow>
        );
      })}
      {/* Sentinel for load-more (same mechanism as popup modal) */}
      <div ref={loadMoreRef} className='h-1' />
      {isLoading && (
        <div className='flex justify-center py-4'>
          <Loader2 className='animate-spin text-muted-foreground' size={20} />
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle?: string }): ReactElement {
  return (
    <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
      <MessageCircle className='text-muted-foreground mb-4' size={64} />
      <p className='text-muted-foreground text-xl font-semibold mb-2'>{title}</p>
      {subtitle && <p className='text-muted-foreground text-sm'>{subtitle}</p>}
    </div>
  );
}

interface LayoutProps {
  selectedPanel: SidePanelState;
  onClose: () => void;
  resultsColumn: ReactElement;
}

function MobileLayout({ selectedPanel, onClose, resultsColumn }: LayoutProps): ReactElement {
  return (
    <>
      <div className='flex-1 min-w-0 flex flex-col min-h-0'>{resultsColumn}</div>
      {selectedPanel && (
        <div className='absolute inset-0 z-20 bg-background flex flex-col animate-slide-in-from-right'>
          {selectedPanel.kind === 'thread' && (
            <div className='flex items-center justify-end p-2 border-b border-border'>
              <button
                onClick={onClose}
                className='p-2 rounded-md hover:bg-accent'
                aria-label='Close thread'
                data-track-category='SEARCH_RESULTS'
                data-track-name='CLOSE_THREAD_PANEL'
              >
                <X size={18} />
              </button>
            </div>
          )}
          <div className='flex-1 min-h-0'>
            <SearchResultsSidePanel panel={selectedPanel} onClose={onClose} />
          </div>
        </div>
      )}
    </>
  );
}

function DesktopLayout({ selectedPanel, onClose, resultsColumn }: LayoutProps): ReactElement {
  return (
    <PanelGroup direction='horizontal' className='h-full' autoSaveId='search-results-thread'>
      <Panel defaultSize={selectedPanel ? 60 : 100} minSize={selectedPanel ? 30 : 100}>
        <div className='h-full'>{resultsColumn}</div>
      </Panel>
      {selectedPanel && (
        <>
          <PanelResizeHandle className='w-1 hover:bg-blue-50 active:bg-blue-100 transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
            <div className='w-[1px] h-full bg-border' />
          </PanelResizeHandle>
          <Panel defaultSize={40} minSize={25}>
            <div className='h-full animate-slide-in-from-right'>
              <SearchResultsSidePanel panel={selectedPanel} onClose={onClose} />
            </div>
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}

function SearchResultsSidePanel({
  panel,
  onClose,
}: {
  panel: NonNullable<SidePanelState>;
  onClose: () => void;
}): ReactElement {
  const { user: currentUser } = useAuth();

  return (
    <div className='h-full flex flex-col min-h-0 bg-background'>
      {panel.kind === 'channel' ? (
        <ConversationPanelV2
          channelId={panel.channelId}
          previousChannelId={null}
          linkedConversationIdOverride={panel.conversationId}
          linkedItemCreatedAtOverride={panel.conversationCreatedAt ?? null}
          onClose={onClose}
        />
      ) : panel.kind === 'thread' ? (
        <ThreadMessages
          channelId={panel.thread.channelId}
          conversationId={panel.thread.conversationId}
          onClose={onClose}
        />
      ) : (
        <>
          <div className='flex items-center justify-end p-2 border-b border-border shrink-0'>
            <button
              onClick={onClose}
              className='p-2 rounded-md hover:bg-accent'
              aria-label='Close profile'
              data-track-category='SEARCH_RESULTS'
              data-track-name='CLOSE_PROFILE_PANEL'
            >
              <X size={18} />
            </button>
          </div>
          <div className='flex-1 min-h-0 overflow-y-auto'>
            <UserProfile
              userId={panel.userId}
              isOwnProfile={currentUser?.id === panel.userId}
              className='border-0 rounded-none shadow-none'
            />
          </div>
        </>
      )}
    </div>
  );
}
